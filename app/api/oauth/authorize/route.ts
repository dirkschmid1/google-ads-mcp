import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

function makeCode(redirectUri: string, codeChallenge: string): string {
  const payload = JSON.stringify({ redirectUri, codeChallenge, exp: Date.now() + 300000 });
  const b64 = Buffer.from(payload).toString("base64url");
  const sig = crypto.createHmac("sha256", process.env.AUTH_SECRET || "secret").update(b64).digest("base64url");
  return `${b64}.${sig}`;
}

export function verifyCode(code: string): { redirectUri: string; codeChallenge: string } | null {
  const [b64, sig] = code.split(".");
  if (!b64 || !sig) return null;
  const expected = crypto.createHmac("sha256", process.env.AUTH_SECRET || "secret").update(b64).digest("base64url");
  if (sig !== expected) return null;
  try {
    const payload = JSON.parse(Buffer.from(b64, "base64url").toString());
    if (payload.exp < Date.now()) return null;
    return payload;
  } catch { return null; }
}

export async function GET(req: NextRequest) {
  const redirectUri = req.nextUrl.searchParams.get("redirect_uri") || "";
  const state = req.nextUrl.searchParams.get("state") || "";
  const codeChallenge = req.nextUrl.searchParams.get("code_challenge") || "";

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Google Ads MCP — Authorize</title>
<style>
  body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#0a0a0a;color:#fff}
  .card{background:#1a1a1a;border:1px solid #333;border-radius:12px;padding:2rem;max-width:400px;width:90%}
  h1{font-size:1.3rem;margin:0 0 .5rem}
  p{color:#888;font-size:.9rem;margin:0 0 1.5rem}
  input{width:100%;padding:.75rem;border:1px solid #333;border-radius:8px;background:#111;color:#fff;font-size:1rem;box-sizing:border-box;margin-bottom:1rem}
  button{width:100%;padding:.75rem;border:none;border-radius:8px;background:#3b82f6;color:#fff;font-size:1rem;cursor:pointer}
  button:hover{background:#2563eb}
  .err{color:#ef4444;font-size:.85rem;margin-bottom:1rem}
</style></head>
<body><div class="card">
  <h1>🔐 Google Ads MCP</h1>
  <p>Enter the access password to connect.</p>
  <form method="POST" action="/api/oauth/authorize">
    <input type="hidden" name="redirect_uri" value="${redirectUri}">
    <input type="hidden" name="state" value="${state}">
    <input type="hidden" name="code_challenge" value="${codeChallenge}">
    <input type="password" name="password" placeholder="Password" autofocus required>
    <button type="submit">Authorize</button>
  </form>
</div></body></html>`;

  return new NextResponse(html, { headers: { "Content-Type": "text/html" } });
}

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const password = form.get("password") as string;
  const redirectUri = form.get("redirect_uri") as string;
  const state = form.get("state") as string;
  const codeChallenge = form.get("code_challenge") as string;

  if (password !== process.env.AUTH_SECRET) {
    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Google Ads MCP — Authorize</title>
<style>
  body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#0a0a0a;color:#fff}
  .card{background:#1a1a1a;border:1px solid #333;border-radius:12px;padding:2rem;max-width:400px;width:90%}
  h1{font-size:1.3rem;margin:0 0 .5rem}
  p{color:#888;font-size:.9rem;margin:0 0 1.5rem}
  input{width:100%;padding:.75rem;border:1px solid #333;border-radius:8px;background:#111;color:#fff;font-size:1rem;box-sizing:border-box;margin-bottom:1rem}
  button{width:100%;padding:.75rem;border:none;border-radius:8px;background:#3b82f6;color:#fff;font-size:1rem;cursor:pointer}
  .err{color:#ef4444;font-size:.85rem;margin-bottom:1rem}
</style></head>
<body><div class="card">
  <h1>🔐 Google Ads MCP</h1>
  <p>Enter the access password to connect.</p>
  <div class="err">Invalid password. Try again.</div>
  <form method="POST" action="/api/oauth/authorize">
    <input type="hidden" name="redirect_uri" value="${redirectUri}">
    <input type="hidden" name="state" value="${state}">
    <input type="hidden" name="code_challenge" value="${codeChallenge}">
    <input type="password" name="password" placeholder="Password" autofocus required>
    <button type="submit">Authorize</button>
  </form>
</div></body></html>`;
    return new NextResponse(html, { status: 200, headers: { "Content-Type": "text/html" } });
  }

  const code = makeCode(redirectUri, codeChallenge);
  const url = new URL(redirectUri);
  url.searchParams.set("code", code);
  if (state) url.searchParams.set("state", state);

  return NextResponse.redirect(url.toString(), 302);
}
