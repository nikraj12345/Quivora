"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, ReactNode } from "react";
import { api, Hospital, PatientRecord } from "@/lib/api";

export type RoleMode = "admin" | "hospital" | "patient";

type RoleState = {
  mode: RoleMode;
  hospitalId: number | null;
  hospital: Hospital | null;
  patientId: number | null;
  patient: PatientRecord | null;
  hospitals: Hospital[];
  patients: PatientRecord[];
  setMode: (m: RoleMode) => void;
  setHospitalId: (id: number | null) => void;
  setPatientId: (id: number | null) => void;
  refresh: () => Promise<void>;
};

const RoleContext = createContext<RoleState | null>(null);
const STORAGE_KEY = "quivora.role.v1";

export function RoleProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<RoleMode>("hospital");
  const [hospitalId, setHospitalIdState] = useState<number | null>(null);
  const [patientId, setPatientIdState] = useState<number | null>(null);
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [patients, setPatients] = useState<PatientRecord[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed.mode) setModeState(parsed.mode);
        if (parsed.hospitalId) setHospitalIdState(parsed.hospitalId);
        if (parsed.patientId) setPatientIdState(parsed.patientId);
      }
    } catch { /* ignore */ }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ mode, hospitalId, patientId }));
  }, [mode, hospitalId, patientId, hydrated]);

  const refresh = useCallback(async () => {
    const hs = await api.hospitals();
    setHospitals(hs);
    // After reseed, old hospital IDs in localStorage no longer exist — fall back.
    const stillValid = hospitalId != null && hs.some((h) => h.id === hospitalId);
    const hid = stillValid ? hospitalId : (hs[0]?.id ?? null);
    if (hid !== hospitalId) setHospitalIdState(hid);
    if (hid) {
      const ps = await api.patients(hid);
      setPatients(ps);
    } else {
      setPatients([]);
    }
  }, [hospitalId]);

  useEffect(() => {
    if (!hydrated) return;
    refresh().catch(() => {});
  }, [hydrated, refresh]);

  useEffect(() => {
    if (!hospitalId) return;
    api.patients(hospitalId).then(setPatients).catch(() => setPatients([]));
  }, [hospitalId]);

  const hospital = useMemo(
    () => hospitals.find((h) => h.id === hospitalId) || null,
    [hospitals, hospitalId]
  );
  const patient = useMemo(
    () => patients.find((p) => p.id === patientId) || null,
    [patients, patientId]
  );

  const setMode = (m: RoleMode) => setModeState(m);
  const setHospitalId = (id: number | null) => setHospitalIdState(id);
  const setPatientId = (id: number | null) => setPatientIdState(id);

  const value: RoleState = {
    mode, hospitalId, hospital, patientId, patient, hospitals, patients,
    setMode, setHospitalId, setPatientId, refresh,
  };

  return <RoleContext.Provider value={value}>{children}</RoleContext.Provider>;
}

export function useRole() {
  const ctx = useContext(RoleContext);
  if (!ctx) throw new Error("useRole must be used within RoleProvider");
  return ctx;
}
