/**
 * Server-only backend client for the Next.js BFF.
 * Never import this from client components.
 */

const API_BASE =
  process.env.QUIVORA_API_BASE ||
  process.env.NEXT_PUBLIC_API_BASE ||
  "http://127.0.0.1:8100";

export function backendUrl(path: string) {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${API_BASE}${normalized}`;
}

export async function backendFetch(
  path: string,
  init: RequestInit = {},
  token?: string | null,
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return fetch(backendUrl(path), { ...init, headers, cache: "no-store" });
}

export async function backendJson<T>(
  path: string,
  init: RequestInit = {},
  token?: string | null,
): Promise<T> {
  const res = await backendFetch(path, init, token);
  const text = await res.text();
  if (!res.ok) {
    throw new Error(text || res.statusText);
  }
  return text ? (JSON.parse(text) as T) : ({} as T);
}
