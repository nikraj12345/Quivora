"use client";

import { RoleProvider } from "@/lib/role";

export function Providers({ children }: { children: React.ReactNode }) {
  return <RoleProvider>{children}</RoleProvider>;
}
