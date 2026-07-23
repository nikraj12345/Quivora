"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { canAccessRoute, useAuth } from "@/lib/auth";

const PUBLIC_PREFIXES = [
  "/login",
  "/dashboard",
  "/checkin",
  "/book",
  "/register",
  "/patient/",
  "/my-ticket/",
];

function isPublicPath(path: string) {
  if (path === "/" || path === "/dashboard") return true;
  return PUBLIC_PREFIXES.some((p) => path.startsWith(p));
}

export function AuthGate({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (isPublicPath(pathname)) return;
    if (!user) {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
      return;
    }
    if (!canAccessRoute(user.role, pathname)) {
      router.replace("/dashboard");
    }
  }, [loading, user, pathname, router]);

  if (!loading && !isPublicPath(pathname) && !user) {
    return (
      <div className="page-body" style={{ padding: 48, textAlign: "center", color: "var(--muted)" }}>
        Redirecting to sign in…
      </div>
    );
  }

  return <>{children}</>;
}
