"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Shell } from "@/components/Shell";
import { LiveBadge } from "@/components/LiveBadge";
import { api, ScanAppointment, ScanMachine, ScanQueueItem } from "@/lib/api";

const SCAN_LABELS: Record<string, string> = {
  mri: "MRI", ct: "CT", xray: "X-Ray", ultrasound: "Ultrasound", blood_test: "Blood Test",
};

function announceScanPatient(token: number, patientName: string, machineName?: string) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const text = `Token number ${token}, ${patientName}, please proceed to ${machineName || "the scan room"}.`;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 0.9;
  utterance.pitch = 1.0;
  window.speechSynthesis.speak(utterance);
}

export default function ScanRoomPage() {
  const params = useParams();
  const slug = params.slug as string;

  const [machine, setMachine] = useState<ScanMachine | null>(null);
  const [queue, setQueue] = useState<ScanQueueItem[]>([]);
  const [current, setCurrent] = useState<ScanAppointment | null>(null);
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);

  // Book form
  const [patientName, setPatientName] = useState("");
  const [age, setAge] = useState(30);
  const [showBook, setShowBook] = useState(false);

  const refresh = useCallback(async () => {
    const m = await api.scanMachine(slug);
    setMachine(m);
    const q = await api.scanQueue(slug);
    setQueue(q);
    const inProgress = q.find((x) => x.status === "in_progress");
    setCurrent(inProgress ? { id: inProgress.appointment_id, public_token: "", external_id: "", machine_id: m.id, machine_name: m.name, scan_type: m.scan_type, patient_name: inProgress.patient_name, token: inProgress.token, age: inProgress.age, age_band: inProgress.age_band, status: inProgress.status } : null);
  }, [slug]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 4000);
    return () => clearInterval(t);
  }, [refresh]);

  const toggleLive = async () => {
    if (!machine) return;
    setLoading(true);
    try {
      const updated = machine.is_live
        ? await api.scanGoOffline(slug)
        : await api.scanGoLive(slug);
      setMachine(updated);
      setMsg(updated.is_live ? "Session started — scan timings are now live." : "Gone offline. Timings paused.");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Error");
    } finally {
      setLoading(false);
    }
  };

  const act = async (event_type: string, id: number) => {
    if (!machine?.is_live) {
      setMsg("Machine must be live before recording events.");
      return;
    }
    setLoading(true);
    setMsg("");
    try {
      const appt = await api.scanEvent(id, event_type);
      const labels: Record<string, string> = {
        arrived: "Patient arrived",
        scan_started: "Scan started",
        scan_ended: "Scan complete — sample recorded",
        no_show: "Marked no-show",
      };
      setMsg(`${labels[event_type] ?? event_type} · token #${appt.token}`);

      if (event_type === "scan_started") {
        const targetPatient = queue.find((q) => q.appointment_id === id);
        if (targetPatient) {
          announceScanPatient(targetPatient.token, targetPatient.patient_name, machine.name);
        }
      }

      await refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Error");
    } finally {
      setLoading(false);
    }
  };

  const book = async () => {
    if (!machine) return;
    setLoading(true);
    try {
      const appt = await api.createScanAppointment({
        machine_external_id: machine.external_id,
        patient_name: patientName || "Walk-in patient",
        age,
      });
      setMsg(`Token #${appt.token} issued for ${appt.patient_name}`);
      setPatientName("");
      setShowBook(false);
      await refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Error");
    } finally {
      setLoading(false);
    }
  };

  const isLive = machine?.is_live ?? false;
  const waiting = queue.filter((q) => q.status !== "in_progress");

  return (
    <Shell title={machine ? `${machine.name} — operator` : "Scan room"}>
      {machine ? (
        <div className="panel mb-6 flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-3 flex-wrap">
              <h2 className="font-[family-name:var(--font-display)] text-2xl">{machine.name}</h2>
              <span className="rounded-full bg-[var(--bg-2)] px-2 py-1 text-xs font-medium text-[var(--muted)]">
                {SCAN_LABELS[machine.scan_type] ?? machine.scan_type}
              </span>
              <LiveBadge isLive={machine.is_live} liveAt={machine.went_live_at} />
            </div>
            <p className="mt-1 text-sm text-[var(--muted)]">
              {machine.sample_count} samples
              {machine.avg_duration_sec ? ` · avg ${Math.round(machine.avg_duration_sec / 60)} min/scan` : ""}
            </p>
          </div>
          <button
            className={`btn text-sm ${isLive ? "btn-secondary" : "btn-primary"}`}
            disabled={loading}
            onClick={toggleLive}
          >
            {isLive ? "Go Offline" : "Go Live"}
          </button>
        </div>
      ) : null}

      {machine && !isLive ? (
        <div className="mb-6 rounded-xl border border-[var(--line)] bg-[var(--panel)] p-5 text-center text-[var(--muted)]">
          <p className="text-lg font-medium">Machine is offline</p>
          <p className="mt-1 text-sm">Press <strong>Go Live</strong> to start accepting scans and ETA calculations.</p>
        </div>
      ) : null}

      <div className={`grid gap-6 md:grid-cols-2 transition-opacity ${!isLive ? "pointer-events-none opacity-40" : ""}`}>
        {/* Now scanning */}
        <div className="panel p-6">
          <h2 className="font-[family-name:var(--font-display)] text-xl">Now scanning</h2>
          {current ? (
            <div className="mt-4">
              <div className="flex items-baseline gap-3">
                <span className="font-[family-name:var(--font-display)] text-4xl text-[var(--accent)]">
                  #{current.token}
                </span>
              </div>
              <p className="mt-2 text-xl font-semibold">{current.patient_name}</p>
              <p className="text-sm text-[var(--muted)]">Age {current.age} · {current.age_band.replace(/_/g, " ")}</p>
              <div className="mt-5 flex flex-wrap gap-2">
                {current.status === "in_progress" ? (
                  <button className="btn btn-primary" disabled={loading} onClick={() => act("scan_ended", current.id)}>
                    Scan complete
                  </button>
                ) : (
                  <button className="btn btn-primary" disabled={loading} onClick={() => act("scan_started", current.id)}>
                    Start scan
                  </button>
                )}
                <button className="btn btn-secondary" disabled={loading} onClick={() => act("no_show", current.id)}>
                  No-show
                </button>
              </div>
            </div>
          ) : (
            <p className="mt-4 text-[var(--muted)]">No patient in scan. Call someone from the queue →</p>
          )}
          {msg ? <p className="mt-4 rounded-lg bg-[var(--bg-2)] px-3 py-2 text-sm">{msg}</p> : null}
        </div>

        {/* Waiting queue */}
        <div className="panel p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-[family-name:var(--font-display)] text-xl">Waiting ({waiting.length})</h2>
            <button className="btn btn-secondary text-xs" onClick={() => setShowBook((b) => !b)}>
              {showBook ? "Cancel" : "+ Add patient"}
            </button>
          </div>

          {showBook && (
            <div className="mb-4 rounded-xl border border-[var(--line)] bg-white/80 p-4 space-y-3">
              <label className="block text-sm">
                Patient name
                <input
                  className="mt-1 w-full rounded-lg border border-[var(--line)] bg-white px-3 py-2 text-sm"
                  value={patientName}
                  onChange={(e) => setPatientName(e.target.value)}
                  placeholder="e.g. Priya Sharma"
                />
              </label>
              <label className="block text-sm">
                Age
                <input
                  type="number"
                  className="mt-1 w-full rounded-lg border border-[var(--line)] bg-white px-3 py-2 text-sm"
                  value={age}
                  onChange={(e) => setAge(Number(e.target.value))}
                />
              </label>
              <button className="btn btn-primary text-sm w-full" disabled={loading} onClick={book}>
                Issue token
              </button>
            </div>
          )}

          {waiting.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">Queue empty</p>
          ) : (
            <ul className="space-y-2">
              {waiting.map((q, idx) => (
                <li key={q.appointment_id} className="rounded-lg border border-[var(--line)] bg-white/70 px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <span className="font-semibold">#{q.token}</span>{" "}
                      <span>{q.patient_name}</span>
                      <p className="mt-0.5 text-xs text-[var(--muted)]">
                        {isLive && q.predicted_duration_sec
                          ? `~${Math.round(q.predicted_duration_sec / 60)} min${q.eta_at ? ` · ETA ${new Date(q.eta_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""}`
                          : "ETA starts when machine goes live"}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap:1 gap-1">
                      <button
                        className="btn btn-ghost text-xs"
                        disabled={loading}
                        title="Voice Callout Patient Name"
                        onClick={() => announceScanPatient(q.token, q.patient_name, machine?.name)}
                      >
                        🔊
                      </button>
                      {q.status === "scheduled" && (
                        <button className="btn btn-secondary text-xs" disabled={loading} onClick={() => act("arrived", q.appointment_id)}>
                          Arrived
                        </button>
                      )}
                      {(q.status === "arrived" || (idx === 0 && !current)) && (
                        <button className="btn btn-primary text-xs" disabled={loading} onClick={() => act("scan_started", q.appointment_id)}>
                          Start
                        </button>
                      )}
                      <button className="btn btn-secondary text-xs" disabled={loading} onClick={() => act("no_show", q.appointment_id)}>✗</button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Shell>
  );
}
