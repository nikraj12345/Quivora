import { NextRequest, NextResponse } from "next/server";

import { backendFetch } from "@/lib/server/backend";
import { setSessionToken } from "@/lib/server/session";

type TokenResponse = {
  access_token: string;
  user: Record<string, unknown>;
};

export async function POST(req: NextRequest) {
  const body = await req.json();
  const upstream = await backendFetch("/v1/auth/patient/otp/request", {
    method: "POST",
    body: JSON.stringify(body),
  });
  const text = await upstream.text();
  return new NextResponse(text, {
    status: upstream.status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function PUT(req: NextRequest) {
  const body = await req.json();
  const upstream = await backendFetch("/v1/auth/patient/otp/verify", {
    method: "POST",
    body: JSON.stringify(body),
  });
  const text = await upstream.text();
  if (!upstream.ok) {
    return NextResponse.json(
      text ? JSON.parse(text) : { detail: upstream.statusText },
      { status: upstream.status },
    );
  }
  const data = JSON.parse(text) as TokenResponse;
  await setSessionToken(data.access_token);
  return NextResponse.json({ user: data.user });
}
