"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useRole, RoleMode } from "@/lib/role";

const MODE_LABELS: Record<RoleMode, string> = {
  admin: "Platform Admin",
  hospital: "Hospital Admin",
  patient: "Patient",
};

const MODE_HINT: Record<RoleMode, string> = {
  admin: "Add & manage hospitals",
  hospital: "Doctors, slots, queues",
  patient: "Book & track visits",
};

export function RoleSwitcher() {
  const {
    mode, setMode, hospital, hospitalId, setHospitalId,
    patient, patientId, setPatientId, hospitals, patients,
  } = useRole();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const pickMode = (m: RoleMode) => {
    setMode(m);
    if (m === "admin") {
      setOpen(false);
      router.push("/admin");
    } else if (m === "hospital") {
      router.push(hospitalId ? `/hospital/${hospitalId}` : "/hospital");
    } else {
      router.push("/patient-portal");
    }
  };

  const pickHospital = (id: number) => {
    setHospitalId(id);
    if (mode === "hospital") {
      setOpen(false);
      router.push(`/hospital/${id}`);
    }
    if (mode === "patient") {
      setPatientId(null);
    }
  };

  const pickPatient = (id: number) => {
    setPatientId(id);
    setOpen(false);
    router.push("/patient-portal");
  };

  const contextLabel =
    mode === "hospital" && hospital
      ? hospital.name.replace(/^Quivora\s+/i, "")
      : mode === "patient" && patient
        ? patient.name
        : null;

  return (
    <div ref={ref} style={{ position: "relative", marginLeft: "auto" }}>
      <button type="button" className="role-switch-btn" onClick={() => setOpen((v) => !v)}>
        <span
          className="role-dot"
          style={{
            background:
              mode === "admin" ? "#7c3aed" : mode === "hospital" ? "var(--accent)" : "#0369a1",
          }}
        />
        <span>{MODE_LABELS[mode]}</span>
        {contextLabel && (
          <span style={{ color: "var(--muted)", fontWeight: 500, maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            · {contextLabel}
          </span>
        )}
        <span style={{ color: "var(--muted)", fontSize: 10 }}>▾</span>
      </button>

      {open && (
        <div className="role-menu">
          <div className="role-menu-section">Switch role</div>
          {(["admin", "hospital", "patient"] as RoleMode[]).map((m) => (
            <button
              key={m}
              type="button"
              className={`role-menu-item ${mode === m ? "active" : ""}`}
              onClick={() => pickMode(m)}
            >
              <div style={{ fontWeight: 600 }}>{MODE_LABELS[m]}</div>
              <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 1 }}>{MODE_HINT[m]}</div>
            </button>
          ))}

          {(mode === "hospital" || mode === "patient") && (
            <>
              <div className="role-menu-section">Hospital</div>
              <div style={{ maxHeight: 150, overflowY: "auto" }}>
                {hospitals.filter((h) => h.is_active !== false).map((h) => (
                  <button
                    key={h.id}
                    type="button"
                    className={`role-menu-item ${hospitalId === h.id ? "active-sub" : ""}`}
                    onClick={() => pickHospital(h.id)}
                  >
                    <div style={{ fontWeight: 600 }}>{h.name}</div>
                    <div style={{ fontSize: 11, color: "var(--muted)" }}>{h.city}</div>
                  </button>
                ))}
              </div>
            </>
          )}

          {mode === "patient" && (
            <>
              <div className="role-menu-section">Patient</div>
              <div style={{ maxHeight: 150, overflowY: "auto" }}>
                {patients.length === 0 ? (
                  <div style={{ padding: "12px 14px", fontSize: 12, color: "var(--muted)" }}>
                    No patients at this hospital — book a visit first.
                  </div>
                ) : (
                  patients.slice(0, 50).map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className={`role-menu-item ${patientId === p.id ? "active-sub" : ""}`}
                      onClick={() => pickPatient(p.id)}
                    >
                      <div style={{ fontWeight: 600 }}>{p.name}</div>
                      <div style={{ fontSize: 11, color: "var(--muted)" }}>
                        Age {p.age}{p.phone ? ` · ${p.phone}` : ""}
                      </div>
                    </button>
                  ))
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
