"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Shell } from "@/components/Shell";
import { api, QueueItem } from "@/lib/api";
import { useRole } from "@/lib/role";
import { slotShort } from "@/lib/slots";

const PRIORITY_LABELS: Record<string, string> = {
  emergency: "Emergency",
  urgent: "Urgent",
  senior: "Senior",
  normal: "Normal",
};

export default function DoctorWorkspacePage() {
  const {
    hospital,
    doctor,
    doctorId,
    doctors,
    setDoctorId,
    setMode,
  } = useRole();
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { setMode("doctor"); }, [setMode]);

  const load = useCallback(async () => {
    if (!doctor) {
      setQueue([]);
      return;
    }
    setLoading(true);
    try {
      setQueue(await api.queue(doctor.external_id));
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load patients");
    } finally {
      setLoading(false);
    }
  }, [doctor]);

  useEffect(() => {
    load();
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, [load]);

  const current = queue.find((item) => item.status === "in_progress");
  const waiting = queue.filter((item) => item.status !== "in_progress");
  const priorityCount = waiting.filter((item) => item.priority !== "normal").length;
  const slots = useMemo(
    () => Array.from(new Set(queue.map((item) => item.slot || "morning"))),
    [queue]
  );

  return (
    <Shell
      title="Doctor Workspace"
      subtitle={doctor ? `${doctor.name} · ${doctor.department}` : hospital?.name || "Choose a doctor"}
    >
      {!doctorId || !doctor ? (
        <div className="card" style={{ padding: 24 }}>
          <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 6 }}>Choose your profile</div>
          <p style={{ color: "var(--muted)", margin: "0 0 18px", fontSize: 13 }}>
            Select a doctor to view their patients and consultation queue.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 10 }}>
            {doctors.map((item) => (
              <button
                key={item.id}
                type="button"
                className="btn btn-secondary"
                style={{ textAlign: "left", justifyContent: "flex-start", padding: 14 }}
                onClick={() => setDoctorId(item.id)}
              >
                <span>
                  <strong style={{ display: "block" }}>{item.name}</strong>
                  <span style={{ display: "block", color: "var(--muted)", fontSize: 11, marginTop: 3 }}>
                    {item.department}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 18, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontSize: 26, fontWeight: 700 }}>{doctor.name}</div>
              <div style={{ color: "var(--muted)", fontSize: 13, marginTop: 3 }}>
                {doctor.department} · {hospital?.name}
              </div>
            </div>
            <Link href={`/room/${doctor.external_id}`} className="btn btn-primary">
              Open consultation room →
            </Link>
          </div>

          <div className="page-grid-stats">
            {[
              { label: "Now serving", value: current ? `#${current.token}` : "—", hint: current?.patient_name || "No active consultation" },
              { label: "Waiting", value: waiting.length, hint: "Across scheduled sessions" },
              { label: "Priority patients", value: priorityCount, hint: "Emergency, urgent or senior" },
              { label: "Status", value: doctor.is_on_break ? "Break" : doctor.is_live ? "Live" : "Offline", hint: doctor.active_slot ? slotShort(doctor.active_slot) : "No active session" },
            ].map((item) => (
              <div className="stat-card" key={item.label}>
                <div className="stat-label">{item.label}</div>
                <div className="stat-value" style={{ fontSize: 26 }}>{item.value}</div>
                <div className="stat-sub">{item.hint}</div>
              </div>
            ))}
          </div>

          {error && <div className="alert alert-error">{error}</div>}

          <div className="card" style={{ overflow: "hidden" }}>
            <div className="card-header">
              <span className="card-title">My patients</span>
              <span style={{ color: "var(--muted)", fontSize: 12 }}>
                {loading ? "Refreshing…" : `${queue.length} active`}
              </span>
            </div>
            {queue.length === 0 ? (
              <p style={{ padding: 24, color: "var(--muted)", margin: 0 }}>
                No active patients in your queue.
              </p>
            ) : (
              slots.map((slot) => (
                <div key={slot}>
                  <div style={{ padding: "9px 16px", background: "var(--surface-2)", borderBottom: "1px solid var(--border)", color: "var(--muted)", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em" }}>
                    {slotShort(slot)}
                  </div>
                  {queue.filter((item) => (item.slot || "morning") === slot).map((item) => (
                    <div
                      key={item.appointment_id}
                      style={{ display: "grid", gridTemplateColumns: "52px minmax(180px, 1fr) 130px 120px", gap: 12, alignItems: "center", padding: "13px 16px", borderBottom: "1px solid var(--border)" }}
                    >
                      <div className="queue-token">{item.token}</div>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>{item.patient_name}</div>
                        <div style={{ color: "var(--muted)", fontSize: 11, marginTop: 2 }}>
                          Age {item.age} · {item.age_band.replaceAll("_", " ")}
                        </div>
                      </div>
                      <span className={`badge ${
                        item.priority === "emergency" ? "badge-emergency"
                        : item.priority === "urgent" ? "badge-urgent"
                        : item.priority === "senior" ? "badge-senior"
                        : "badge-off"
                      }`}>
                        {PRIORITY_LABELS[item.priority || "normal"]}
                      </span>
                      <div style={{ textAlign: "right", fontSize: 12 }}>
                        <strong>{item.status === "in_progress" ? "In consultation" : item.status.replaceAll("_", " ")}</strong>
                        <div style={{ color: "var(--muted)", marginTop: 2 }}>
                          {item.eta_at ? new Date(item.eta_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "ETA paused"}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ))
            )}
          </div>
        </>
      )}
    </Shell>
  );
}
