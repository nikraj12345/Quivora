"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { api, Eta, ScanEta } from "@/lib/api";

// useRef is imported but only the variable matters — suppress lint
void useRef;

type Phase = "waiting" | "next" | "in_progress" | "done" | "no_show";

function getPhase(eta: Eta | ScanEta, _isScan: boolean): Phase {
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

const PHASE_CONFIG = {
  waiting:     { color: "#0d7a7a", bg: "#f0f9f9", label: "Waiting",           icon: "⏳" },
  next:        { color: "#b45309", bg: "#fffbeb", label: "You're next!",       icon: "🔔" },
  in_progress: { color: "#1f7a4c", bg: "#f0faf4", label: "In progress",        icon: "🩺" },
  done:        { color: "#1f7a4c", bg: "#f0faf4", label: "Complete",           icon: "✓"  },
  no_show:     { color: "#6b7280", bg: "#f9fafb", label: "Marked no-show",     icon: "✗"  },
};

export default function MyTicketPage() {
  const { id } = useParams();
  const searchParams = useSearchParams();
  const isScan = searchParams.get("scan") === "1";

  const [eta, setEta] = useState<Eta | ScanEta | null>(null);
  const [prevAhead, setPrevAhead] = useState<number | null>(null);
  const [queueFlash, setQueueFlash] = useState(false);
  const [pulsing, setPulsing] = useState(false);
  const [telegramBot, setTelegramBot] = useState<string | null>(null);
  const prevAheadRef = useRef<number | null>(null);

  useEffect(() => {
    api.health().then((h) => setTelegramBot(h.telegram_bot_username ?? null));
  }, []);

  useEffect(() => {
    const load = async () => {
      try {
        const data = isScan
          ? await api.scanEta(Number(id))
          : await api.eta(Number(id));
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
  }, [id, isScan]);

  if (!eta) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f0f9f9]">
        <div className="text-center text-[#0d7a7a]">
          <div className="text-4xl">⏳</div>
          <p className="mt-2 text-sm">Loading your ticket…</p>
        </div>
      </div>
    );
  }

  const phase = getPhase(eta, isScan);
  const cfg = PHASE_CONFIG[phase];
  const etaTime = fmtTime(eta.eta_at);
  const serviceName = isScan
    ? (eta as ScanEta).machine_name
    : (eta as Eta).doctor_name;

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-4 py-8 transition-colors"
      style={{ background: cfg.bg }}
    >
      {/* Phone-frame feel */}
      <div
        className="w-full max-w-sm rounded-3xl shadow-2xl overflow-hidden"
        style={{ background: "white" }}
      >
        {/* Header bar */}
        <div
          className="px-6 py-5 text-center text-white"
          style={{ background: cfg.color }}
        >
          <p className="text-xs font-semibold uppercase tracking-widest opacity-80">
            {isScan ? "Scan Ticket" : "OPD Ticket"}
          </p>
          <p className="mt-0.5 text-sm opacity-90">{serviceName}</p>
        </div>

        {/* Token */}
        <div className="px-6 pt-8 pb-4 text-center border-b border-gray-100">
          <p className="text-xs uppercase tracking-widest text-gray-400">Your Token</p>
          <p
            className="font-bold leading-none transition-transform"
            style={{
              fontSize: "7rem",
              color: cfg.color,
              transform: pulsing ? "scale(1.08)" : "scale(1)",
              transition: "transform 0.3s ease",
            }}
          >
            {eta.token}
          </p>
          <p className="text-base font-semibold text-gray-800">{eta.patient_name}</p>
        </div>

        {/* Status badge */}
        <div className="flex justify-center px-6 pt-5">
          <div
            className="flex items-center gap-2 rounded-full px-5 py-2 text-sm font-bold"
            style={{ background: cfg.color + "18", color: cfg.color }}
          >
            <span>{cfg.icon}</span> {cfg.label}
          </div>
        </div>

        {/* Content by phase */}
        <div className="px-6 py-6">
          {phase === "waiting" && (
            <div className="space-y-4">
              {etaTime ? (
                <>
                  <div className="rounded-2xl bg-gray-50 p-4 text-center">
                    <p className="text-xs text-gray-400 uppercase tracking-wide">Expected time</p>
                    <p className="text-4xl font-bold mt-1" style={{ color: cfg.color }}>{etaTime}</p>
                    <p className="text-xs text-gray-400 mt-1">± {Math.round(eta.confidence_min)} min</p>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-2xl bg-gray-50 p-4 text-center">
                      <p
                        className="text-3xl font-bold transition-colors"
                        style={{ color: queueFlash ? "#b45309" : "#1f2937" }}
                      >
                        {eta.patients_ahead}
                      </p>
                      <p className="text-xs text-gray-400 mt-1">ahead of you</p>
                    </div>
                    <div className="rounded-2xl bg-gray-50 p-4 text-center">
                      <p className="text-3xl font-bold text-gray-800">
                        {fmtMins(eta.wait_seconds)}
                      </p>
                      <p className="text-xs text-gray-400 mt-1">est. wait</p>
                    </div>
                  </div>
                  {prevAhead !== null && prevAhead > eta.patients_ahead && (
                    <div className="rounded-xl bg-green-50 px-4 py-2 text-center text-sm font-medium text-green-700">
                      Queue moved — {prevAhead - eta.patients_ahead} patient(s) called ✓
                    </div>
                  )}
                </>
              ) : (
                <div className="rounded-2xl bg-gray-50 p-5 text-center">
                  <p className="text-lg font-medium text-gray-500">Doctor not yet live</p>
                  <p className="mt-1 text-sm text-gray-400">
                    ETA will appear once your {isScan ? "machine" : "doctor"} starts the session.
                  </p>
                  <p className="mt-3 text-sm font-semibold text-gray-700">
                    {eta.patients_ahead} patient{eta.patients_ahead !== 1 ? "s" : ""} ahead of you
                  </p>
                </div>
              )}
            </div>
          )}

          {phase === "next" && (
            <div className="rounded-2xl p-5 text-center" style={{ background: cfg.color + "12" }}>
              <p className="text-2xl font-bold" style={{ color: cfg.color }}>
                You&apos;re next!
              </p>
              <p className="mt-2 text-sm text-gray-600">
                Please proceed to {isScan ? "the scan room" : "the consultation room"} now.
              </p>
              {etaTime && (
                <p className="mt-2 text-sm text-gray-500">Expected around {etaTime}</p>
              )}
            </div>
          )}

          {phase === "in_progress" && (
            <div className="rounded-2xl bg-green-50 p-5 text-center">
              <p className="text-xl font-bold text-green-700">
                {isScan ? "Scan in progress" : "Consultation in progress"}
              </p>
              <p className="mt-2 text-sm text-green-600">You are currently being seen.</p>
            </div>
          )}

          {phase === "done" && (
            <div className="rounded-2xl bg-green-50 p-5 text-center">
              <p className="text-4xl mb-2">✓</p>
              <p className="text-xl font-bold text-green-700">
                {isScan ? "Scan complete" : "Consultation complete"}
              </p>
              <p className="mt-1 text-sm text-green-600">Thank you for your visit.</p>
            </div>
          )}

          {phase === "no_show" && (
            <div className="rounded-2xl bg-gray-50 p-5 text-center">
              <p className="text-xl font-semibold text-gray-500">Marked as no-show</p>
              <p className="mt-1 text-sm text-gray-400">Please visit the reception desk.</p>
            </div>
          )}
        </div>

        {/* Telegram CTA */}
        {telegramBot && phase === "waiting" && (
          <div className="border-t border-gray-100 px-6 py-4">
            <a
              href={`https://t.me/${telegramBot}?start=${id}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", background: "#e8f4fb", borderRadius: 10, textDecoration: "none" }}
            >
              <span style={{ fontSize: 22 }}>✈️</span>
              <div>
                <div style={{ fontWeight: 600, fontSize: 13, color: "#0a6fa8" }}>Get notified on Telegram</div>
                <div style={{ fontSize: 12, color: "#4a90b8" }}>Tap to link — we&apos;ll message you when you&apos;re next</div>
              </div>
            </a>
          </div>
        )}

        {/* Footer */}
        <div className="border-t border-gray-100 px-6 py-4 text-center">
          <p className="text-xs text-gray-300">Updates automatically · Quivora Health</p>
        </div>
      </div>
    </div>
  );
}
