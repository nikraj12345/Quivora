"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Shell } from "@/components/Shell";
import { api, Eta } from "@/lib/api";

type State = "loading" | "waiting" | "next" | "in_progress" | "done" | "no_show";

function getState(eta: Eta): State {
  if (eta.status === "completed") return "done";
  if (eta.status === "no_show") return "no_show";
  if (eta.status === "in_progress") return "in_progress";
  if (eta.patients_ahead === 0 && eta.status !== "completed") return "next";
  return "waiting";
}

const STATE_CONFIG: Record<State, { label: string; color: string; bg: string; icon: string }> = {
  loading: { label: "Loading…", color: "var(--muted)", bg: "transparent", icon: "" },
  waiting: { label: "Waiting", color: "var(--accent)", bg: "rgba(13,122,122,0.06)", icon: "⏳" },
  next: { label: "You're next!", color: "var(--warn)", bg: "rgba(180,83,9,0.07)", icon: "🔔" },
  in_progress: { label: "In consultation", color: "var(--ok)", bg: "rgba(31,122,76,0.07)", icon: "🩺" },
  done: { label: "Consultation complete", color: "var(--ok)", bg: "rgba(31,122,76,0.07)", icon: "✓" },
  no_show: { label: "Marked no-show", color: "var(--muted)", bg: "transparent", icon: "✗" },
};

export default function PatientPage() {
  const params = useParams();
  const id = Number(params.appointmentId);
  const [eta, setEta] = useState<Eta | null>(null);
  const [prevAhead, setPrevAhead] = useState<number | null>(null);
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const e = await api.eta(id);
        setEta((prev) => {
          if (prev && prev.patients_ahead !== e.patients_ahead) {
            setPrevAhead(prev.patients_ahead);
            setFlash(true);
            setTimeout(() => setFlash(false), 1200);
          }
          return e;
        });
      } catch {
        // keep last known state
      }
    };
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [id]);

  const [remainingSec, setRemainingSec] = useState<number | null>(null);

  useEffect(() => {
    if (eta?.wait_seconds == null) return;
    setRemainingSec((prev) => {
      if (prev === null || Math.abs(prev - eta.wait_seconds) > 15) {
        return eta.wait_seconds;
      }
      return prev;
    });
  }, [eta?.wait_seconds]);

  useEffect(() => {
    if (remainingSec === null || remainingSec <= 0) return;
    const timer = setInterval(() => {
      setRemainingSec((prev) => (prev && prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [remainingSec]);

  if (!eta) {
    return (
      <Shell title="Your visit">
        <p className="text-[var(--muted)]">Loading…</p>
      </Shell>
    );
  }

  const state = getState(eta);
  const cfg = STATE_CONFIG[state];
  const etaTime = eta.eta_at
    ? new Date(eta.eta_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : null;

  const fmtCountdown = (sec: number | null) => {
    if (sec === null || sec < 0) return "--:--";
    if (sec === 0) return "00:00";
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  };

  return (
    <Shell title="Your visit">
      <div
        className="panel mx-auto max-w-md p-8 text-center transition-all"
        style={{ background: cfg.bg }}
      >
        {/* Token */}
        <p className="text-xs uppercase tracking-widest text-[var(--muted)]">Token</p>
        <p
          className="font-[family-name:var(--font-display)] text-7xl transition-colors"
          style={{ color: cfg.color }}
        >
          {eta.token}
        </p>
        <p className="mt-1 text-lg font-medium">{eta.patient_name}</p>
        <p className="text-sm text-[var(--muted)]">{eta.doctor_name}</p>

        {/* Status badge */}
        <div
          className="mx-auto mt-5 flex w-fit items-center gap-2 rounded-full px-4 py-1.5 text-sm font-semibold"
          style={{ background: cfg.color + "20", color: cfg.color }}
        >
          {cfg.icon} {cfg.label}
        </div>

        <hr className="my-6 border-[var(--line)]" />

        {/* State-specific content */}
        {state === "waiting" ? (
          <>
            {/* TOP: Real-time Countdown Timer */}
            <div className="ticket-countdown-box">
              <p className="ticket-label">Est. Waiting Time</p>
              <div className="ticket-countdown-timer">
                {fmtCountdown(remainingSec)}
              </div>
              <div className="ticket-metrics" style={{ marginTop: 12 }}>
                <div>
                  <p className={`ticket-metric-val ${flash ? "is-flash" : ""}`}>
                    {eta.patients_ahead}
                  </p>
                  <p className="ticket-hint">ahead of you</p>
                </div>
                <div>
                  <p className="ticket-metric-val">
                    {eta.wait_seconds > 0 ? `${Math.round(eta.wait_seconds / 60)} min` : "—"}
                  </p>
                  <p className="ticket-hint">total est. wait</p>
                </div>
              </div>
            </div>

            {prevAhead !== null && prevAhead > eta.patients_ahead && (
              <p className="ticket-moved">
                Queue moved — {prevAhead - eta.patients_ahead} called
              </p>
            )}

            {/* BOTTOM: Expected Turn Time */}
            <div className="ticket-eta" style={{ marginTop: 20 }}>
              <p className="ticket-label">Estimated Turn Time</p>
              <p className="ticket-eta-time">{etaTime || "—"}</p>
              {etaTime ? (
                <p className="ticket-hint">± {Math.round(eta.confidence_min)} min confidence window</p>
              ) : (
                <p className="ticket-hint">
                  Updates when doctor goes live
                </p>
              )}
            </div>
          </>
        ) : state === "next" ? (
          <>
            <p className="text-lg font-semibold text-[var(--warn)]">
              Please proceed to the consultation room now.
            </p>
            {etaTime ? (
              <p className="mt-2 text-sm text-[var(--muted)]">Expected around {etaTime}</p>
            ) : null}
          </>
        ) : state === "in_progress" ? (
          <p className="text-lg">Your consultation is in progress.</p>
        ) : state === "done" ? (
          <p className="text-lg font-medium text-[var(--ok)]">
            Your consultation is complete. Thank you.
          </p>
        ) : state === "no_show" ? (
          <p className="text-lg text-[var(--muted)]">
            You were marked as no-show. Please visit reception.
          </p>
        ) : null}

        <p className="mt-6 text-xs text-[var(--muted)]">
          Updates automatically every 5 seconds.
        </p>
      </div>
    </Shell>
  );
}
