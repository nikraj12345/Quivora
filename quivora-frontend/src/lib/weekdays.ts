export const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

export type Weekday = (typeof WEEKDAYS)[number];

export const WEEKDAY_META: Record<Weekday, { label: string; short: string }> = {
  mon: { label: "Monday", short: "Mon" },
  tue: { label: "Tuesday", short: "Tue" },
  wed: { label: "Wednesday", short: "Wed" },
  thu: { label: "Thursday", short: "Thu" },
  fri: { label: "Friday", short: "Fri" },
  sat: { label: "Saturday", short: "Sat" },
  sun: { label: "Sunday", short: "Sun" },
};

export function formatWorkDaysList(days?: string[] | null): string {
  const list = days?.length ? days : ["mon", "tue", "wed", "thu", "fri", "sat"];
  return list.map((d) => WEEKDAY_META[d as Weekday]?.short ?? d).join(" · ");
}
