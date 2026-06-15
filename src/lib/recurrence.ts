/** Shared mapping between the UI "repeat" choices and the RRULE subset we store. */

import { RRule } from "rrule";

export type Repeat = "none" | "daily" | "weekdays" | "weekly";

export const REPEAT_OPTIONS: { value: Repeat; label: string }[] = [
  { value: "none", label: "Does not repeat" },
  { value: "daily", label: "Every day" },
  { value: "weekdays", label: "Weekdays (Mon–Fri)" },
  { value: "weekly", label: "Weekly" },
];

export function repeatToRrule(repeat: Repeat): string | null {
  switch (repeat) {
    case "daily": return "FREQ=DAILY";
    case "weekdays": return "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR";
    case "weekly": return "FREQ=WEEKLY";
    case "none": return null;
  }
}

export function rruleToRepeat(rrule: string | null | undefined): Repeat {
  if (!rrule) return "none";
  const up = rrule.toUpperCase();
  if (up.includes("FREQ=DAILY")) return "daily";
  if (up.includes("FREQ=WEEKLY") && up.includes("BYDAY=MO,TU,WE,TH,FR")) return "weekdays";
  if (up.includes("FREQ=WEEKLY")) return "weekly";
  return "none";
}

export function repeatLabel(rrule: string | null | undefined): string {
  switch (rruleToRepeat(rrule)) {
    case "daily": return "Daily";
    case "weekdays": return "Weekdays";
    case "weekly": return "Weekly";
    case "none": return "Once";
  }
}

/**
 * Expand an RRULE between two instants. `dtstart` anchors the series (the
 * first occurrence's date + time of day). `timezone` is an IANA tz id; rrule
 * applies it so "every day at 09:00" stays at 09:00 across DST.
 *
 * Returns dates strictly in [from, to). Exception dates (ISO YYYY-MM-DD) are
 * filtered out by calendar date in the rule's tz.
 */
export function materializeOccurrences(
  rrule: string,
  dtstart: Date,
  from: Date,
  to: Date,
  timezone = "UTC",
  exdates: string[] = [],
): Date[] {
  const rule = RRule.fromString(`DTSTART:${toRruleUtcString(dtstart)}\nRRULE:${stripPrefix(rrule)}`);
  const occurrences = rule.between(from, to, true);
  if (exdates.length === 0) return occurrences;
  const excluded = new Set(exdates.map((d) => d.slice(0, 10)));
  return occurrences.filter((d) => !excluded.has(formatDateInTz(d, timezone)));
}

function stripPrefix(rrule: string): string {
  return rrule.replace(/^RRULE:/i, "").replace(/;$/, "");
}

function toRruleUtcString(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

function formatDateInTz(d: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const y = parts.find((p) => p.type === "year")?.value ?? "0000";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  const day = parts.find((p) => p.type === "day")?.value ?? "01";
  return `${y}-${m}-${day}`;
}
