export type Priority = "normal" | "urgent" | "senior" | "emergency";

export const PRIORITY_META: Record<
  Priority,
  { label: string; short: string; badge: string; hint: string }
> = {
  emergency: {
    label: "Emergency",
    short: "EMG",
    badge: "badge-emergency",
    hint: "Critical — jumps ahead of everyone",
  },
  senior: {
    label: "Senior (60+)",
    short: "60+",
    badge: "badge-senior",
    hint: "Age 60+ — priority over normal & urgent",
  },
  urgent: {
    label: "Urgent",
    short: "URG",
    badge: "badge-urgent",
    hint: "Clinically urgent — ahead of normal",
  },
  normal: {
    label: "Normal",
    short: "STD",
    badge: "badge-off",
    hint: "Standard first-come order",
  },
};

export function suggestPriority(age: number, current?: Priority): Priority {
  if (current === "emergency" || current === "urgent") return current;
  if (age >= 60) return "senior";
  return current || "normal";
}
