import { NextRequest, NextResponse } from "next/server";

import { backendFetch } from "@/lib/server/backend";
import { getSessionToken } from "@/lib/server/session";

async function proxy(req: NextRequest, pathSegments: string[]) {
  if (pathSegments[0] === "auth") {
    return NextResponse.json({ detail: "Use /api/auth/* routes" }, { status: 404 });
  }
  const path = `/v1/${pathSegments.join("/")}`;
  const url = new URL(req.url);
  const target = `${path}${url.search}`;

  const token = await getSessionToken();
  const headers = new Headers();
  const contentType = req.headers.get("content-type");
  if (contentType) headers.set("Content-Type", contentType);

  const init: RequestInit = {
    method: req.method,
    headers,
  };
  if (req.method !== "GET" && req.method !== "HEAD") {
    init.body = await req.arrayBuffer();
  }

  const upstream = await backendFetch(target, init, token);
  const responseType = upstream.headers.get("content-type") || "application/json";
  const body = await upstream.arrayBuffer();

  return new NextResponse(body, {
    status: upstream.status,
    headers: { "Content-Type": responseType },
  });
}

type RouteContext = { params: Promise<{ path: string[] }> };

export async function GET(req: NextRequest, ctx: RouteContext) {
  const { path } = await ctx.params;
  return proxy(req, path);
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  const { path } = await ctx.params;
  return proxy(req, path);
}

export async function PATCH(req: NextRequest, ctx: RouteContext) {
  const { path } = await ctx.params;
  return proxy(req, path);
}

export async function PUT(req: NextRequest, ctx: RouteContext) {
  const { path } = await ctx.params;
  return proxy(req, path);
}

export async function DELETE(req: NextRequest, ctx: RouteContext) {
  const { path } = await ctx.params;
  return proxy(req, path);
}
