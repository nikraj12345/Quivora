"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, ReactNode } from "react";
import { api, Doctor, Hospital, PatientRecord } from "@/lib/api";

export type RoleMode = "admin" | "hospital" | "doctor" | "patient";

type RoleState = {
  mode: RoleMode;
  hospitalId: number | null;
  hospital: Hospital | null;
  patientId: number | null;
  patient: PatientRecord | null;
  doctorId: number | null;
  doctor: Doctor | null;
  hospitals: Hospital[];
  patients: PatientRecord[];
  doctors: Doctor[];
  setMode: (m: RoleMode) => void;
  setHospitalId: (id: number | null) => void;
  setPatientId: (id: number | null) => void;
  setDoctorId: (id: number | null) => void;
  refresh: () => Promise<void>;
};

const RoleContext = createContext<RoleState | null>(null);
const STORAGE_KEY = "quivora.role.v1";

export function RoleProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<RoleMode>("hospital");
  const [hospitalId, setHospitalIdState] = useState<number | null>(null);
  const [patientId, setPatientIdState] = useState<number | null>(null);
  const [doctorId, setDoctorIdState] = useState<number | null>(null);
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [patients, setPatients] = useState<PatientRecord[]>([]);
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed.mode) setModeState(parsed.mode);
        if (parsed.hospitalId) setHospitalIdState(parsed.hospitalId);
        if (parsed.patientId) setPatientIdState(parsed.patientId);
        if (parsed.doctorId) setDoctorIdState(parsed.doctorId);
      }
    } catch { /* ignore */ }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ mode, hospitalId, patientId, doctorId }));
  }, [mode, hospitalId, patientId, doctorId, hydrated]);

  const refresh = useCallback(async () => {
    const hs = await api.hospitals();
    setHospitals(hs);
    // After reseed, old hospital IDs in localStorage no longer exist — fall back.
    const stillValid = hospitalId != null && hs.some((h) => h.id === hospitalId);
    const hid = stillValid ? hospitalId : (hs[0]?.id ?? null);
    if (hid !== hospitalId) setHospitalIdState(hid);
    if (hid) {
      const [ps, ds] = await Promise.all([api.patients(hid), api.doctors(hid)]);
      setPatients(ps);
      setDoctors(ds);
      if (doctorId != null && !ds.some((doctor) => doctor.id === doctorId)) {
        setDoctorIdState(ds[0]?.id ?? null);
      }
    } else {
      setPatients([]);
      setDoctors([]);
      setDoctorIdState(null);
    }
  }, [hospitalId, doctorId]);

  useEffect(() => {
    if (!hydrated) return;
    refresh().catch(() => {});
  }, [hydrated, refresh]);

  useEffect(() => {
    if (!hospitalId) return;
    Promise.all([api.patients(hospitalId), api.doctors(hospitalId)])
      .then(([ps, ds]) => {
        setPatients(ps);
        setDoctors(ds);
        if (doctorId != null && !ds.some((doctor) => doctor.id === doctorId)) {
          setDoctorIdState(ds[0]?.id ?? null);
        }
      })
      .catch(() => {
        setPatients([]);
        setDoctors([]);
      });
  }, [hospitalId, doctorId]);

  const hospital = useMemo(
    () => hospitals.find((h) => h.id === hospitalId) || null,
    [hospitals, hospitalId]
  );
  const patient = useMemo(
    () => patients.find((p) => p.id === patientId) || null,
    [patients, patientId]
  );
  const doctor = useMemo(
    () => doctors.find((d) => d.id === doctorId) || null,
    [doctors, doctorId]
  );

  const setMode = (m: RoleMode) => setModeState(m);
  const setHospitalId = (id: number | null) => setHospitalIdState(id);
  const setPatientId = (id: number | null) => setPatientIdState(id);
  const setDoctorId = (id: number | null) => setDoctorIdState(id);

  const value: RoleState = {
    mode, hospitalId, hospital, patientId, patient, doctorId, doctor,
    hospitals, patients, doctors,
    setMode, setHospitalId, setPatientId, setDoctorId, refresh,
  };

  return <RoleContext.Provider value={value}>{children}</RoleContext.Provider>;
}

export function useRole() {
  const ctx = useContext(RoleContext);
  if (!ctx) throw new Error("useRole must be used within RoleProvider");
  return ctx;
}
