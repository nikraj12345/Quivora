"use client";

type LiveBadgeProps = {
  isLive: boolean;
  liveAt?: string | null;
};

export function LiveBadge({ isLive, liveAt }: LiveBadgeProps) {
  if (!isLive) {
    return (
      <span className="badge badge-off">
        <span className="dot-off" />
        Offline
      </span>
    );
  }

  const timeStr = liveAt
    ? new Date(liveAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : null;

  return (
    <span className="badge badge-live">
      <span className="dot-live" />
      Live{timeStr ? ` (since ${timeStr})` : ""}
    </span>
  );
}
