/** Session slot labels with timings — used across register / OPD / room. */

export const SLOT_META: Record<string, { label: string; time: string; short: string }> = {
  morning:   { label: "Morning",   time: "9:00 AM – 1:00 PM", short: "Morning · 9 AM–1 PM" },
  afternoon: { label: "Afternoon", time: "1:00 PM – 5:00 PM", short: "Afternoon · 1–5 PM" },
  evening:   { label: "Evening",   time: "5:00 PM – 9:00 PM", short: "Evening · 5–9 PM" },
};

export function slotShort(slot?: string | null): string {
  const s = slot || "morning";
  return SLOT_META[s]?.short ?? s.charAt(0).toUpperCase() + s.slice(1);
}

export function slotLabel(slot?: string | null): string {
  const s = slot || "morning";
  return SLOT_META[s]?.label ?? s.charAt(0).toUpperCase() + s.slice(1);
}

export function slotTime(slot?: string | null): string {
  const s = slot || "morning";
  return SLOT_META[s]?.time ?? "";
}

export function formatSlotsList(slots?: string[] | null): string {
  const list = slots?.length ? slots : ["morning"];
  return list.map((s) => slotShort(s)).join(" · ");
}
