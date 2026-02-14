import { NextRequest, NextResponse } from "next/server";

/**
 * Security middleware for Google Ads MCP
 * Uses Web Crypto API (Edge-compatible, no Node.js crypto needed)
 */

// Rate limiting
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 100;
const RATE_WINDOW = 60_000;

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_WINDOW });
    return true;
  }
  entry.count++;
  return entry.count <= RATE_LIMIT;
}

// Web Crypto HMAC-SHA256 (Edge Runtime compatible)
async function hmacSha256(secret: string, data: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(data));
  // Convert to base64url
  const bytes = new Uint8Array(sig);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function verifyToken(authHeader: string | null): Promise<boolean> {
  if (!authHeader) return false;
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return false;

  const secret = process.env.AUTH_SECRET || "";
  if (!secret) return false;

  // 1. Check static API keys
  const apiKeys = (process.env.MCP_API_KEYS || "").split(",").map((k) => k.trim()).filter(Boolean);
  if (apiKeys.some((key) => key === token)) return true;

  // 2. Check signed OAuth token (gads_xxx)
  const raw = token.startsWith("gads_") ? token.slice(5) : token;
  const dotIdx = raw.lastIndexOf(".");
  if (dotIdx < 0) return false;

  const b64 = raw.slice(0, dotIdx);
  const sig = raw.slice(dotIdx + 1);

  try {
    const expectedSig = await hmacSha256(secret, b64);
    if (sig !== expectedSig) return false;

    // Check expiry - decode base64url
    const padded = b64.replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(atob(padded));
    if (typeof payload.exp !== "number" || payload.exp < Date.now()) return false;
    return true;
  } catch {
    return false;
  }
}

export async function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;

  // Allow OAuth and discovery endpoints through
  if (
    path.startsWith("/api/oauth") ||
    path.startsWith("/.well-known") ||
    path === "/" ||
    path === "/favicon.ico"
  ) {
    return NextResponse.next();
  }

  // Protect all /api/ endpoints
  if (path.startsWith("/api/")) {
    // Rate limiting
    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("x-real-ip") ||
      "unknown";
    if (!checkRateLimit(ip)) {
      return NextResponse.json(
        { error: "rate_limit_exceeded", message: "Too many requests." },
        { status: 429, headers: { "Retry-After": "60" } }
      );
    }

    // Auth check
    const authorized = await verifyToken(req.headers.get("authorization"));
    if (!authorized) {
      return NextResponse.json(
        { error: "unauthorized", message: "Valid Bearer token required." },
        { status: 401, headers: { "WWW-Authenticate": 'Bearer realm="Google Ads MCP"' } }
      );
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/api/:path*", "/.well-known/:path*"],
};
