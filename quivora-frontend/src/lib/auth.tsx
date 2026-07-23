"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, ReactNode } from "react";

export type AuthRole =
  | "platform_admin"
  | "hospital_admin"
  | "hospital_staff"
  | "doctor"
  | "patient"
  | "service"
  | "his";

export type AuthUser = {
  id: number;
  email: string | null;
  name: string;
  role: AuthRole;
  hospital_id: number | null;
  hospital_name?: string | null;
  doctor_id: number | null;
  doctor_name?: string | null;
  patient_id: number | null;
  auth_kind?: string;
};

type AuthState = {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  doctorRoomLogin: (doctorRef: string, pin: string) => Promise<void>;
  patientOtpVerify: (phone: string, hospitalId: number, code: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshMe: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);
const LEGACY_STORAGE_KEY = "quivora.auth.v1";

function parseUser(raw: Record<string, unknown>): AuthUser {
  return {
    id: Number(raw.id),
    email: (raw.email as string | null) ?? null,
    name: String(raw.name ?? ""),
    role: raw.role as AuthRole,
    hospital_id: raw.hospital_id != null ? Number(raw.hospital_id) : null,
    hospital_name: (raw.hospital_name as string | null) ?? null,
    doctor_id: raw.doctor_id != null ? Number(raw.doctor_id) : null,
    doctor_name: (raw.doctor_name as string | null) ?? null,
    patient_id: raw.patient_id != null ? Number(raw.patient_id) : null,
    auth_kind: (raw.auth_kind as string | undefined) ?? "user",
  };
}

async function authJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    credentials: "include",
    cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(text || res.statusText);
  }
  return text ? (JSON.parse(text) as T) : ({} as T);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshMe = useCallback(async () => {
    try {
      const me = await authJson<Record<string, unknown>>("/api/auth/session", { method: "GET" });
      setUser(parseUser(me));
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.removeItem(LEGACY_STORAGE_KEY);
    }
    refreshMe();
  }, [refreshMe]);

  const login = useCallback(async (email: string, password: string) => {
    const res = await authJson<{ user: Record<string, unknown> }>("/api/auth/session", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    setUser(parseUser(res.user));
  }, []);

  const doctorRoomLogin = useCallback(async (doctorRef: string, pin: string) => {
    const res = await authJson<{ user: Record<string, unknown> }>("/api/auth/doctor-room", {
      method: "POST",
      body: JSON.stringify({ doctor_ref: doctorRef, pin }),
    });
    setUser(parseUser(res.user));
  }, []);

  const patientOtpVerify = useCallback(async (phone: string, hospitalId: number, code: string) => {
    const res = await authJson<{ user: Record<string, unknown> }>("/api/auth/patient/otp", {
      method: "PUT",
      body: JSON.stringify({ phone, hospital_id: hospitalId, code }),
    });
    setUser(parseUser(res.user));
  }, []);

  const logout = useCallback(async () => {
    await authJson("/api/auth/session", { method: "DELETE" });
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, loading, login, doctorRoomLogin, patientOtpVerify, logout, refreshMe }),
    [user, loading, login, doctorRoomLogin, patientOtpVerify, logout, refreshMe],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

export function canAccessRoute(role: AuthRole | null | undefined, path: string): boolean {
  if (!role) return false;
  if (role === "platform_admin" || role === "service") return true;
  if (path.startsWith("/admin") || path.startsWith("/training")) return false;
  if (path.startsWith("/hospital") || path.startsWith("/insights")) {
    return role === "hospital_admin";
  }
  if (path.startsWith("/room") || path.startsWith("/doctor")) {
    return role === "doctor" || role === "hospital_admin" || role === "hospital_staff";
  }
  if (path.startsWith("/patient-portal")) {
    return role === "patient";
  }
  if (
    path.startsWith("/reception") ||
    path.startsWith("/doctors") ||
    path.startsWith("/opd") ||
    path.startsWith("/scans") ||
    path.startsWith("/ops")
  ) {
    return role === "hospital_admin" || role === "hospital_staff" || role === "doctor";
  }
  return true;
}
