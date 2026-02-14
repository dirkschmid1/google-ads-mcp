import { NextRequest, NextResponse } from "next/server";
import { verifyCode } from "../authorize/route";
import { createSignedToken } from "@/lib/auth";

export async function POST(req: NextRequest) {
  let body: Record<string, string>;
  const ct = req.headers.get("content-type") || "";
  if (ct.includes("application/x-www-form-urlencoded")) {
    const form = await req.formData();
    body = Object.fromEntries(form.entries()) as Record<string, string>;
  } else {
    body = await req.json();
  }

  const grantType = body.grant_type;

  if (grantType === "authorization_code") {
    const code = body.code;
    const verified = verifyCode(code);
    if (!verified) {
      return NextResponse.json({ error: "invalid_grant" }, { status: 400 });
    }

    // Issue HMAC-signed tokens (24h access, 90d refresh)
    const accessToken = createSignedToken(86400);
    const refreshToken = createSignedToken(90 * 86400);

    return NextResponse.json({
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: 86400,
      refresh_token: refreshToken,
    });
  }

  if (grantType === "refresh_token") {
    // Verify the refresh token before issuing new access token
    const { validateBearerToken } = await import("@/lib/auth");
    const rtValid = validateBearerToken(`Bearer ${body.refresh_token}`);
    if (!rtValid) {
      return NextResponse.json({ error: "invalid_grant", message: "Refresh token expired or invalid" }, { status: 400 });
    }

    return NextResponse.json({
      access_token: createSignedToken(86400),
      token_type: "Bearer",
      expires_in: 86400,
    });
  }

  return NextResponse.json({ error: "unsupported_grant_type" }, { status: 400 });
}
