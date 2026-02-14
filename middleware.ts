import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

/**
 * Security middleware for Google Ads MCP
 * 
 * Protects /api/mcp and /api/sse endpoints with Bearer token auth.
 * Allows OAuth endpoints through (they handle their own auth).
 * Allows .well-known discovery through (public by spec).
 */

// Inline token verification (middleware runs on Edge, can't import Node libs the same way)
function verifyToken(authHeader: string | null): boolean {
  if (!authHeader) return false;
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return false;

  const secret = process.env.AUTH_SECRET || "";
  if (!secret) return false;

  // 1. Check static API keys
  const apiKeys = (process.env.MCP_API_KEYS || "").split(",").map(k => k.trim()).filter(Boolean);
  if (apiKeys.some(key => key === token)) return true;

  // 2. Check signed OAuth token
  const raw = token.startsWith("gads_") ? token.slice(5) : token;
  const dotIdx = raw.lastIndexOf(".");
  if (dotIdx < 0) return false;

  const b64 = raw.slice(0, dotIdx);
  const sig = raw.slice(dotIdx + 1);

  // Verify HMAC using Web Crypto (Edge compatible)
  const encoder = new TextEncoder();
  const expectedSig = hmacSha256Sync(secret, b64);
  if (sig !== expectedSig) return false;

  // Check expiry
  try {
    const payload = JSON.parse(atob(b64.replace(/-/g, "+").replace(/_/g, "/")));
    if (typeof payload.exp !== "number" || payload.exp < Date.now()) return false;
    return true;
  } catch {
    return false;
  }
}

// Sync HMAC-SHA256 for Edge Runtime (using Node.js crypto which is available in Next.js middleware)
function hmacSha256Sync(secret: string, data: string): string {
  const hmac = crypto.createHmac("sha256", secret);
  hmac.update(data);
  return hmac.digest("base64url");
}

// Rate limiting: simple in-memory counter (resets on cold start, but good enough per-instance)
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 100; // requests per window
const RATE_WINDOW = 60_000; // 1 minute

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

export function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;

  // Allow OAuth and discovery endpoints through (they handle their own auth)
  if (
    path.startsWith("/api/oauth") ||
    path.startsWith("/.well-known") ||
    path === "/" ||
    path === "/favicon.ico"
  ) {
    return NextResponse.next();
  }

  // Protect MCP endpoints
  if (path.startsWith("/api/")) {
    // Rate limiting
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || 
               req.headers.get("x-real-ip") || 
               "unknown";
    if (!checkRateLimit(ip)) {
      return NextResponse.json(
        { error: "rate_limit_exceeded", message: "Too many requests. Try again later." },
        { status: 429, headers: { "Retry-After": "60" } }
      );
    }

    // Auth check
    const authHeader = req.headers.get("authorization");
    if (!verifyToken(authHeader)) {
      return NextResponse.json(
        { error: "unauthorized", message: "Valid Bearer token required. Use OAuth flow or API key." },
        { status: 401, headers: { "WWW-Authenticate": 'Bearer realm="Google Ads MCP"' } }
      );
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/api/:path*", "/.well-known/:path*"],
};
