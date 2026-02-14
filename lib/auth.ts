import crypto from "crypto";

const SECRET = () => process.env.AUTH_SECRET || "";

/**
 * Create an HMAC-signed bearer token (stateless, verifiable without DB)
 * Format: base64url(payload).hmac_signature
 */
export function createSignedToken(expiresInSeconds = 86400): string {
  const payload = JSON.stringify({
    iat: Date.now(),
    exp: Date.now() + expiresInSeconds * 1000,
    jti: crypto.randomUUID(),
  });
  const b64 = Buffer.from(payload).toString("base64url");
  const sig = crypto
    .createHmac("sha256", SECRET())
    .update(b64)
    .digest("base64url");
  return `gads_${b64}.${sig}`;
}

/**
 * Verify a signed bearer token
 */
export function verifySignedToken(token: string): boolean {
  if (!SECRET()) return false;

  // Strip prefix
  const raw = token.startsWith("gads_") ? token.slice(5) : token;
  const dotIdx = raw.lastIndexOf(".");
  if (dotIdx < 0) return false;

  const b64 = raw.slice(0, dotIdx);
  const sig = raw.slice(dotIdx + 1);

  // Verify HMAC
  const expected = crypto
    .createHmac("sha256", SECRET())
    .update(b64)
    .digest("base64url");

  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    return false;
  }

  // Check expiry
  try {
    const payload = JSON.parse(Buffer.from(b64, "base64url").toString());
    if (typeof payload.exp !== "number" || payload.exp < Date.now()) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if a token matches a static API key from MCP_API_KEYS env var
 * Format: comma-separated keys
 */
export function isValidApiKey(token: string): boolean {
  const keys = (process.env.MCP_API_KEYS || "").split(",").map((k) => k.trim()).filter(Boolean);
  if (keys.length === 0) return false;
  return keys.some((key) => {
    try {
      return crypto.timingSafeEqual(
        Buffer.from(token),
        Buffer.from(key)
      );
    } catch {
      return false; // length mismatch
    }
  });
}

/**
 * Validate any bearer token (signed OAuth token OR static API key)
 */
export function validateBearerToken(authHeader: string | null): boolean {
  if (!authHeader) return false;
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return false;

  // Try signed token first, then API key
  return verifySignedToken(token) || isValidApiKey(token);
}
