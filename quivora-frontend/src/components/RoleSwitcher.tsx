"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useRole, RoleMode } from "@/lib/role";
import { useAuth } from "@/lib/auth";

const MODE_LABELS: Record<RoleMode, string> = {
  admin: "Platform Admin",
  hospital: "Hospital Admin",
  doctor: "Doctor",
  patient: "Patient",
};

const MODE_HINT: Record<RoleMode, string> = {
  admin: "Add & manage hospitals",
  hospital: "Doctors, slots, queues",
  doctor: "Consultation queue & room",
  patient: "Book & track your visits",
};

export function RoleSwitcher() {
  const {
    mode, setMode, hospital, hospitalId, setHospitalId,
    doctor, doctorId, setDoctorId, doctors, hospitals,
    lockedHospitalId, lockedDoctorId,
  } = useRole();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [submenuMode, setSubmenuMode] = useState<RoleMode | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();

  const isPlatformAdmin = user?.role === "platform_admin";
  const isPatient = user?.role === "patient";
  const canPickHospital = isPlatformAdmin && lockedHospitalId == null;
  const canPickDoctor = lockedDoctorId == null;

  const showSubmenuFor = (m: RoleMode) => {
    if (m === "admin" || m === "patient") return false;
    if (m === "hospital" && lockedHospitalId != null) return false;
    if (m === "doctor" && !canPickDoctor) return false;
    return true;
  };

  const availableModes = (["admin", "hospital", "doctor", "patient"] as RoleMode[]).filter((m) => {
    if (m === "admin") return isPlatformAdmin;
    if (m === "patient") return isPatient;
    if (m === "hospital") return user?.role === "hospital_admin" || user?.role === "hospital_staff" || isPlatformAdmin;
    if (m === "doctor") return user?.role === "doctor" || user?.role === "hospital_admin" || user?.role === "hospital_staff" || isPlatformAdmin;
    return false;
  });

  useEffect(() => {
    if (!user) return;
    if (mode === "admin" && !isPlatformAdmin) {
      setMode(isPatient ? "patient" : "hospital");
    }
  }, [user, mode, isPlatformAdmin, isPatient, setMode]);

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
    if (m === "admin") router.push("/admin");
    else if (m === "hospital") router.push("/reception");
    else if (m === "doctor") router.push("/doctor");
    else router.push("/patient-portal");
  };

  const pickHospital = (id: number, targetMode: Exclude<RoleMode, "admin" | "patient">) => {
    setHospitalId(id);
    if (targetMode === "hospital") {
      setMode("hospital");
      setOpen(false);
      setSubmenuMode(null);
      router.push("/reception");
      return;
    }
    setMode(targetMode);
    if (targetMode === "doctor") {
      setDoctorId(null);
    }
  };

  const pickDoctor = (id: number) => {
    setMode("doctor");
    setDoctorId(id);
    setOpen(false);
    setSubmenuMode(null);
    router.push("/doctor");
  };

  const handleModeClick = (m: RoleMode) => {
    if (m === "admin" || m === "patient") {
      pickMode(m);
      return;
    }
    if (m === "hospital" && lockedHospitalId != null) {
      pickHospital(lockedHospitalId, "hospital");
      return;
    }
    if (m === "doctor" && lockedDoctorId != null) {
      pickDoctor(lockedDoctorId);
      return;
    }
    if (!showSubmenuFor(m)) {
      pickMode(m);
      return;
    }
    if (lockedHospitalId != null && hospitalId !== lockedHospitalId) {
      setHospitalId(lockedHospitalId);
    }
    setSubmenuMode(m);
  };

  const contextLabel =
    mode === "doctor" && doctor
      ? doctor.name
      : mode === "hospital" && hospital
      ? hospital.name.replace(/^Quivora\s+/i, "")
      : mode === "patient" && user?.role === "patient"
        ? user.name
        : null;

  if (!user) return null;

  const visibleHospitals = hospitals.filter((h) => h.is_active !== false);
  const activeHospital = hospital ?? visibleHospitals.find((h) => h.id === hospitalId) ?? null;

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
          <div className="role-menu-section">Switch view</div>
          {availableModes.map((m) => (
            <button
              key={m}
              type="button"
              className={`role-menu-item ${mode === m ? "active" : ""}`}
              onMouseEnter={() => setSubmenuMode(showSubmenuFor(m) ? m : null)}
              onFocus={() => setSubmenuMode(showSubmenuFor(m) ? m : null)}
              onClick={() => handleModeClick(m)}
            >
              <div className="role-menu-item-row">
                <div>
                  <div style={{ fontWeight: 600 }}>{MODE_LABELS[m]}</div>
                  <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 1 }}>{MODE_HINT[m]}</div>
                </div>
                {showSubmenuFor(m) && <span className="role-menu-arrow">‹</span>}
              </div>
            </button>
          ))}

          {submenuMode === "doctor" && showSubmenuFor("doctor") && (
            <div className="role-submenu">
              <div className="role-submenu-title">{MODE_LABELS.doctor}</div>

              {canPickHospital ? (
                <>
                  <div className="role-menu-section">Choose hospital</div>
                  <div className="role-submenu-list role-submenu-hospitals">
                    {visibleHospitals.map((h) => (
                      <button
                        key={h.id}
                        type="button"
                        className={`role-menu-item ${hospitalId === h.id ? "active-sub" : ""}`}
                        onClick={() => pickHospital(h.id, "doctor")}
                      >
                        <div style={{ fontWeight: 600 }}>{h.name}</div>
                        <div style={{ fontSize: 11, color: "var(--muted)" }}>{h.city}</div>
                      </button>
                    ))}
                  </div>
                </>
              ) : activeHospital ? (
                <div style={{ padding: "8px 12px 12px", fontSize: 12, color: "var(--muted)" }}>
                  {activeHospital.name}
                </div>
              ) : null}

              <div className="role-menu-section">Choose doctor</div>
              <div className="role-submenu-list">
                {!hospitalId ? (
                  <div className="role-submenu-empty">Select a hospital first.</div>
                ) : doctors.length === 0 ? (
                  <div className="role-submenu-empty">No doctors at this hospital.</div>
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
            </div>
          )}
        </div>
      )}
    </div>
  );
}
