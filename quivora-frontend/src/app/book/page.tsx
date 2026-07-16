"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Shell } from "@/components/Shell";
import { api, Appointment, Doctor, QueueItem } from "@/lib/api";

function fmtEta(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function BookPage() {
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [doctorId, setDoctorId] = useState("");
  const [selectedDoc, setSelectedDoc] = useState<Doctor | null>(null);
  const [name, setName] = useState("");
  const [age, setAge] = useState(30);
  const [type, setType] = useState<"new" | "follow_up">("new");
  const [booked, setBooked] = useState<Appointment | null>(null);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [msg, setMsg] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // load doctors
  useEffect(() => {
    api.doctors().then((docs) => {
      setDoctors(docs);
      if (docs[0]) {
        setDoctorId(docs[0].external_id);
        setSelectedDoc(docs[0]);
      }
    });
  }, []);

  // live queue for selected doctor
  useEffect(() => {
    if (!selectedDoc) return;
    const load = () => api.queue(selectedDoc.external_id).then(setQueue).catch(() => {});
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [selectedDoc]);

  const onDoctorChange = (extId: string) => {
    setDoctorId(extId);
    setSelectedDoc(doctors.find((d) => d.external_id === extId) || null);
    setBooked(null);
    setMsg("");
  };

  const book = async () => {
    if (!name.trim()) { setMsg("Enter patient name"); return; }
    setSubmitting(true);
    setMsg("");
    try {
      const appt = await api.createAppointment({
        doctor_external_id: doctorId,
        patient_name: name.trim(),
        age,
        appointment_type: type,
      });
      setBooked(appt);
      setMsg(`Token #${appt.token} issued for ${appt.patient_name}`);
      setName("");
      if (selectedDoc) api.queue(selectedDoc.external_id).then(setQueue);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Booking failed");
    } finally {
      setSubmitting(false);
    }
  };

  const waiting = queue.filter((q) => q.status !== "completed" && q.status !== "no_show");

  return (
    <Shell title="Book appointment">
      <div className="grid gap-6 lg:grid-cols-[400px_1fr]">
        {/* Booking form */}
        <div className="panel p-6">
          <h2 className="font-[family-name:var(--font-display)] text-xl">New appointment</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Simulates a HIS push — token issued instantly.
          </p>

          <label className="mt-4 block text-sm font-medium">
            Doctor
            <select
              className="mt-1 w-full rounded-lg border border-[var(--line)] bg-white px-3 py-2 text-sm"
              value={doctorId}
              onChange={(e) => onDoctorChange(e.target.value)}
            >
              {doctors.map((d) => (
                <option key={d.id} value={d.external_id}>
                  {d.name} — {d.department}
                </option>
              ))}
            </select>
          </label>

          {selectedDoc?.avg_duration_sec ? (
            <p className="mt-1 text-xs text-[var(--muted)]">
              Avg consult: {Math.round(selectedDoc.avg_duration_sec / 60)} min ·{" "}
              {selectedDoc.sample_count} samples
            </p>
          ) : null}

          <label className="mt-3 block text-sm font-medium">
            Patient name
            <input
              className="mt-1 w-full rounded-lg border border-[var(--line)] bg-white px-3 py-2 text-sm"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Riya Sharma"
              onKeyDown={(e) => e.key === "Enter" && book()}
            />
          </label>

          <div className="mt-3 grid grid-cols-2 gap-3">
            <label className="block text-sm font-medium">
              Age
              <input
                type="number"
                min={0}
                max={120}
                className="mt-1 w-full rounded-lg border border-[var(--line)] bg-white px-3 py-2 text-sm"
                value={age}
                onChange={(e) => setAge(Number(e.target.value))}
              />
            </label>
            <label className="block text-sm font-medium">
              Visit type
              <select
                className="mt-1 w-full rounded-lg border border-[var(--line)] bg-white px-3 py-2 text-sm"
                value={type}
                onChange={(e) => setType(e.target.value as "new" | "follow_up")}
              >
                <option value="new">New patient</option>
                <option value="follow_up">Follow-up</option>
              </select>
            </label>
          </div>

          <button
            className="btn btn-primary mt-5 w-full"
            onClick={book}
            disabled={submitting}
          >
            {submitting ? "Booking…" : "Book & issue token"}
          </button>

          {msg ? (
            <p className="mt-3 rounded-lg bg-[var(--bg-2)] px-3 py-2 text-sm">{msg}</p>
          ) : null}

          {booked ? (
            <div className="mt-4 rounded-lg border border-[var(--accent)] bg-[rgba(13,122,122,0.06)] p-4 text-center">
              <p className="text-xs uppercase tracking-widest text-[var(--muted)]">Token issued</p>
              <p className="font-[family-name:var(--font-display)] text-5xl text-[var(--accent)]">
                #{booked.token}
              </p>
              <p className="mt-1 text-sm">{booked.patient_name}</p>
              <Link
                href={`/patient/${booked.id}`}
                className="btn btn-secondary mt-3 block w-full text-center text-sm"
              >
                View patient ETA →
              </Link>
            </div>
          ) : null}
        </div>

        {/* Live queue */}
        <div className="panel p-6">
          <div className="flex items-center justify-between">
            <h2 className="font-[family-name:var(--font-display)] text-xl">
              Live queue — {selectedDoc?.name ?? ""}
            </h2>
            <span className="rounded-full bg-[var(--bg-2)] px-3 py-1 text-xs">
              {waiting.length} waiting
            </span>
          </div>

          {waiting.length === 0 ? (
            <p className="mt-6 text-sm text-[var(--muted)]">Queue is empty — book the first appointment.</p>
          ) : (
            <ul className="mt-4 space-y-2">
              {waiting.map((q, idx) => (
                <li
                  key={q.appointment_id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-[var(--line)] bg-white/70 px-4 py-3 text-sm"
                  style={{
                    borderColor:
                      q.status === "in_progress" ? "var(--ok)" : "var(--line)",
                    background:
                      q.status === "in_progress"
                        ? "rgba(31,122,76,0.06)"
                        : "rgba(255,255,255,0.7)",
                  }}
                >
                    <div className="min-w-0">
                      <span className="font-bold">#{q.token}</span>{" "}
                      <span className="font-medium">{q.patient_name}</span>{" "}
                      <span className="text-xs text-[var(--muted)]">({q.age_band})</span>
                      {q.status === "in_progress" ? (
                        <span className="ml-2 rounded-full bg-[rgba(31,122,76,0.15)] px-2 py-0.5 text-xs text-[var(--ok)]">
                          In room
                        </span>
                      ) : null}
                      <p className="mt-0.5 text-xs text-[var(--muted)]">
                        {selectedDoc?.is_live
                          ? <>
                              ~{Math.round(q.predicted_duration_sec / 60)} min
                              {q.eta_at ? ` · ETA ${fmtEta(q.eta_at)}` : ""}
                              {idx === 0 && q.status !== "in_progress" ? " · next up" : ""}
                            </>
                          : "ETA available when doctor goes live"}
                      </p>
                    </div>
                  <Link
                    href={`/patient/${q.appointment_id}`}
                    className="shrink-0 text-xs text-[var(--accent)] underline"
                  >
                    ETA view
                  </Link>
                </li>
              ))}
            </ul>
          )}

          {selectedDoc ? (
            <div className="mt-4 text-right">
              <Link
                href={`/room/${selectedDoc.external_id}`}
                className="btn btn-secondary text-xs"
              >
                Open room tablet →
              </Link>
            </div>
          ) : null}
        </div>
      </div>
    </Shell>
  );
}
