"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Shell } from "@/components/Shell";
import { api, ReceptionBoard } from "@/lib/api";
import { useRole } from "@/lib/role";
import { formatWorkDaysList } from "@/lib/weekdays";
import { slotShort } from "@/lib/slots";

function initials(name: string) {
  const parts = name.replace(/^Dr\.?\s*/i, "").split(/\s+/);
  return (parts[0]?.[0] || "") + (parts[1]?.[0] || parts[0]?.[1] || "");
}

const STATUS_META: Record<string, { label: string; badge: string; tile: string }> = {
  live: { label: "Live", badge: "badge-live", tile: "doctor-tile--live" },
  break: { label: "On break", badge: "badge-warn", tile: "doctor-tile--break" },
  offline: { label: "Offline", badge: "badge-off", tile: "doctor-tile--offline" },
  unavailable: { label: "Unavailable", badge: "badge-off", tile: "doctor-tile--offline" },
};

export default function ReceptionBoardPage() {
  const { hospital, hospitalId, setMode } = useRole();
  const [board, setBoard] = useState<ReceptionBoard | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<"all" | "live" | "waiting" | "offline">("all");

  const hid = hospitalId || hospital?.id;

  const load = useCallback(async () => {
    if (!hid) return;
    try {
      const data = await api.receptionBoard(hid);
      setBoard(data);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load board");
    }
  }, [hid]);

  useEffect(() => { setMode("hospital"); }, [setMode]);

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  const doctors = useMemo(() => {
    if (!board) return [];
    if (filter === "live") return board.doctors.filter((d) => d.status === "live" || d.status === "break");
    if (filter === "waiting") return board.doctors.filter((d) => d.queue_total > 0);
    if (filter === "offline") return board.doctors.filter((d) => d.status === "offline" || d.status === "unavailable");
    return board.doctors;
  }, [board, filter]);

  const byDept = useMemo(() => {
    const map = new Map<string, typeof doctors>();
    for (const d of doctors) {
      const list = map.get(d.department) || [];
      list.push(d);
      map.set(d.department, list);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [doctors]);

  return (
    <Shell title="Today's board" subtitle={board?.hospital_name || hospital?.name || "Reception"}>
      {!hid ? (
        <div className="card" style={{ padding: 32 }}>
          <p style={{ color: "var(--muted)", margin: 0 }}>Select a hospital from the top-right switcher.</p>
        </div>
      ) : (
        <>
          {error && <div className="alert alert-error">{error}</div>}

          {board && (
            <>
              <div className="page-grid-stats">
                {[
                  { label: "Doctors", value: board.summary.doctors_total },
                  { label: "Live now", value: board.summary.doctors_live, cls: "stat-card--live" },
                  { label: "On break", value: board.summary.doctors_on_break, cls: "stat-card--warn" },
                  { label: "Waiting", value: board.summary.patients_waiting },
                ].map((s) => (
                  <div key={s.label} className={`stat-card ${s.cls || ""}`}>
                    <div className="stat-label">{s.label}</div>
                    <div className="stat-value" style={s.cls === "stat-card--live" ? { color: "var(--ok)" } : undefined}>
                      {s.value}
                    </div>
                  </div>
                ))}
              </div>

              <div className="board-toolbar">
                <div className="tab-bar">
                  {([
                    ["all", "All"],
                    ["live", "Live"],
                    ["waiting", "Has queue"],
                    ["offline", "Offline"],
                  ] as const).map(([key, label]) => (
                    <button key={key} type="button" className={`tab-btn ${filter === key ? "active" : ""}`} onClick={() => setFilter(key)}>
                      {label}
                    </button>
                  ))}
                </div>
                <div className="board-meta">
                  <span className="pulse" />
                  Live · refreshes every 5s · {new Date(board.generated_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </div>
              </div>

              {byDept.map(([dept, docs]) => (
                <div key={dept} className="dept-block">
                  <div className="dept-header">
                    <h3>{dept}</h3>
                    <span>{docs.length} doctor{docs.length !== 1 ? "s" : ""}</span>
                  </div>
                  <div className="doctor-grid">
                    {docs.map((d) => {
                      const meta = STATUS_META[d.status] || STATUS_META.offline;
                      return (
                        <div key={d.id} className={`doctor-tile ${meta.tile}`}>
                          <div className="doctor-tile-head">
                            <div className="doctor-avatar">{initials(d.name)}</div>
                            <div className="doctor-tile-info">
                              <div className="doctor-tile-name">{d.name}</div>
                              <div className="doctor-tile-meta">
                                {formatWorkDaysList(d.work_days)}
                                {!d.works_today && <span style={{ color: "var(--warn)" }}> · off today</span>}
                              </div>
                            </div>
                            <span className={`badge ${meta.badge}`}>{meta.label}</span>
                          </div>

                          <div className="metric-row">
                            <div className="metric-box">
                              <div className="metric-box-label">In queue</div>
                              <div className="metric-box-value">
                                {d.queue_total}
                                {d.is_live && (
                                  <span style={{ fontSize: 11, fontWeight: 500, color: "var(--muted)", marginLeft: 4 }}>
                                    ({d.queue_active_slot} active)
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className="metric-box">
                              <div className="metric-box-label">Longest wait</div>
                              <div className={`metric-box-value ${(d.longest_wait_min ?? 0) > 30 ? "metric-box-value--warn" : ""}`}>
                                {d.longest_wait_min != null ? `${d.longest_wait_min}m` : "—"}
                              </div>
                            </div>
                          </div>

                          <div className="doctor-tile-status">
                            {d.current_token != null ? (
                              <>Now serving <strong>#{d.current_token}</strong> · {d.current_patient}</>
                            ) : d.is_live ? (
                              <span style={{ color: "var(--muted)" }}>Room empty · {slotShort(d.active_slot)}</span>
                            ) : (
                              <span style={{ color: "var(--muted)" }}>Not started · {d.slots.map(slotShort).join(", ")}</span>
                            )}
                            {d.delay_buffer_sec > 0 && (
                              <div style={{ marginTop: 6, color: "var(--warn)", fontSize: 11 }}>
                                ~{Math.round(d.delay_buffer_sec / 60)} min behind schedule
                              </div>
                            )}
                          </div>

                          <div className="doctor-tile-actions">
                            <Link href={`/room/${d.external_id}`} className="btn btn-primary btn-sm">Room</Link>
                            <Link
                              href={`/register?hospital=${board.hospital_id}&doctor=${encodeURIComponent(d.external_id)}`}
                              className="btn btn-secondary btn-sm"
                            >
                              Register
                            </Link>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}

              {doctors.length === 0 && (
                <div className="card" style={{ padding: 48, textAlign: "center", color: "var(--muted)" }}>
                  No doctors match this filter.
                </div>
              )}
            </>
          )}
        </>
      )}
    </Shell>
  );
}
