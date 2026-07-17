"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useRole, RoleMode } from "@/lib/role";

const MODE_LABELS: Record<RoleMode, string> = {
  admin: "Platform Admin",
  hospital: "Hospital Admin",
  doctor: "Doctor",
  patient: "Patient",
};

const MODE_HINT: Record<RoleMode, string> = {
  admin: "Add & manage hospitals",
  hospital: "Doctors, slots, queues",
  doctor: "My patients and consultation queue",
  patient: "Book & track visits",
};

export function RoleSwitcher() {
  const {
    mode, setMode, hospital, hospitalId, setHospitalId,
    doctor, doctorId, setDoctorId, doctors,
    patient, patientId, setPatientId, hospitals, patients,
  } = useRole();
  const [open, setOpen] = useState(false);
  const [submenuMode, setSubmenuMode] = useState<RoleMode | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setSubmenuMode(null);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const pickMode = (m: RoleMode) => {
    setMode(m);
    setOpen(false);
    setSubmenuMode(null);
    if (m === "admin") {
      router.push("/admin");
    } else if (m === "hospital") {
      router.push("/reception");
    } else if (m === "doctor") {
      router.push("/doctor");
    } else {
      router.push("/patient-portal");
    }
  };

  const pickHospital = (id: number, targetMode: Exclude<RoleMode, "admin">) => {
    setMode(targetMode);
    setHospitalId(id);
    if (targetMode === "hospital") {
      setOpen(false);
      setSubmenuMode(null);
      router.push("/reception");
    }
    if (targetMode === "patient") {
      setPatientId(null);
    }
    if (targetMode === "doctor") {
      setDoctorId(null);
    }
  };

  const pickPatient = (id: number) => {
    setMode("patient");
    setPatientId(id);
    setOpen(false);
    setSubmenuMode(null);
    router.push("/patient-portal");
  };

  const pickDoctor = (id: number) => {
    setMode("doctor");
    setDoctorId(id);
    setOpen(false);
    setSubmenuMode(null);
    router.push("/doctor");
  };

  const contextLabel =
    mode === "doctor" && doctor
      ? doctor.name
      : mode === "hospital" && hospital
      ? hospital.name.replace(/^Quivora\s+/i, "")
      : mode === "patient" && patient
        ? patient.name
        : null;

  return (
    <div ref={ref} style={{ position: "relative", marginLeft: "auto" }}>
      <button
        type="button"
        className="role-switch-btn"
        onClick={() => {
          setOpen((v) => !v);
          setSubmenuMode(null);
        }}
      >
        <span
          className="role-dot"
          style={{
            background:
              mode === "admin" ? "#7c3aed"
              : mode === "hospital" ? "var(--accent)"
              : mode === "doctor" ? "#c2410c"
              : "#0369a1",
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
          {(["admin", "hospital", "doctor", "patient"] as RoleMode[]).map((m) => (
            <button
              key={m}
              type="button"
              className={`role-menu-item ${mode === m ? "active" : ""}`}
              onMouseEnter={() => setSubmenuMode(m === "admin" ? null : m)}
              onFocus={() => setSubmenuMode(m === "admin" ? null : m)}
              onClick={() => m === "admin" ? pickMode(m) : setSubmenuMode(m)}
            >
              <div className="role-menu-item-row">
                <div>
                  <div style={{ fontWeight: 600 }}>{MODE_LABELS[m]}</div>
                  <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 1 }}>{MODE_HINT[m]}</div>
                </div>
                {m !== "admin" && <span className="role-menu-arrow">‹</span>}
              </div>
            </button>
          ))}

          {submenuMode && submenuMode !== "admin" && (
            <div className="role-submenu">
              <div className="role-submenu-title">{MODE_LABELS[submenuMode]}</div>
              <div className="role-menu-section">Choose hospital</div>
              <div className="role-submenu-list role-submenu-hospitals">
                {hospitals.filter((h) => h.is_active !== false).map((h) => (
                  <button
                    key={h.id}
                    type="button"
                    className={`role-menu-item ${hospitalId === h.id ? "active-sub" : ""}`}
                    onClick={() => pickHospital(h.id, submenuMode)}
                  >
                    <div style={{ fontWeight: 600 }}>{h.name}</div>
                    <div style={{ fontSize: 11, color: "var(--muted)" }}>{h.city}</div>
                  </button>
                ))}
              </div>

              {submenuMode === "doctor" && (
                <>
                  <div className="role-menu-section">Choose doctor</div>
                  <div className="role-submenu-list">
                    {doctors.length === 0 ? (
                      <div className="role-submenu-empty">No doctors enrolled at this hospital.</div>
                    ) : doctors.map((d) => (
                      <button
                        key={d.id}
                        type="button"
                        className={`role-menu-item ${doctorId === d.id ? "active-sub" : ""}`}
                        onClick={() => pickDoctor(d.id)}
                      >
                        <div style={{ fontWeight: 600 }}>{d.name}</div>
                        <div style={{ fontSize: 11, color: "var(--muted)" }}>{d.department}</div>
                      </button>
                    ))}
                  </div>
                </>
              )}

              {submenuMode === "patient" && (
                <>
                  <div className="role-menu-section">Choose patient</div>
                  <div className="role-submenu-list">
                    {patients.length === 0 ? (
                      <div className="role-submenu-empty">No patients at this hospital — book a visit first.</div>
                    ) : patients.slice(0, 50).map((p) => (
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
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
