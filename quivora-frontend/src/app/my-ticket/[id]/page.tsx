"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { api, Eta, ScanEta } from "@/lib/api";

type Phase = "waiting" | "next" | "in_progress" | "done" | "no_show";

function isPublicTicketRef(ref: string): boolean {
  return !/^\d+$/.test(ref);
}

function getPhase(eta: Eta | ScanEta): Phase {
  if (eta.status === "completed") return "done";
  if (eta.status === "no_show") return "no_show";
  if (eta.status === "in_progress") return "in_progress";
  if (eta.patients_ahead === 0) return "next";
  return "waiting";
}

function fmtTime(iso: string | null) {
  if (!iso) return null;
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function fmtMins(sec: number) {
  const m = Math.round(sec / 60);
  if (m < 1) return "< 1 min";
  return `${m} min`;
}

const PHASE_LABEL: Record<Phase, string> = {
  waiting: "Waiting",
  next: "You're next",
  in_progress: "In progress",
  done: "Complete",
  no_show: "No-show",
};

export default function MyTicketPage() {
  const { id } = useParams();
  const searchParams = useSearchParams();
  const ticketRef = String(id);
  const legacyScan = searchParams.get("scan") === "1";
  const isPublic = isPublicTicketRef(ticketRef);

  const [eta, setEta] = useState<Eta | ScanEta | null>(null);
  const [isScan, setIsScan] = useState(legacyScan);
  const [prevAhead, setPrevAhead] = useState<number | null>(null);
  const [queueFlash, setQueueFlash] = useState(false);
  const [pulsing, setPulsing] = useState(false);
  const [telegramBot, setTelegramBot] = useState<string | null>(null);
  const [smsEnabled, setSmsEnabled] = useState(false);
  const [smsProvider, setSmsProvider] = useState<string | null>(null);
  const [remainingSec, setRemainingSec] = useState<number | null>(null);
  const prevAheadRef = useRef<number | null>(null);

  useEffect(() => {
    if (eta?.wait_seconds == null) return;
    setRemainingSec((prev) => {
      // If we don't have a remaining count yet or backend value significantly shifted, update it
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

  useEffect(() => {
    api.health().then((h) => {
      setTelegramBot(h.telegram_bot_username ?? null);
      setSmsEnabled(Boolean(h.sms_enabled));
      setSmsProvider(h.sms_provider ?? null);
    });
  }, []);

  useEffect(() => {
    const load = async () => {
      try {
        let data: Eta | ScanEta;
        if (isPublic) {
          const ticket = await api.publicTicket(ticketRef);
          if (ticket.kind === "scan" && ticket.scan) {
            data = ticket.scan;
            setIsScan(true);
          } else if (ticket.opd) {
            data = ticket.opd;
            setIsScan(false);
          } else {
            return;
          }
        } else {
          data = legacyScan
            ? await api.scanEta(Number(ticketRef))
            : await api.eta(Number(ticketRef));
          setIsScan(legacyScan);
        }
        setEta((prev) => {
          if (prev && prev.patients_ahead !== data.patients_ahead) {
            setPrevAhead(prev.patients_ahead);
            setQueueFlash(true);
            setPulsing(true);
            setTimeout(() => setQueueFlash(false), 1500);
            setTimeout(() => setPulsing(false), 600);
          }
          prevAheadRef.current = data.patients_ahead;
          return data;
        });
      } catch {
        // keep last known state
      }
    };
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [ticketRef, isPublic, legacyScan]);

  if (!eta) {
    return (
      <div className="ticket-page">
        <p className="ticket-loading">Loading your ticket…</p>
      </div>
    );
  }

  const phase = getPhase(eta);
  const etaTime = fmtTime(eta.eta_at);
  const serviceName = isScan
    ? (eta as ScanEta).machine_name
    : (eta as Eta).doctor_name;
  const telegramStartRef = isPublic ? ticketRef : ticketRef;

  const fmtCountdown = (sec: number | null) => {
    if (sec === null || sec < 0) return "--:--";
    if (sec === 0) return "00:00";
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  };

  return (
    <div className={`ticket-page ticket-page--${phase}`}>
      <div className="ticket-card">
        <header className="ticket-head">
          <p className="ticket-eyebrow">{isScan ? "Scan ticket" : "OPD ticket"}</p>
          <p className="ticket-service">{serviceName}</p>
        </header>

        <div className="ticket-token-block">
          <p className="ticket-label">Your token</p>
          <p className={`ticket-token ${pulsing ? "is-pulse" : ""}`}>{eta.token}</p>
          <p className="ticket-patient">{eta.patient_name}</p>
          {!isScan && (
            <p className="ticket-serving">
              Now serving{" "}
              <strong>
                {(eta as Eta).current_token != null ? `#${(eta as Eta).current_token}` : "—"}
              </strong>
              {(eta as Eta).doctor_live === false && (
                <span> · doctor not live yet</span>
              )}
            </p>
          )}
        </div>

        <div className="ticket-phase">
          <span className={`ticket-phase-pill ticket-phase-pill--${phase}`}>
            {PHASE_LABEL[phase]}
          </span>
        </div>

        <div className="ticket-body">
          {phase === "waiting" && (
            <>
              {/* TOP SECTION: Countdown (MM:SS) + Est Wait & Patients Ahead */}
              <div className="ticket-countdown-box">
                <p className="ticket-label">Est. Waiting Time</p>
                <div className="ticket-countdown-timer">
                  {fmtCountdown(remainingSec)}
                </div>
                <div className="ticket-metrics" style={{ marginTop: 12 }}>
                  <div>
                    <p className={`ticket-metric-val ${queueFlash ? "is-flash" : ""}`}>
                      {eta.patients_ahead}
                    </p>
                    <p className="ticket-hint">ahead of you</p>
                  </div>
                  <div>
                    <p className="ticket-metric-val">
                      {eta.wait_seconds > 0 ? fmtMins(eta.wait_seconds) : "—"}
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

              {/* BOTTOM SECTION: Estimated Turn / Expected Time */}
              <div className="ticket-eta" style={{ marginTop: 20 }}>
                <p className="ticket-label">Estimated Turn Time</p>
                <p className="ticket-eta-time">{etaTime || "—"}</p>
                {etaTime ? (
                  <p className="ticket-hint">± {Math.round(eta.confidence_min)} min confidence window</p>
                ) : (
                  <p className="ticket-hint">
                    Updates when {isScan ? "machine" : "doctor"} goes live
                  </p>
                )}
              </div>

              <p className="ticket-live-note">Live updates every few seconds</p>
            </>
          )}

          {phase === "next" && (
            <div className="ticket-callout">
              <p className="ticket-callout-title">Please proceed now</p>
              <p className="ticket-hint">
                Go to the {isScan ? "scan room" : "consultation room"}.
                {etaTime ? ` Expected around ${etaTime}.` : ""}
              </p>
            </div>
          )}

          {phase === "in_progress" && (
            <div className="ticket-callout">
              <p className="ticket-callout-title">
                {isScan ? "Scan in progress" : "Consultation in progress"}
              </p>
              <p className="ticket-hint">You are currently being seen.</p>
            </div>
          )}

          {phase === "done" && (
            <div className="ticket-callout">
              <p className="ticket-callout-title">
                {isScan ? "Scan complete" : "Consultation complete"}
              </p>
              <p className="ticket-hint">Thank you for your visit.</p>
            </div>
          )}

          {phase === "no_show" && (
            <div className="ticket-callout">
              <p className="ticket-callout-title">Marked as no-show</p>
              <p className="ticket-hint">Please visit the reception desk.</p>
            </div>
          )}
        </div>

        {smsEnabled && phase === "waiting" && (
          <div className="ticket-foot-note">
            SMS updates are on
            {smsProvider === "log" ? " (demo mode — check API logs)" : " to your registered mobile"}.
            You&apos;ll get a text when you&apos;re next.
          </div>
        )}

        {telegramBot && phase === "waiting" && (
          <a
            className="ticket-telegram"
            href={`https://t.me/${telegramBot}?start=${telegramStartRef}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            <span>Get notified on Telegram</span>
            <small>Link your chat — we message you when you&apos;re next</small>
          </a>
        )}

        <footer className="ticket-footer">Updates automatically · Quivora</footer>
      </div>
    </div>
  );
}
