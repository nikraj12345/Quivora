"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, ReactNode } from "react";
import { api, Doctor, Hospital } from "@/lib/api";
import { useAuth } from "@/lib/auth";

export type RoleMode = "admin" | "hospital" | "doctor" | "patient";

type RoleState = {
  mode: RoleMode;
  hospitalId: number | null;
  hospital: Hospital | null;
  doctorId: number | null;
  doctor: Doctor | null;
  hospitals: Hospital[];
  doctors: Doctor[];
  lockedHospitalId: number | null;
  lockedDoctorId: number | null;
  setMode: (m: RoleMode) => void;
  setHospitalId: (id: number | null) => void;
  setDoctorId: (id: number | null) => void;
  refresh: () => Promise<void>;
};

const RoleContext = createContext<RoleState | null>(null);
const STORAGE_KEY = "quivora.role.v1";

function defaultModeForRole(role: string | undefined): RoleMode {
  if (role === "platform_admin") return "admin";
  if (role === "doctor") return "doctor";
  if (role === "patient") return "patient";
  return "hospital";
}

export function RoleProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [mode, setModeState] = useState<RoleMode>("hospital");
  const [hospitalId, setHospitalIdState] = useState<number | null>(null);
  const [doctorId, setDoctorIdState] = useState<number | null>(null);
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [hydrated, setHydrated] = useState(false);

  const isPlatformAdmin = user?.role === "platform_admin";
  const lockedHospitalId = !isPlatformAdmin && user?.hospital_id != null ? user.hospital_id : null;
  const lockedDoctorId = user?.role === "doctor" && user.doctor_id != null ? user.doctor_id : null;

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed.mode) setModeState(parsed.mode);
        // Only restore hospitalId for platform admins — locked users get it from the JWT
        // to avoid stale IDs after a DB reset causing 403s
        if (parsed.hospitalId && user?.role === "platform_admin") setHospitalIdState(parsed.hospitalId);
        if (parsed.doctorId) setDoctorIdState(parsed.doctorId);
      }
    } catch { /* ignore */ }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!user) return;
    if (mode === "admin" && !isPlatformAdmin) {
      setModeState(defaultModeForRole(user.role));
    }
    if (lockedHospitalId != null) {
      setHospitalIdState(lockedHospitalId);
    }
    if (lockedDoctorId != null) {
      setDoctorIdState(lockedDoctorId);
    }
  }, [user, mode, isPlatformAdmin, lockedHospitalId, lockedDoctorId]);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ mode, hospitalId, doctorId }));
  }, [mode, hospitalId, doctorId, hydrated]);

  const refresh = useCallback(async () => {
    const hs = await api.hospitals();
    const visible = lockedHospitalId != null ? hs.filter((h) => h.id === lockedHospitalId) : hs;
    setHospitals(visible);
    const stillValid = hospitalId != null && visible.some((h) => h.id === hospitalId);
    const hid = lockedHospitalId ?? (stillValid ? hospitalId : visible[0]?.id ?? null);
    if (hid !== hospitalId) setHospitalIdState(hid);
    if (!hid) {
      setDoctors([]);
      if (lockedDoctorId == null) setDoctorIdState(null);
      return;
    }
    try {
      const ds = await api.doctors(hid);
      setDoctors(ds);
      if (lockedDoctorId != null) {
        setDoctorIdState(lockedDoctorId);
      } else if (doctorId != null && !ds.some((item) => item.id === doctorId)) {
        setDoctorIdState(ds[0]?.id ?? null);
      }
    } catch {
      setDoctors([]);
    }
  }, [hospitalId, doctorId, lockedHospitalId, lockedDoctorId]);

  useEffect(() => {
    if (!hydrated) return;
    refresh().catch(() => {});
  }, [hydrated, refresh, user?.id]);

  useEffect(() => {
    // Don't fire while hydration + refresh() is still resolving the real hospitalId
    if (!hospitalId || !hydrated) return;
    let cancelled = false;
    api.doctors(hospitalId)
      .then((ds) => {
        if (cancelled) return;
        setDoctors(ds);
        if (lockedDoctorId != null) {
          setDoctorIdState(lockedDoctorId);
        } else if (doctorId != null && !ds.some((item) => item.id === doctorId)) {
          setDoctorIdState(ds[0]?.id ?? null);
        }
      })
      .catch(() => {
        if (!cancelled) setDoctors([]);
      });
    return () => { cancelled = true; };
  }, [hospitalId, doctorId, lockedDoctorId, hydrated]);

  const hospital = useMemo(
    () => hospitals.find((h) => h.id === hospitalId) || null,
    [hospitals, hospitalId]
  );
  const doctor = useMemo(
    () => doctors.find((d) => d.id === doctorId) || null,
    [doctors, doctorId]
  );

  const setMode = (m: RoleMode) => {
    if (m === "admin" && !isPlatformAdmin) return;
    setModeState(m);
  };
  const setHospitalId = (id: number | null) => {
    if (lockedHospitalId != null && id !== lockedHospitalId) return;
    setHospitalIdState(id);
  };
  const setDoctorId = (id: number | null) => {
    if (lockedDoctorId != null && id !== lockedDoctorId) return;
    setDoctorIdState(id);
  };

  const value: RoleState = {
    mode, hospitalId, hospital, doctorId, doctor,
    hospitals, doctors,
    lockedHospitalId, lockedDoctorId,
    setMode, setHospitalId, setDoctorId, refresh,
  };

  return <RoleContext.Provider value={value}>{children}</RoleContext.Provider>;
}

export function useRole() {
  const ctx = useContext(RoleContext);
  if (!ctx) throw new Error("useRole must be used within RoleProvider");
  return ctx;
}
