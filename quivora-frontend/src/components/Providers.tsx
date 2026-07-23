"use client";

import { RoleProvider } from "@/lib/role";
import { AuthProvider } from "@/lib/auth";
import { AuthGate } from "@/components/AuthGate";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <RoleProvider>
        <AuthGate>{children}</AuthGate>
      </RoleProvider>
    </AuthProvider>
  );
}
