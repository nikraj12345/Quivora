"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Shell } from "@/components/Shell";
import { api, TrainStatus } from "@/lib/api";

function fmtSec(sec: number) {
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${m}m ${String(s).padStart(2, "0")}s`;
}
function fmtElapsed(sec: number) {
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
}

export default function TrainingPage() {
  const [status, setStatus] = useState<TrainStatus | null>(null);
  const [_jobId, setJobId] = useState<string | null>(null);
  const [phase, setPhase] = useState<"idle" | "running" | "done" | "failed">("idle");
  const [error, setError] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopTimers = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (pollRef.current) clearInterval(pollRef.current);
    timerRef.current = null; pollRef.current = null;
  }, []);

  useEffect(() => () => stopTimers(), [stopTimers]);

  const poll = useCallback(async (id: string) => {
    try {
      const s = await api.trainStatus(id);
      setStatus({ ...s });
      if (s.status === "completed") { setPhase("done"); stopTimers(); }
      else if (s.status === "failed") { setPhase("failed"); setError(s.error_message || "Training failed"); stopTimers(); }
    } catch (e) { setError(e instanceof Error ? e.message : "Status error"); setPhase("failed"); stopTimers(); }
  }, [stopTimers]);

  const start = async () => {
    setError(""); setStatus(null); setElapsed(0); setJobId(null); stopTimers();
    try {
      // Do NOT call full seed reset — that wipes live patient queues.
      // startTraining ensures doctors exist and only refreshes bootstrap samples.
      setPhase("running");
      const res = await api.startTraining(false);
      setJobId(res.job_id);
      timerRef.current = setInterval(() => setElapsed((e) => e + 1), 1000);
      await poll(res.job_id);
      pollRef.current = setInterval(() => poll(res.job_id), 700);
    } catch (e) { setError(e instanceof Error ? e.message : "Failed to start"); setPhase("failed"); stopTimers(); }
  };

  const running = phase === "running";
  const chips = status ? Object.entries(status.doctor_progress) : [];

  return (
    <Shell title="Model Training" subtitle="Bootstrap 100 consultations × 40 doctors">
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
        {/* Controls */}
        <div className="card" style={{ padding: 24 }}>
          <p style={{ fontSize: 13, color: "var(--muted)", marginBottom: 20, lineHeight: 1.6 }}>
            Seeds <strong>40 doctors</strong> across 5 hospitals with <strong>100 timing samples each</strong> (4,000 total).
            Age-band weighted averages — no ML required.
          </p>

          <button className="btn btn-primary" disabled={running} onClick={start}
            style={{ width: "100%", fontSize: 15, padding: "12px 20px" }}>
            {phase === "running" ? "Training in progress…" : phase === "done" ? "Run again" : "Start Training"}
          </button>

          {error && <p style={{ color: "var(--err)", fontSize: 13, marginTop: 8 }}>⚠ {error}</p>}

          {(phase === "running" || phase === "done") && (
            <div style={{ marginTop: 20 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>
                <span>Overall progress</span>
                <span>{status?.progress_pct.toFixed(1) ?? "0.0"}%</span>
              </div>
              <div className="progress-track">
                <div className="progress-fill" style={{ width: `${status?.progress_pct ?? 0}%` }} />
              </div>
              <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 8 }}>
                Elapsed {fmtElapsed(elapsed)} · {status?.samples_done ?? 0}/{status?.samples_total ?? "—"} samples ·{" "}
                {status?.doctors_done ?? 0}/{status?.doctors_total ?? 40} doctors
              </p>
            </div>
          )}

          {phase === "done" && (
            <div style={{ marginTop: 16 }}>
              <div style={{ padding: "10px 14px", background: "var(--ok-light)", borderRadius: 8, fontSize: 13, color: "var(--ok)", marginBottom: 12 }}>
                ✓ {status?.samples_total?.toLocaleString() ?? ""} samples recorded in {fmtElapsed(elapsed)}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <Link href="/opd" className="btn btn-primary" style={{ flex: 1, justifyContent: "center" }}>OPD Board →</Link>
                <Link href="/doctors" className="btn btn-secondary" style={{ flex: 1, justifyContent: "center" }}>Doctors →</Link>
              </div>
            </div>
          )}
        </div>

        {/* Current consult */}
        <div className="card" style={{ padding: 24 }}>
          <div style={{ fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--muted)", marginBottom: 12 }}>Current consult</div>
          {status && (phase === "running" || phase === "done") ? (
            <div>
              <div style={{ fontSize: 20, fontWeight: 700, color: "var(--ink)" }}>{status.current_doctor_name ?? "—"}</div>
              <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>{status.current_department ?? ""}</div>
              <div style={{ marginTop: 12, fontSize: 13 }}>
                Patient: <strong>{status.current_patient_name ?? "—"}</strong>
              </div>
              <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
                Consult {status.current_seq} / {status.consults_per_doctor}
              </div>
              {phase === "done" && (
                <div style={{ marginTop: 12, fontWeight: 600, color: "var(--ok)", fontSize: 13 }}>Training complete ✓</div>
              )}
            </div>
          ) : (
            <p style={{ color: "var(--muted)", fontSize: 13 }}>
              {phase === "running" ? "Learning doctor timings…" : "Press Start Training to begin. Live queues are kept intact."}
            </p>
          )}
        </div>
      </div>

      {/* Doctor chips */}
      {chips.length > 0 && (
        <div className="card" style={{ padding: 20, marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 14 }}>Doctor progress — {chips.length} doctors</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 10 }}>
            {chips.map(([ext, d]) => {
              const pct = d.total > 0 ? (d.done / d.total) * 100 : 0;
              const done = d.done >= d.total;
              return (
                <div key={ext} style={{ padding: "10px 12px", border: `1px solid ${done ? "var(--ok)" : "var(--border)"}`, borderRadius: 8, background: done ? "var(--ok-light)" : "var(--surface-2)" }}>
                  <div style={{ fontSize: 12, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.name}</div>
                  <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6 }}>{d.department}</div>
                  <div className="progress-track" style={{ height: 5 }}>
                    <div className="progress-fill" style={{ width: `${pct}%`, background: done ? "var(--ok)" : undefined }} />
                  </div>
                  <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>
                    {d.done}/{d.total}{d.avg_sec ? ` · ${fmtSec(Math.round(d.avg_sec))}` : ""}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Feed */}
      {(status?.recent_feed?.length ?? 0) > 0 && (
        <div className="card" style={{ padding: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>Live feed</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {status!.recent_feed.map((item, i) => (
              <div key={`${item.seq}-${i}`} className="feed-item" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid var(--border)", fontSize: 13 }}>
                <span>
                  <strong>{item.patient_name}</strong>
                  <span style={{ color: "var(--muted)" }}> ({item.age}y)</span>
                  <span style={{ color: "var(--muted)" }}> · {item.doctor_name}</span>
                </span>
                <span style={{ padding: "2px 8px", background: "var(--surface-2)", borderRadius: 999, fontSize: 12, flexShrink: 0, marginLeft: 12 }}>
                  {fmtSec(item.duration_sec)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Shell>
  );
}
