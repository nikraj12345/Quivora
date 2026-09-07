"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Shell } from "@/components/Shell";
import { DoctorLiveToggle } from "@/components/DoctorLiveToggle";
import { api, Department, Doctor, QueueItem } from "@/lib/api";
import { useRole } from "@/lib/role";
import { formatSlotsList, slotShort } from "@/lib/slots";

function fmt(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function DoctorCard({ doc, queue, onDoctorUpdated }: { doc: Doctor; queue: QueueItem[]; onDoctorUpdated?: (updated: Doctor) => void }) {
  const avgMin = doc.avg_duration_sec ? doc.avg_duration_sec / 60 : 15;
  const queueLen = queue.length;

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
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6, flexShrink: 0 }}>
          <DoctorLiveToggle
            externalId={doc.external_id}
            isLive={doc.is_live}
            slots={doc.slots}
            activeSlot={doc.active_slot}
            onChanged={(updated) => onDoctorUpdated?.(updated)}
          />
          <Link href={`/room/${doc.external_id}`} className="btn btn-secondary btn-sm">
            Room →
          </Link>
        </div>
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
  const { hospital, hospitalId, setMode } = useRole();
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [queues, setQueues] = useState<Record<string, QueueItem[]>>({});
  const [selectedDept, setSelectedDept] = useState<string>("all");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(6);
  const selectedId = hospitalId || hospital?.id || null;

  useEffect(() => { setMode("hospital"); }, [setMode]);

  // Load database departments list directly from hospital departments table
  useEffect(() => {
    if (!selectedId) {
      setDepartments([]);
      return;
    }
    api.departments(selectedId).then(setDepartments).catch(() => setDepartments([]));
  }, [selectedId]);

  useEffect(() => {
    if (!selectedId) {
      setDoctors([]);
      setQueues({});
      return;
    }
    let cancelled = false;
    const load = async () => {
      try {
        const docs = await api.doctors(selectedId, pageSize, page * pageSize);
        if (cancelled) return;
        setDoctors(docs);

        // Fetch queues ONLY for the doctors currently visible on this page!
        const entries = await Promise.all(
          docs.map(async (d): Promise<[string, QueueItem[]]> => [d.external_id, await api.queue(d.external_id)])
        );
        if (!cancelled) {
          setQueues(Object.fromEntries(entries));
        }
      } catch {
        if (!cancelled) {
          setDoctors([]);
          setQueues({});
        }
      }
    };
    load();
    const t = setInterval(load, 12000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [selectedId, page, pageSize]);

  const filteredDoctors = useMemo(() => {
    if (selectedDept === "all") return doctors;
    return doctors.filter((d) => d.department.toLowerCase() === selectedDept.toLowerCase());
  }, [doctors, selectedDept]);

  const liveCount = filteredDoctors.filter((d) => d.is_live).length;
  const totalInQueue = filteredDoctors.reduce(
    (s, d) => s + (queues[d.external_id] ? queues[d.external_id].length : 0),
    0
  );

  return (
    <Shell title="Doctor Management" subtitle={hospital ? `${hospital.name} · ${hospital.city}` : "Select a hospital"}>
      {/* Control & Summary bar */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, flexWrap: "wrap", gap: 16 }}>
        <div style={{ display: "flex", gap: 20, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: 13, color: "var(--muted)" }}>
            <strong style={{ color: liveCount > 0 ? "var(--ok)" : "var(--ink)" }}>{liveCount}</strong> of {filteredDoctors.length} doctors live
          </span>
          <span style={{ fontSize: 13, color: "var(--muted)" }}>
            <strong style={{ color: "var(--ink)" }}>{totalInQueue}</strong> patients in queue
          </span>
        </div>

        {/* Department Filter Dropdown - loaded directly from DB departments table */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <label htmlFor="dept-filter" style={{ fontSize: 13, fontWeight: 500, color: "var(--muted)" }}>
            Department:
          </label>
          <select
            id="dept-filter"
            className="input"
            value={selectedDept}
            onChange={(e) => setSelectedDept(e.target.value)}
            style={{ minWidth: 200, padding: "6px 12px", fontSize: 13 }}
          >
            <option value="all">All Departments</option>
            {departments.map((dept) => (
              <option key={dept.id} value={dept.name}>
                {dept.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Doctor grid */}
      {filteredDoctors.length === 0 ? (
        <div style={{ textAlign: "center", padding: "40px 20px", color: "var(--muted)", background: "var(--surface)", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)" }}>
          No doctors found on this page.
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 16 }}>
          {filteredDoctors.map((d) => (
            <DoctorCard
              key={d.external_id}
              doc={d}
              queue={queues[d.external_id] || []}
              onDoctorUpdated={(updated) => setDoctors((prev) => prev.map((x) => (x.id === updated.id ? updated : x)))}
            />
          ))}
        </div>
      )}

      {/* Pagination Controls with Page Selector */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 24, flexWrap: "wrap", gap: 12, borderTop: "1px solid var(--border)", paddingTop: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 13, color: "var(--muted)" }}>Per page:</span>
          <select
            className="input"
            style={{ padding: "4px 8px", fontSize: 13 }}
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value));
              setPage(0);
            }}
          >
            <option value={6}>6 doctors</option>
            <option value={12}>12 doctors</option>
            <option value={24}>24 doctors</option>
          </select>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button
            className="btn btn-secondary btn-sm"
            disabled={page === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
          >
            ← Previous
          </button>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
            <span>Page</span>
            <input
              type="number"
              min={1}
              className="input"
              style={{ width: 54, textAlign: "center", padding: "4px 6px", fontSize: 13 }}
              value={page + 1}
              onChange={(e) => {
                const val = parseInt(e.target.value, 10);
                if (!isNaN(val) && val >= 1) {
                  setPage(val - 1);
                }
              }}
            />
          </div>
          <button
            className="btn btn-secondary btn-sm"
            disabled={doctors.length < pageSize}
            onClick={() => setPage((p) => p + 1)}
          >
            Next →
          </button>
        </div>
      </div>
    </Shell>
  );
}
