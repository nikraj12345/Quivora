"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Shell } from "@/components/Shell";
import { DoctorLiveToggle } from "@/components/DoctorLiveToggle";
import { api, ReceptionBoard } from "@/lib/api";
import { useRole } from "@/lib/role";
import { formatWorkDaysList } from "@/lib/weekdays";
import { slotShort } from "@/lib/slots";

function initials(name: string) {
  const parts = name.replace(/^Dr\.?\s*/i, "").split(/\s+/);
  return ((parts[0]?.[0] || "") + (parts[1]?.[0] || "")).toUpperCase();
}

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
    <Shell title="Board" subtitle={board?.hospital_name || hospital?.name || undefined}>
      {!hid ? (
        <p className="empty-hint">Select a hospital from the top-right menu to open today’s board.</p>
      ) : (
        <>
          {error && <div className="alert alert-error">{error}</div>}

          {board && (
            <>
              <div className="board-hero">
                <div className="board-hero-stats">
                  <div>
                    <span className="board-hero-num">{board.summary.doctors_live}</span>
                    <span className="board-hero-label">live</span>
                  </div>
                  <div>
                    <span className="board-hero-num">{board.summary.patients_waiting}</span>
                    <span className="board-hero-label">waiting</span>
                  </div>
                  <div>
                    <span className="board-hero-num">{board.summary.doctors_on_break}</span>
                    <span className="board-hero-label">on break</span>
                  </div>
                </div>
                <Link
                  href={`/register?hospital=${board.hospital_id}&source=hospital`}
                  className="btn btn-primary"
                >
                  Register patient
                </Link>
              </div>

              <div className="board-toolbar">
                <div className="tab-bar">
                  {([
                    ["all", "All"],
                    ["live", "Live"],
                    ["waiting", "Has queue"],
                    ["offline", "Offline"],
                  ] as const).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      className={`tab-btn ${filter === key ? "active" : ""}`}
                      onClick={() => setFilter(key)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <span className="board-meta">Updates every 5s</span>
              </div>

              {byDept.map(([dept, docs]) => (
                <section key={dept} className="dept-block">
                  <div className="dept-header">
                    <h2>{dept}</h2>
                    <span>{docs.length}</span>
                  </div>
                  <div className="doctor-grid">
                    {docs.map((d) => (
                      <article
                        key={d.id}
                        className={`doctor-tile doctor-tile--${d.status}`}
                      >
                        <div className="doctor-tile-head">
                          <div className="doctor-avatar">{initials(d.name)}</div>
                          <div className="doctor-tile-info">
                            <h3 className="doctor-tile-name">{d.name}</h3>
                            <p className="doctor-tile-meta">
                              {formatWorkDaysList(d.work_days)}
                              {!d.works_today && " · off today"}
                            </p>
                          </div>
                          <DoctorLiveToggle
                            externalId={d.external_id}
                            isLive={d.is_live}
                            slots={d.slots}
                            activeSlot={d.active_slot}
                            onChanged={() => load()}
                            onError={setError}
                          />
                        </div>

                        <div className="doctor-tile-status">
                          {d.current_token != null ? (
                            <>Serving <strong>#{d.current_token}</strong> · {d.current_patient}</>
                          ) : d.is_live ? (
                            <>Room open · {slotShort(d.active_slot)} · {d.queue_active_slot} in queue</>
                          ) : (
                            <>{d.queue_total} waiting · {d.slots.map(slotShort).join(", ")}</>
                          )}
                          {d.longest_wait_min != null && d.longest_wait_min > 0 && (
                            <span className="wait-chip">{d.longest_wait_min}m wait</span>
                          )}
                        </div>

                        <div className="doctor-tile-actions">
                          <Link href={`/room/${d.external_id}`} className="btn btn-primary btn-sm">
                            Open room
                          </Link>
                          <Link
                            href={`/register?hospital=${board.hospital_id}&doctor=${encodeURIComponent(d.external_id)}`}
                            className="btn btn-ghost btn-sm"
                          >
                            Book
                          </Link>
                        </div>
                      </article>
                    ))}
                  </div>
                </section>
              ))}

              {doctors.length === 0 && (
                <p className="empty-hint">No doctors match this filter.</p>
              )}
            </>
          )}
        </>
      )}
    </Shell>
  );
}
