"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { Shell } from "@/components/Shell";
import { DoctorLiveToggle } from "@/components/DoctorLiveToggle";
import { api, Appointment, Doctor, DoctorDaySchedule, QueueItem } from "@/lib/api";
import { formatAppointmentDate, localDateString } from "@/lib/dates";
import { slotShort } from "@/lib/slots";

const AGE_LABELS: Record<string, string> = {
  child_0_5: "0–5y", child_6_12: "6–12y", teen_13_17: "13–17y",
  adult_18_40: "18–40y", adult_41_60: "41–60y", senior_60_plus: "60+y",
};

const STATUS_LABELS: Record<string, string> = {
  scheduled: "Scheduled",
  checked_in: "Checked in",
  in_progress: "In progress",
  completed: "Completed",
  no_show: "No-show",
  cancelled: "Cancelled",
};

function statusBadgeClass(status: string) {
  if (status === "in_progress") return "badge badge-live";
  if (status === "checked_in") return "badge badge-info";
  if (status === "completed") return "badge badge-done";
  if (status === "no_show") return "badge badge-missed";
  if (status === "cancelled") return "badge badge-off";
  return "badge badge-off";
}

function occupancyFillClass(pct: number) {
  if (pct >= 90) return "room-occupancy-fill is-full";
  if (pct >= 70) return "room-occupancy-fill is-high";
  return "room-occupancy-fill";
}

