"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Shell } from "@/components/Shell";
import { api, Doctor, Hospital, QueueItem } from "@/lib/api";
import { formatSlotsList, slotShort } from "@/lib/slots";

function fmt(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function DoctorCard({ doc, queue }: { doc: Doctor; queue: QueueItem[] }) {
  return (
    <div className="card" style={{ overflow: "hidden" }}>
      {/* Header */}
      <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontWeight: 600, fontSize: 14, color: "var(--ink)" }}>{doc.name}</span>
            <span className={doc.is_live ? "badge badge-live" : "badge badge-off"}>
              <span className={doc.is_live ? "dot-live" : "dot-off"} />
              {doc.is_live ? "Live" : "Offline"}
            </span>
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 3 }}>{doc.department}</div>
          {doc.avg_duration_sec && (
            <div style={{ fontSize: 11, color: "var(--muted-2)", marginTop: 2 }}>
              avg {Math.round(doc.avg_duration_sec / 60)} min · {doc.sample_count} samples
            </div>
          )}
          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>
            {formatSlotsList(doc.slots)}
            {doc.is_live && doc.active_slot ? ` · live: ${slotShort(doc.active_slot)}` : ""}
          </div>
        </div>
        <Link href={`/room/${doc.external_id}`} className="btn btn-secondary btn-sm" style={{ flexShrink: 0 }}>
          Room
        </Link>
      </div>

      {/* Queue */}
      <div style={{ padding: "10px 16px", display: "flex", flexDirection: "column", gap: 6 }}>
        {queue.length === 0 ? (
          <p style={{ fontSize: 12, color: "var(--muted-2)", textAlign: "center", padding: "8px 0" }}>No patients in queue</p>
        ) : (
          queue.slice(0, 5).map((q, i) => (
            <div key={q.appointment_id} className="queue-row">
              <div className="queue-token">{q.token}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                  <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{q.patient_name}</span>
                  {q.priority && q.priority !== "normal" && (
                    <span className={`badge ${
                      q.priority === "emergency" ? "badge-emergency" :
                      q.priority === "urgent" ? "badge-urgent" :
                      q.priority === "senior" ? "badge-senior" : "badge-off"
                    }`} style={{ fontSize: 10 }}>
                      {q.priority === "emergency" ? "EMG" : q.priority === "urgent" ? "URG" : "60+"}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 11, color: "var(--muted)" }}>{slotShort(q.slot)} · {q.age_band.replace(/_/g, " ")}{i === 0 && " · next up"}</div>
              </div>
              {doc.is_live && doc.active_slot === (q.slot || "morning")
                ? <span style={{ fontSize: 12, fontWeight: 600, color: "var(--accent)", flexShrink: 0 }}>{fmt(q.eta_at)}</span>
                : <span style={{ fontSize: 11, color: "var(--muted-2)", flexShrink: 0 }}>{doc.is_live ? slotShort(q.slot) : "offline"}</span>
              }
            </div>
          ))
        )}
        {queue.length > 5 && (
          <p style={{ fontSize: 11, color: "var(--muted)", textAlign: "center" }}>+{queue.length - 5} more patients</p>
        )}
      </div>
    </div>
  );
}

export default function OpdPage() {
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [queues, setQueues] = useState<Record<string, QueueItem[]>>({});

  useEffect(() => {
    api.hospitals().then((hs) => { setHospitals(hs); if (hs[0]) setSelectedId(hs[0].id); });
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    const load = async () => {
      const docs = await api.doctors(selectedId);
      setDoctors(docs);
      const q: Record<string, QueueItem[]> = {};
      await Promise.all(docs.map(async (d) => { q[d.external_id] = await api.queue(d.external_id); }));
      setQueues(q);
    };
    load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [selectedId]);

  const liveCount = doctors.filter((d) => d.is_live).length;
  const totalInQueue = Object.values(queues).reduce((s, q) => s + q.length, 0);
  const sel = hospitals.find((h) => h.id === selectedId);

  return (
    <Shell title="OPD Board" subtitle={sel ? `${sel.name} · ${sel.city}` : ""}>
      {/* Hospital tab bar */}
      <div style={{ marginBottom: 20, overflowX: "auto" }}>
        <div className="tab-bar" style={{ display: "inline-flex" }}>
          {hospitals.map((h) => (
            <button key={h.id} className={`tab-btn ${selectedId === h.id ? "active" : ""}`} onClick={() => setSelectedId(h.id)}>
              {h.name.replace("Quivora ", "")}
              <span style={{ opacity: 0.65, fontWeight: 400 }}> · {h.city}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Summary bar */}
      <div style={{ display: "flex", gap: 20, marginBottom: 20, flexWrap: "wrap" }}>
        <span style={{ fontSize: 13, color: "var(--muted)" }}>
          <strong style={{ color: liveCount > 0 ? "var(--ok)" : "var(--ink)" }}>{liveCount}</strong> of {doctors.length} doctors live
        </span>
        <span style={{ fontSize: 13, color: "var(--muted)" }}>
          <strong style={{ color: "var(--ink)" }}>{totalInQueue}</strong> patients in queue
        </span>
      </div>

      {/* Doctor grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 16 }}>
        {doctors.map((d) => (
          <DoctorCard key={d.external_id} doc={d} queue={queues[d.external_id] || []} />
        ))}
        {doctors.length === 0 && (
          <p style={{ color: "var(--muted)", fontSize: 14 }}>No doctors found for this hospital.</p>
        )}
      </div>
    </Shell>
  );
}
