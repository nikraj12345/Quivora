import { NextResponse } from "next/server";
import { backendFetch } from "@/lib/server/backend";

export async function GET() {
  try {
    const upstream = await backendFetch("/health");
    const data = await upstream.json();
    return NextResponse.json(data, { status: upstream.status });
  } catch (error) {
    return NextResponse.json(
      { status: "error", message: error instanceof Error ? error.message : "Failed to connect to backend" },
      { status: 502 }
    );
  }
}
