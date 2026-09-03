"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Shell } from "@/components/Shell";
import { api, ScanMachine, ScanQueueItem } from "@/lib/api";
import { useRole } from "@/lib/role";

const SCAN_LABELS: Record<string, { label: string; color: string }> = {
  mri:        { label: "MRI",        color: "#7c3aed" },
  ct:         { label: "CT",         color: "#0369a1" },
  xray:       { label: "X-Ray",      color: "#0f766e" },
  ultrasound: { label: "Ultrasound", color: "#b45309" },
  blood_test: { label: "Blood Test", color: "#be185d" },
};

function fmt(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function MachineCard({ machine, queue }: { machine: ScanMachine; queue: ScanQueueItem[] }) {
  const st = SCAN_LABELS[machine.scan_type] ?? { label: machine.scan_type, color: "var(--muted)" };
  return (
    <div className="card" style={{ overflow: "hidden" }}>
      <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontWeight: 600, fontSize: 14, color: "var(--ink)" }}>{machine.name}</span>
            <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 7px", borderRadius: 999, background: st.color + "18", color: st.color }}>
              {st.label}
            </span>
            <span className={machine.is_live ? "badge badge-live" : "badge badge-off"}>
              <span className={machine.is_live ? "dot-live" : "dot-off"} />
              {machine.is_live ? "Live" : "Offline"}
            </span>
          </div>
          {machine.avg_duration_sec && (
            <div style={{ fontSize: 11, color: "var(--muted-2)", marginTop: 4 }}>
              avg {Math.round(machine.avg_duration_sec / 60)} min · {machine.sample_count} samples
            </div>
          )}
        </div>
        <Link href={`/scans/${machine.external_id}`} className="btn btn-secondary btn-sm" style={{ flexShrink: 0 }}>
          Room
        </Link>
      </div>

      <div style={{ padding: "10px 16px", display: "flex", flexDirection: "column", gap: 6 }}>
        {queue.length === 0 ? (
          <p style={{ fontSize: 12, color: "var(--muted-2)", textAlign: "center", padding: "8px 0" }}>Queue empty</p>
        ) : (
          queue.slice(0, 4).map((q, i) => (
            <div key={q.appointment_id} className="queue-row">
              <div className="queue-token" style={{ background: st.color + "15", color: st.color }}>{q.token}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500 }}>{q.patient_name}</div>
                <div style={{ fontSize: 11, color: "var(--muted)" }}>{q.age_band.replace(/_/g, " ")}{i === 0 && " · next"}</div>
              </div>
              {machine.is_live ? (
                <span style={{ fontSize: 12, fontWeight: 600, color: st.color, flexShrink: 0 }}>{fmt(q.eta_at)}</span>
              ) : (
                <span style={{ fontSize: 11, color: "var(--muted-2)", flexShrink: 0 }}>offline</span>
              )}
            </div>
          ))
        )}
        {queue.length > 4 && <p style={{ fontSize: 11, color: "var(--muted)", textAlign: "center" }}>+{queue.length - 4} more</p>}
      </div>
    </div>
  );
}

export default function ScansPage() {
  const { hospital, hospitalId, setMode } = useRole();
  const [machines, setMachines] = useState<ScanMachine[]>([]);
  const [queues, setQueues] = useState<Record<string, ScanQueueItem[]>>({});
  const [selectedScanType, setSelectedScanType] = useState<string>("all");
  const selectedId = hospitalId || hospital?.id || null;

  useEffect(() => { setMode("hospital"); }, [setMode]);

  useEffect(() => {
    if (!selectedId) {
      setMachines([]);
      setQueues({});
      return;
    }
    setMachines([]);
    setQueues({});
    let cancelled = false;
    const load = async () => {
      try {
        const ms = await api.scanMachines(selectedId);
        const entries = await Promise.all(
          ms.map(async (m) => [m.external_id, await api.scanQueue(m.external_id)] as const)
        );
        if (cancelled) return;
        setMachines(ms);
        setQueues(Object.fromEntries(entries));
      } catch {
        if (!cancelled) {
          setMachines([]);
          setQueues({});
        }
      }
    };
    load();
    const t = setInterval(load, 8000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [selectedId]);

  const availableScanTypes = useMemo(() => {
    const set = new Set<string>();
    machines.forEach((m) => {
      if (m.scan_type) set.add(m.scan_type);
    });
    return Array.from(set);
  }, [machines]);

  const filteredMachines = useMemo(() => {
    if (selectedScanType === "all") return machines;
    return machines.filter((m) => m.scan_type === selectedScanType);
  }, [machines, selectedScanType]);

  const liveCount = filteredMachines.filter((m) => m.is_live).length;
  const totalWaiting = filteredMachines.reduce(
    (s, m) => s + (queues[m.external_id] ? queues[m.external_id].length : 0),
    0
  );

  // Group by scan type for display
  const scanTypes = useMemo(
    () => [...new Set(filteredMachines.map((m) => m.scan_type))],
    [filteredMachines]
  );

  return (
    <Shell title="Scan Diagonostics" subtitle={hospital ? `${hospital.name} · ${hospital.city}` : "Select a hospital"}>
      {/* Summary and Filter Bar */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, flexWrap: "wrap", gap: 16 }}>
        <div style={{ display: "flex", gap: 20, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: 13, color: "var(--muted)" }}>
            <strong style={{ color: liveCount > 0 ? "var(--ok)" : "var(--ink)" }}>{liveCount}</strong> of {filteredMachines.length} machines live
          </span>
          <span style={{ fontSize: 13, color: "var(--muted)" }}>
            <strong style={{ color: "var(--ink)" }}>{totalWaiting}</strong> patients waiting
          </span>
        </div>

        {/* Scan Type Filter Dropdown */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <label htmlFor="scan-type-filter" style={{ fontSize: 13, fontWeight: 500, color: "var(--muted)" }}>
            Scan Type:
          </label>
          <select
            id="scan-type-filter"
            className="input"
            value={selectedScanType}
            onChange={(e) => setSelectedScanType(e.target.value)}
            style={{ minWidth: 180, padding: "6px 12px", fontSize: 13 }}
          >
            <option value="all">All Scan Types ({machines.length})</option>
            {availableScanTypes.map((type) => {
              const label = SCAN_LABELS[type]?.label ?? type;
              const count = machines.filter((m) => m.scan_type === type).length;
              return (
                <option key={type} value={type}>
                  {label} ({count})
                </option>
              );
            })}
          </select>
        </div>
      </div>

      {/* Scan type sections */}
      {filteredMachines.length === 0 ? (
        <div style={{ textAlign: "center", padding: "40px 20px", color: "var(--muted)", background: "var(--surface)", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)" }}>
          No scan machines found for this scan type.
        </div>
      ) : (
        scanTypes.map((type) => {
          const typeMachines = filteredMachines.filter((m) => m.scan_type === type);
          const st = SCAN_LABELS[type] ?? { label: type, color: "var(--muted)" };
          return (
            <div key={type} style={{ marginBottom: 28 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                <span style={{ fontWeight: 600, fontSize: 13, color: st.color }}>{st.label}</span>
                <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
                <span style={{ fontSize: 12, color: "var(--muted)" }}>{typeMachines.length} machine{typeMachines.length !== 1 ? "s" : ""}</span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 14 }}>
                {typeMachines.map((m) => (
                  <MachineCard key={m.external_id} machine={m} queue={queues[m.external_id] || []} />
                ))}
              </div>
            </div>
          );
        })
      )}
    </Shell>
  );
}
