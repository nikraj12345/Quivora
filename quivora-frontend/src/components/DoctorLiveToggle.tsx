"use client";

import { useState } from "react";
import { api, Doctor } from "@/lib/api";
import { slotShort } from "@/lib/slots";

type Props = {
  externalId: string;
  isLive: boolean;
  slots?: string[];
  activeSlot?: string | null;
  disabled?: boolean;
  size?: "sm" | "md";
  onChanged?: (doctor: Doctor) => void;
  onError?: (message: string) => void;
};

/** Toggle doctor Live / Offline. Multi-slot doctors pick a session when going live. */
export function DoctorLiveToggle({
  externalId,
  isLive,
  slots,
  activeSlot,
  disabled,
  size = "sm",
  onChanged,
  onError,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const available = (slots?.length ? slots : ["morning"]).filter(Boolean);

  const goOffline = async () => {
    setBusy(true);
    try {
      onChanged?.(await api.goOffline(externalId));
    } catch (e) {
      onError?.(e instanceof Error ? e.message : "Failed to go offline");
    } finally {
      setBusy(false);
      setPicking(false);
    }
  };

  const goLive = async (slot: string) => {
    setBusy(true);
    setPicking(false);
    try {
      onChanged?.(await api.goLive(externalId, slot));
    } catch (e) {
      onError?.(e instanceof Error ? e.message : "Failed to go live");
    } finally {
      setBusy(false);
    }
  };

  const onToggle = async () => {
    if (busy || disabled) return;
    if (isLive) {
      await goOffline();
      return;
    }
    if (available.length === 1) {
      await goLive(available[0]);
      return;
    }
    setPicking(true);
  };

  return (
    <div className="live-toggle-wrap">
      <button
        type="button"
        role="switch"
        aria-checked={isLive}
        disabled={busy || disabled}
        onClick={onToggle}
        className={`live-toggle ${isLive ? "is-on" : ""} ${size === "md" ? "live-toggle--md" : ""}`}
        title={isLive ? "Go offline" : "Go live"}
      >
        <span className="live-toggle-track" aria-hidden>
          <span className="live-toggle-thumb" />
        </span>
        {busy ? "…" : isLive ? "Live" : "Offline"}
      </button>

      {picking && !isLive && (
        <div className="live-toggle-slots">
          {available.map((s) => (
            <button
              key={s}
              type="button"
              className="btn btn-primary btn-sm"
              disabled={busy}
              onClick={() => goLive(s)}
            >
              {slotShort(s)}
            </button>
          ))}
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setPicking(false)}>
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
