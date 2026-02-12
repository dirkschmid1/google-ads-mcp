import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { verifyCode } from "../authorize/route";

function makeToken(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

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

    return NextResponse.json({
      access_token: makeToken("gads"),
      token_type: "Bearer",
      expires_in: 86400,
      refresh_token: makeToken("gads_rt"),
    });
  }

  if (grantType === "refresh_token") {
    return NextResponse.json({
      access_token: makeToken("gads"),
      token_type: "Bearer",
      expires_in: 86400,
    });
  }

  return NextResponse.json({ error: "unsupported_grant_type" }, { status: 400 });
}
