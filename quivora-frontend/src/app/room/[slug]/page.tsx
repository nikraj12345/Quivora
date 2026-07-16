"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { Shell } from "@/components/Shell";
import { api, Appointment, Doctor, QueueItem } from "@/lib/api";
import { slotShort } from "@/lib/slots";

const AGE_LABELS: Record<string, string> = {
  child_0_5: "0–5y", child_6_12: "6–12y", teen_13_17: "13–17y",
  adult_18_40: "18–40y", adult_41_60: "41–60y", senior_60_plus: "60+y",
};

export default function RoomPage() {
  const { slug } = useParams() as { slug: string };
  const [doctor, setDoctor] = useState<Doctor | null>(null);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [current, setCurrent] = useState<Appointment | null>(null);
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);
  const [viewSlot, setViewSlot] = useState<string>("");

  const refresh = useCallback(async () => {
    const d = await api.doctor(slug);
    setDoctor(d);
    const slots = d.slots?.length ? d.slots : ["morning"];
    setViewSlot((prev) => prev || d.active_slot || slots[0]);
    const q = await api.queue(slug);
    setQueue(q);
    const active = q.find((x) => x.status === "in_progress");
    setCurrent(active ? await api.appointment(active.appointment_id) : null);
  }, [slug]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 4000);
    return () => clearInterval(t);
  }, [refresh]);

  const slots = doctor?.slots?.length ? doctor.slots : ["morning"];
  const slotQueue = useMemo(
    () => queue.filter((q) => (q.slot || "morning") === (viewSlot || slots[0])),
    [queue, viewSlot, slots]
  );
  const waiting = slotQueue.filter((q) => q.status !== "in_progress");
  const isLive = doctor?.is_live ?? false;
  const onBreak = doctor?.is_on_break ?? false;
  const viewingActiveSlot = isLive && doctor?.active_slot === viewSlot;

  const goLiveForSlot = async (slot: string) => {
    setLoading(true);
    try {
      const updated = await api.goLive(slug, slot);
      setDoctor(updated);
      setViewSlot(slot);
      setMsg(`Live for ${slotShort(slot)} — ETAs active for this slot only.`);
      await refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Error");
    } finally {
      setLoading(false);
    }
  };

  const goOffline = async () => {
    setLoading(true);
    try {
      const updated = await api.goOffline(slug);
      setDoctor(updated);
      setMsg("Gone offline. Timings paused.");
      await refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Error");
    } finally {
      setLoading(false);
    }
  };

  const toggleBreak = async () => {
    setLoading(true); setMsg("");
    try {
      const updated = onBreak ? await api.endBreak(slug) : await api.startBreak(slug);
      setDoctor(updated);
      setMsg(onBreak ? "Break ended — queue resumed." : "On break — patients notified.");
      await refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Error");
    } finally {
      setLoading(false);
    }
  };

  const broadcastLate = async (minutes: number) => {
    setLoading(true); setMsg("");
    try {
      const updated = await api.runningLate(slug, minutes);
      setDoctor(updated);
      setMsg(`Running ${minutes} min late — all waiting patients notified.`);
      await refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Error");
    } finally {
      setLoading(false);
    }
  };

  const act = async (event_type: string, id: number) => {
    if (!doctor?.is_live) { setMsg("Doctor must be live before recording events."); return; }
    setLoading(true); setMsg("");
    try {
      const appt = await api.event(id, event_type);
      const labels: Record<string, string> = {
        checked_in: "Checked in", started: "Consult started",
        ended: "Consult ended — sample recorded", no_show: "Marked no-show",
        emergency_insert: "Emergency — moved to front",
      };
      setMsg(`${labels[event_type] ?? event_type} · token #${appt.token}`);
      await refresh();
    } catch (e) { setMsg(e instanceof Error ? e.message : "Error"); }
    finally { setLoading(false); }
  };

  return (
    <Shell
      title={doctor?.name ?? "Consultation Room"}
      subtitle={doctor ? `${doctor.department} · ${doctor.hospital_name}` : ""}
    >
      {doctor && (
        <div className="card" style={{ padding: "16px 20px", marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <span className={isLive ? "badge badge-live" : "badge badge-off"} style={{ fontSize: 13, padding: "4px 12px" }}>
                <span className={isLive ? "dot-live" : "dot-off"} />
                {onBreak
                  ? "On break"
                  : isLive
                    ? `Live · ${slotShort(doctor.active_slot)}`
                    : "Offline"}
              </span>
              {doctor.delay_buffer_sec > 0 && (
                <span className="badge badge-warn" style={{ fontSize: 12 }}>
                  +{Math.round(doctor.delay_buffer_sec / 60)}m late
                </span>
              )}
              <span style={{ fontSize: 13, color: "var(--muted)" }}>
                {doctor.avg_duration_sec ? `avg ${Math.round(doctor.avg_duration_sec / 60)} min` : "No samples"} · {doctor.sample_count} samples
              </span>
            </div>
            {isLive ? (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button className="btn btn-secondary" disabled={loading} onClick={toggleBreak}>
                  {onBreak ? "End break" : "Start break"}
                </button>
                <button className="btn btn-secondary" disabled={loading || onBreak} onClick={() => broadcastLate(15)}>
                  +15 min late
                </button>
                <button className="btn btn-secondary" disabled={loading} onClick={goOffline}>Go Offline</button>
              </div>
            ) : null}
          </div>

          {!isLive && (
            <div>
              <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>Go live for a session slot:</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {slots.map((s) => (
                  <button key={s} className="btn btn-primary btn-sm" disabled={loading} onClick={() => goLiveForSlot(s)}>
                    Start {slotShort(s)}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Slot tabs */}
      <div style={{ marginBottom: 16, overflowX: "auto" }}>
        <div className="tab-bar" style={{ display: "inline-flex" }}>
          {slots.map((s) => {
            const count = queue.filter((q) => (q.slot || "morning") === s).length;
            return (
              <button key={s} className={`tab-btn ${viewSlot === s ? "active" : ""}`} onClick={() => setViewSlot(s)}>
                {slotShort(s)} ({count})
                {isLive && doctor?.active_slot === s ? " ●" : ""}
              </button>
            );
          })}
        </div>
      </div>

      {!viewingActiveSlot && doctor && (
        <div style={{ padding: "12px 16px", background: "var(--warn-light)", border: "1px solid #fde68a", borderRadius: 10, marginBottom: 16, fontSize: 13, color: "var(--warn)" }}>
          {isLive
            ? `Doctor is live for ${doctor.active_slot} — ETAs only apply to that slot. Viewing ${viewSlot}.`
            : "Doctor is offline — pick a slot above to go live. ETA starts only for the active slot."}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, opacity: viewingActiveSlot ? 1 : 0.7, pointerEvents: viewingActiveSlot ? "auto" : "none" }}>
        <div className="card">
          <div className="card-header">
            <span className="card-title">Now serving · {viewSlot}</span>
          </div>
          <div style={{ padding: 20 }}>
            {current && slotQueue.some((q) => q.appointment_id === current.id && q.status === "in_progress") ? (
              <div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 8 }}>
                  <span style={{ fontSize: 48, fontWeight: 800, color: "var(--accent)", lineHeight: 1 }}>#{current.token}</span>
                  <span style={{ fontSize: 12, padding: "2px 8px", background: "var(--surface-2)", borderRadius: 6, color: "var(--muted)" }}>{AGE_LABELS[current.age_band] ?? current.age_band}</span>
                </div>
                <div style={{ fontSize: 18, fontWeight: 600 }}>{current.patient_name}</div>
                <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>Age {current.age} · {current.appointment_type} visit</div>
                <div style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
                  {(current.status === "scheduled" || current.status === "checked_in") && (
                    <button className="btn btn-primary" disabled={loading} onClick={() => act("started", current.id)}>Start consult</button>
                  )}
                  {current.status === "in_progress" && (
                    <button className="btn btn-primary" disabled={loading} onClick={() => act("ended", current.id)}>End consult</button>
                  )}
                  <button className="btn btn-secondary" disabled={loading} onClick={() => act("no_show", current.id)}>No-show</button>
                </div>
              </div>
            ) : (
              <p style={{ color: "var(--muted)", fontSize: 13 }}>No patient in room for this slot. Call someone from the queue.</p>
            )}
            {msg && (
              <div style={{ marginTop: 16, padding: "8px 12px", background: "var(--surface-2)", borderRadius: 8, fontSize: 13, color: "var(--ink-2)" }}>{msg}</div>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <span className="card-title">{slotShort(viewSlot)}</span>
            <span style={{ fontSize: 13, color: "var(--muted)" }}>{waiting.length} waiting</span>
          </div>
          <div style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: 6 }}>
            {waiting.length === 0 ? (
              <p style={{ fontSize: 13, color: "var(--muted-2)", padding: "8px 0" }}>Queue empty for this slot</p>
            ) : (
              waiting.map((q, idx) => (
                <div key={q.appointment_id} className="queue-row">
                  <div className="queue-token">{q.token}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      {q.patient_name}
                      <span style={{ fontSize: 11, color: "var(--muted)" }}>({AGE_LABELS[q.age_band] ?? q.age_band})</span>
                      {q.priority && q.priority !== "normal" && (
                        <span className={`badge ${
                          q.priority === "emergency" ? "badge-emergency" :
                          q.priority === "urgent" ? "badge-urgent" :
                          q.priority === "senior" ? "badge-senior" : "badge-off"
                        }`}>
                          {q.priority === "emergency" ? "Emergency" : q.priority === "urgent" ? "Urgent" : "Senior"}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
                      {q.priority_reason ? `${q.priority_reason} · ` : ""}
                      {viewingActiveSlot
                        ? `~${Math.round(q.predicted_duration_sec / 60)} min${q.eta_at ? ` · ETA ${new Date(q.eta_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""}`
                        : "ETA when this slot goes live"
                      }
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                    {idx === 0 && !slotQueue.some((x) => x.status === "in_progress") ? (
                      <button className="btn btn-primary btn-sm" disabled={loading} onClick={() => act("started", q.appointment_id)}>Call in</button>
                    ) : (
                      <button className="btn btn-secondary btn-sm" disabled={loading} onClick={() => act("checked_in", q.appointment_id)}>Check in</button>
                    )}
                    <button
                      className="btn btn-secondary btn-sm"
                      disabled={loading || q.priority === "emergency"}
                      title="Promote to Emergency"
                      onClick={() => act("emergency_insert", q.appointment_id)}
                    >
                      ⚡
                    </button>
                    <button className="btn btn-secondary btn-sm" disabled={loading} onClick={() => act("no_show", q.appointment_id)}>✗</button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </Shell>
  );
}
