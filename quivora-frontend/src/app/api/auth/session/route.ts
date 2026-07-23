import { NextRequest, NextResponse } from "next/server";

import { backendFetch } from "@/lib/server/backend";
import { clearSessionToken, getSessionToken, setSessionToken } from "@/lib/server/session";

type TokenResponse = {
  access_token: string;
  user: Record<string, unknown>;
};

async function establishSession(path: string, body: unknown) {
  const upstream = await backendFetch(path, {
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

export async function POST(req: NextRequest) {
  const body = await req.json();
  return establishSession("/v1/auth/login", body);
}

export async function GET() {
  const token = await getSessionToken();
  if (!token) {
    return NextResponse.json({ detail: "Not authenticated" }, { status: 401 });
  }
  const upstream = await backendFetch("/v1/auth/me", { method: "GET" }, token);
  const text = await upstream.text();
  return new NextResponse(text, {
    status: upstream.status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function DELETE() {
  await clearSessionToken();
  return NextResponse.json({ ok: true });
}
