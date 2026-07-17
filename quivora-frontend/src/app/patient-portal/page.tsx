"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Shell } from "@/components/Shell";
import { api, Doctor } from "@/lib/api";
import { useRole } from "@/lib/role";
import { formatSlotsList, slotShort } from "@/lib/slots";

export default function PatientPortalPage() {
  const { hospital, patient, setMode, hospitalId } = useRole();
  const [doctors, setDoctors] = useState<Doctor[]>([]);

  useEffect(() => {
    setMode("patient");
  }, [setMode]);

  useEffect(() => {
    if (!hospitalId) return;
    api.doctors(hospitalId).then(setDoctors).catch(() => setDoctors([]));
  }, [hospitalId]);

  const available = doctors.filter((d) => d.is_available);

  return (
    <Shell title="Patient care" subtitle={hospital ? hospital.name : "Pick a hospital from the switcher"}>
      {!patient ? (
        <div className="card" style={{ padding: 32, width: "100%" }}>
          <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Who are you?</div>
          <p style={{ color: "var(--muted)", fontSize: 14, marginBottom: 16, lineHeight: 1.6, maxWidth: 640 }}>
            Use the top-right switcher → <strong>Patient</strong> → pick your hospital, then select your name.
            Or book a new visit at reception.
          </p>
          <Link
            href={hospitalId ? `/register?hospital=${hospitalId}&source=patient` : "/register"}
            className="btn btn-primary"
          >
            Book / register →
          </Link>
        </div>
      ) : (
        <div className="page-grid-2">
          <div className="card" style={{ padding: 24 }}>
            <div style={{ fontSize: 12, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600 }}>Signed in as</div>
            <div style={{ fontSize: 28, fontWeight: 800, marginTop: 6 }}>{patient.name}</div>
            <div style={{ fontSize: 14, color: "var(--muted)", marginTop: 4 }}>
              Age {patient.age}{patient.phone ? ` · ${patient.phone}` : ""}
            </div>
            <div style={{ marginTop: 16, padding: "12px 14px", background: "var(--surface-2)", borderRadius: 10, fontSize: 13 }}>
              <div style={{ fontWeight: 600 }}>{hospital?.name}</div>
              <div style={{ color: "var(--muted)", marginTop: 2 }}>{hospital?.city}{hospital?.address ? ` · ${hospital.address}` : ""}</div>
            </div>
            <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 8 }}>
              <Link
                href={hospitalId ? `/register?hospital=${hospitalId}&source=patient` : "/register"}
                className="btn btn-primary"
              >
                Book a visit →
              </Link>
              <p style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.5 }}>
                After registration you&apos;ll get a token and Telegram updates when the doctor goes live.
              </p>
            </div>
          </div>

          <div className="card" style={{ overflow: "hidden" }}>
            <div className="card-header">
              <span className="card-title">Doctors available today</span>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>{available.length} of {doctors.length}</span>
            </div>
            <div>
              {available.map((d) => (
                <div key={d.id} style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", gap: 12 }}>
                  <div>
                    <div style={{ fontWeight: 600 }}>{d.name}</div>
                    <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>{d.department}</div>
                    <div style={{ fontSize: 11, color: "var(--muted-2)", marginTop: 4 }}>{formatSlotsList(d.slots)}</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <span className={d.is_live ? "badge badge-live" : "badge badge-off"}>
                      {d.is_live ? `Live · ${slotShort(d.active_slot)}` : "Not started"}
                    </span>
                    {d.avg_duration_sec && (
                      <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 6 }}>avg {Math.round(d.avg_duration_sec / 60)} min</div>
                    )}
                  </div>
                </div>
              ))}
              {available.length === 0 && (
                <p style={{ padding: 20, color: "var(--muted)", fontSize: 13 }}>No doctors marked available right now.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </Shell>
  );
}