export default function RoomPage() {
  const { slug } = useParams() as { slug: string };
  const [doctor, setDoctor] = useState<Doctor | null>(null);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [current, setCurrent] = useState<Appointment | null>(null);
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);
  const [viewSlot, setViewSlot] = useState<string>("");
  const [roomMode, setRoomMode] = useState<"live" | "schedule">("live");
  const [scheduleDate, setScheduleDate] = useState(localDateString);
  const [schedule, setSchedule] = useState<DoctorDaySchedule | null>(null);
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [scheduleError, setScheduleError] = useState("");

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

  const loadSchedule = useCallback(async () => {
    setScheduleLoading(true);
    setScheduleError("");
    try {
      const data = await api.doctorSchedule(slug, scheduleDate);
      setSchedule(data);
      const slots = doctor?.slots?.length ? doctor.slots : ["morning"];
      setViewSlot((prev) => {
        if (prev && slots.includes(prev)) return prev;
        return slots[0];
      });
    } catch (e) {
      setSchedule(null);
      setScheduleError(e instanceof Error ? e.message : "Could not load schedule");
    } finally {
      setScheduleLoading(false);
    }
  }, [slug, scheduleDate, doctor?.slots]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 4000);
    return () => clearInterval(t);
  }, [refresh]);

  useEffect(() => {
    if (roomMode !== "schedule") return;
    loadSchedule();
  }, [roomMode, loadSchedule]);

  const slots = doctor?.slots?.length ? doctor.slots : ["morning"];
  const slotQueue = useMemo(
    () => queue.filter((q) => (q.slot || "morning") === (viewSlot || slots[0])),
    [queue, viewSlot, slots]
  );
  const waiting = slotQueue.filter((q) => q.status !== "in_progress");
  const isLive = doctor?.is_live ?? false;
  const onBreak = doctor?.is_on_break ?? false;
  const viewingActiveSlot = isLive && doctor?.active_slot === viewSlot;

  const scheduleSlotSummary = schedule?.slots.find((s) => s.slot === viewSlot);
  const scheduleAppointments = useMemo(
    () => (schedule?.appointments ?? []).filter((a) => (a.slot || "morning") === (viewSlot || slots[0])),
    [schedule, viewSlot, slots]
  );

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

  const endConsult = async (mode: "next" | "break", id: number) => {
    if (!doctor?.is_live) { setMsg("Doctor must be live before recording events."); return; }
    setLoading(true); setMsg("");
    const event_type = mode === "break" ? "ended_and_break" : "ended_and_next";
    try {
      const appt = await api.event(id, event_type);
      const d = await api.doctor(slug);
      setDoctor(d);
      const q = await api.queue(slug);
      setQueue(q);
      const active = q.find((x) => x.status === "in_progress");
      setCurrent(active ? await api.appointment(active.appointment_id) : null);
      if (mode === "break") {
        setMsg(`Consult ended for #${appt.token} — on break. Patients notified.`);
      } else if (active) {
        setMsg(`Ended #${appt.token} — now serving #${active.token} (${active.patient_name}).`);
      } else {
        setMsg(`Ended #${appt.token} — no more patients waiting in this slot.`);
      }
      if (roomMode === "schedule") await loadSchedule();
    } catch (e) { setMsg(e instanceof Error ? e.message : "Error"); }
    finally { setLoading(false); }
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
      if (roomMode === "schedule") await loadSchedule();
    } catch (e) { setMsg(e instanceof Error ? e.message : "Error"); }
    finally { setLoading(false); }
  };

  return (
    <Shell
      title={doctor?.name ?? "Room"}
      subtitle={doctor ? doctor.department : ""}
    >
      {doctor && (
        <div className="room-toolbar">
          <div className="room-toolbar-meta">
            <DoctorLiveToggle
              externalId={slug}
              isLive={isLive}
              slots={slots}
              activeSlot={viewSlot || doctor.active_slot}
              size="md"
              disabled={loading}
              onChanged={(updated) => {
                setDoctor(updated);
                if (updated.active_slot) setViewSlot(updated.active_slot);
                setMsg(
                  updated.is_live
                    ? `Live for ${slotShort(updated.active_slot)} — ETAs active.`
                    : "Gone offline. Queue for this session cleared."
                );
                refresh();
              }}
              onError={setMsg}
            />
            {onBreak && <span className="badge badge-warn">On break</span>}
            {doctor.delay_buffer_sec > 0 && (
              <span className="badge badge-warn">
                +{Math.round(doctor.delay_buffer_sec / 60)}m late
              </span>
            )}
            <span>
              {doctor.avg_duration_sec ? `avg ${Math.round(doctor.avg_duration_sec / 60)} min` : "No samples"}
              {" · "}{doctor.sample_count} samples
            </span>
          </div>
          {isLive && roomMode === "live" && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button className="btn btn-secondary btn-sm" disabled={loading} onClick={toggleBreak}>
                {onBreak ? "End break" : "Start break"}
              </button>
              <button className="btn btn-secondary btn-sm" disabled={loading || onBreak} onClick={() => broadcastLate(15)}>
                +15 min late
              </button>
            </div>
          )}
        </div>
      )}

      <div className="room-mode-tabs tab-bar">
        <button
          className={`tab-btn ${roomMode === "live" ? "active" : ""}`}
          onClick={() => setRoomMode("live")}
        >
          Live queue
        </button>
        <button
          className={`tab-btn ${roomMode === "schedule" ? "active" : ""}`}
          onClick={() => setRoomMode("schedule")}
        >
          Day schedule
        </button>
      </div>

      {roomMode === "schedule" && (
        <>
          <div className="room-schedule-head">
            <div>
              <label className="input-label">Appointment date</label>
              <input
                type="date"
                className="input"
                value={scheduleDate}
                min={localDateString(-90)}
                max={localDateString(30)}
                onChange={(e) => setScheduleDate(e.target.value)}
                style={{ maxWidth: 220 }}
              />
              <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 6, marginBottom: 0 }}>
                {formatAppointmentDate(scheduleDate)} · occupancy based on avg consult time
              </p>
            </div>
            {schedule && (
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 28, fontWeight: 700, color: "var(--accent)", lineHeight: 1 }}>
                  {schedule.overall_occupancy_pct}%
                </div>
                <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
                  overall occupied
                </div>
              </div>
            )}
          </div>

          {scheduleLoading && (
            <p style={{ fontSize: 13, color: "var(--muted)", marginBottom: 16 }}>Loading schedule…</p>
          )}
          {scheduleError && (
            <div className="alert alert-warn" style={{ marginBottom: 16 }}>{scheduleError}</div>
          )}

          {schedule && !schedule.works_that_day && (
            <div className="alert alert-warn" style={{ marginBottom: 16 }}>
              You are not scheduled to work on {formatAppointmentDate(scheduleDate)}.
            </div>
          )}

          {schedule && (
            <>
              <div className="room-occupancy-grid">
                {schedule.slots.map((slot) => (
                  <div key={slot.slot} className="room-occupancy-card">
                    <div className="room-occupancy-label">
                      <span>{slotShort(slot.slot)}</span>
                      <span>{slot.occupancy_pct}%</span>
                    </div>
                    <div className="room-occupancy-bar">
                      <div
                        className={occupancyFillClass(slot.occupancy_pct)}
                        style={{ width: `${slot.occupancy_pct}%` }}
                      />
                    </div>
                    <div className="room-occupancy-meta">
                      {slot.active_count + slot.completed_count + slot.no_show_count} booked
                      {" · "}~{slot.estimated_capacity} capacity
                      <br />
                      {slot.active_count} active · {slot.completed_count} done · {slot.no_show_count} no-show
                    </div>
                  </div>
                ))}
              </div>

              <div className="room-schedule-summary">
                <span><strong>{schedule.total_appointments}</strong> appointments this day</span>
                {scheduleSlotSummary && (
                  <span>
                    {slotShort(viewSlot)}: {scheduleSlotSummary.active_count + scheduleSlotSummary.completed_count + scheduleSlotSummary.no_show_count} booked · {scheduleSlotSummary.occupancy_pct}% occupied
                  </span>
                )}
              </div>
            </>
          )}
        </>
      )}

      <div style={{ marginBottom: 16, overflowX: "auto" }}>
        <div className="tab-bar" style={{ display: "inline-flex" }}>
          {slots.map((s) => {
            const liveCount = queue.filter((q) => (q.slot || "morning") === s).length;
            const scheduleCount = schedule?.slots.find((slot) => slot.slot === s)?.total_count ?? 0;
            const count = roomMode === "schedule" ? scheduleCount : liveCount;
            return (
              <button key={s} className={`tab-btn ${viewSlot === s ? "active" : ""}`} onClick={() => setViewSlot(s)}>
                {slotShort(s)} ({count})
                {roomMode === "live" && isLive && doctor?.active_slot === s ? " · live" : ""}
              </button>
            );
          })}
        </div>
      </div>

      {roomMode === "live" && (
        <>
          {!viewingActiveSlot && doctor && (
            <div className="alert alert-warn" style={{ marginBottom: 16 }}>
              {isLive
                ? `Live for ${doctor.active_slot} — ETAs apply to that slot only. Viewing ${viewSlot}.`
                : "Offline — turn Live on above. ETA starts only for the active slot."}
            </div>
          )}

          <div className={`room-grid ${viewingActiveSlot ? "" : "room-dimmed"}`}>
            <div className="room-panel">
              <div className="room-panel-head">
                <h2 className="room-panel-title">Now serving · {slotShort(viewSlot)}</h2>
              </div>
              <div className="room-panel-body">
                {current && slotQueue.some((q) => q.appointment_id === current.id && q.status === "in_progress") ? (
                  <div>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 8 }}>
                      <span className="room-now-token">#{current.token}</span>
                      <span className="badge badge-off">{AGE_LABELS[current.age_band] ?? current.age_band}</span>
                    </div>
                    <div style={{ fontSize: 18, fontWeight: 600 }}>{current.patient_name}</div>
                    <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>Age {current.age} · {current.appointment_type} visit</div>
                    <div style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
                      {(current.status === "scheduled" || current.status === "checked_in") && (
                        <button className="btn btn-primary" disabled={loading} onClick={() => act("started", current.id)}>Start consult</button>
                      )}
                      {current.status === "in_progress" && (
                        <>
                          <button className="btn btn-primary" disabled={loading || onBreak} onClick={() => endConsult("next", current.id)}>
                            End consult &amp; next
                          </button>
                          <button className="btn btn-secondary" disabled={loading || onBreak} onClick={() => endConsult("break", current.id)}>
                            End consult &amp; break
                          </button>
                        </>
                      )}
                      <button className="btn btn-secondary" disabled={loading} onClick={() => act("no_show", current.id)}>No-show</button>
                    </div>
                  </div>
                ) : (
                  <p style={{ color: "var(--muted)", fontSize: 13, margin: 0 }}>No patient in room. Call someone from the queue.</p>
                )}
                {msg && (
                  <div style={{ marginTop: 16, padding: "8px 12px", background: "var(--surface-2)", borderRadius: 8, fontSize: 13, color: "var(--ink-2)" }}>{msg}</div>
                )}
              </div>
            </div>

            <div className="room-panel">
              <div className="room-panel-head">
                <h2 className="room-panel-title">{slotShort(viewSlot)} queue</h2>
                <span style={{ fontSize: 13, color: "var(--muted)" }}>{waiting.length} waiting</span>
              </div>
              <div style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: 6 }}>
                {waiting.length === 0 ? (
                  <p style={{ fontSize: 13, color: "var(--muted-2)", padding: "8px 0", margin: 0 }}>Queue empty</p>
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
                          Emer
                        </button>
                        <button className="btn btn-secondary btn-sm" disabled={loading} onClick={() => act("no_show", q.appointment_id)}>Skip</button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </>
      )}

      {roomMode === "schedule" && schedule && (
        <div className="room-panel">
          <div className="room-panel-head">
            <h2 className="room-panel-title">{slotShort(viewSlot)} appointments</h2>
            <span style={{ fontSize: 13, color: "var(--muted)" }}>{scheduleAppointments.length} listed</span>
          </div>
          <div style={{ padding: "12px 16px" }}>
            {scheduleAppointments.length === 0 ? (
              <p style={{ fontSize: 13, color: "var(--muted-2)", padding: "8px 0", margin: 0 }}>
                No appointments for {slotShort(viewSlot)} on {formatAppointmentDate(scheduleDate)}.
              </p>
            ) : (
              scheduleAppointments.map((appt) => (
                <div key={appt.id} className="room-schedule-row">
                  <div className="queue-token">{appt.token}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      {appt.patient_name}
                      <span style={{ fontSize: 11, color: "var(--muted)" }}>({AGE_LABELS[appt.age_band] ?? appt.age_band})</span>
                      <span className={statusBadgeClass(appt.status)}>{STATUS_LABELS[appt.status] ?? appt.status}</span>
                      {appt.priority && appt.priority !== "normal" && (
                        <span className={`badge ${
                          appt.priority === "emergency" ? "badge-emergency" :
                          appt.priority === "urgent" ? "badge-urgent" :
                          appt.priority === "senior" ? "badge-senior" : "badge-off"
                        }`}>
                          {appt.priority === "emergency" ? "Emergency" : appt.priority === "urgent" ? "Urgent" : "Senior"}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
                      {appt.appointment_type} visit
                      {appt.started_at ? ` · started ${new Date(appt.started_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""}
                      {appt.ended_at ? ` · ended ${new Date(appt.ended_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </Shell>
  );
}
