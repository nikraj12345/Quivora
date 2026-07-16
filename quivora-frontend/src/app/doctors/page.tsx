"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Shell } from "@/components/Shell";
import { api, Doctor, Hospital } from "@/lib/api";
import { formatSlotsList, slotShort } from "@/lib/slots";

export default function DoctorsPage() {
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [doctors, setDoctors] = useState<Doctor[]>([]);

  useEffect(() => {
    api.hospitals().then((hs) => { setHospitals(hs); if (hs[0]) setSelectedId(hs[0].id); });
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    const load = () => api.doctors(selectedId).then(setDoctors);
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [selectedId]);

  const live = doctors.filter((d) => d.is_live).length;
  const sel = hospitals.find((h) => h.id === selectedId);

  return (
    <Shell title="Doctors" subtitle={sel ? `${sel.name} · ${sel.city}` : ""}>
      {/* Hospital tabs */}
      <div style={{ marginBottom: 20, overflowX: "auto" }}>
        <div className="tab-bar" style={{ display: "inline-flex" }}>
          {hospitals.map((h) => (
            <button key={h.id} className={`tab-btn ${selectedId === h.id ? "active" : ""}`} onClick={() => setSelectedId(h.id)}>
              {h.name.replace("Quivora ", "")}
            </button>
          ))}
        </div>
      </div>

      <div style={{ marginBottom: 12, fontSize: 13, color: "var(--muted)" }}>
        <strong style={{ color: live > 0 ? "var(--ok)" : "var(--ink-2)" }}>{live}</strong> live ·{" "}
        <strong style={{ color: "var(--ink-2)" }}>{doctors.length - live}</strong> offline
      </div>

      <div className="card" style={{ overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border)", background: "var(--surface-2)" }}>
              {["Doctor", "Department", "Slots", "Status", "Samples", "Avg consult", ""].map((h) => (
                <th key={h} style={{ padding: "10px 16px", textAlign: "left", fontWeight: 600, fontSize: 12, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.04em", whiteSpace: "nowrap" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {doctors.map((d) => (
              <tr key={d.id} style={{ borderBottom: "1px solid var(--border)" }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-2)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "")}>
                <td style={{ padding: "12px 16px", fontWeight: 600 }}>{d.name}</td>
                <td style={{ padding: "12px 16px", color: "var(--muted)" }}>{d.department}</td>
                <td style={{ padding: "12px 16px", color: "var(--ink-2)", fontSize: 12, maxWidth: 220 }}>
                  {formatSlotsList(d.slots)}
                  {d.is_live && d.active_slot ? (
                    <div style={{ color: "var(--ok)", marginTop: 2 }}>Live: {slotShort(d.active_slot)}</div>
                  ) : null}
                </td>
                <td style={{ padding: "12px 16px" }}>
                  <span className={d.is_live ? "badge badge-live" : "badge badge-off"}>
                    <span className={d.is_live ? "dot-live" : "dot-off"} />
                    {d.is_live ? "Live" : "Offline"}
                  </span>
                </td>
                <td style={{ padding: "12px 16px", color: "var(--ink-2)" }}>{d.sample_count.toLocaleString()}</td>
                <td style={{ padding: "12px 16px", color: "var(--ink-2)" }}>
                  {d.avg_duration_sec ? `${Math.round(d.avg_duration_sec / 60)} min` : "—"}
                </td>
                <td style={{ padding: "12px 16px" }}>
                  <Link href={`/room/${d.external_id}`} className="btn btn-secondary btn-sm">Room tablet</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Shell>
  );
}
