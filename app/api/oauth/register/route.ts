import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const clientId = crypto.randomUUID();
  const clientSecret = crypto.randomUUID();
  return NextResponse.json({
    client_id: clientId,
    client_secret: clientSecret,
    client_name: body.client_name || "Claude",
    redirect_uris: body.redirect_uris || [],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "client_secret_post",
  }, { status: 201 });
}
