/**
 * Recurrence rules: shared pattern schema, RRULE build/parse, and expansion.
 *
 * Storage format is always the iCal RRULE string on RecurrenceRule.rrule; the
 * structured RecurrencePattern is the editing/validation surface. Expansion is
 * UTC-anchored (DTSTART serialized with UTC getters), which means wall-clock
 * times drift by an hour across DST boundaries in non-UTC timezones. Known
 * limitation; the fix is constructing RRule with `tzid`, deferred so all
 * UNTIL/dtstart math stays in one consistent frame.
 */

import { RRule, Weekday } from "rrule";
import { z } from "zod";

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

// ---------------------------------------------------------------------------
// Structured pattern <-> RRULE string
// ---------------------------------------------------------------------------

export const WEEKDAY_CODES = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"] as const;
export type WeekdayCode = (typeof WEEKDAY_CODES)[number];

export const RecurrencePatternSchema = z.object({
  freq: z.enum(["DAILY", "WEEKLY", "MONTHLY", "YEARLY"]),
  interval: z.number().int().min(1).max(365).default(1),
  /** Weekly only: which weekdays. Omitted = dtstart's weekday. */
  byday: z.array(z.enum(WEEKDAY_CODES)).optional(),
  /** Monthly only. Omitted = day_of_month. */
  monthlyMode: z.enum(["day_of_month", "nth_weekday"]).optional(),
  end: z
    .discriminatedUnion("type", [
      z.object({ type: z.literal("never") }),
      z.object({ type: z.literal("until"), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
      z.object({ type: z.literal("count"), count: z.number().int().min(1).max(1000) }),
    ])
    .default({ type: "never" }),
});
export type RecurrencePattern = z.infer<typeof RecurrencePatternSchema>;

export function repeatToPattern(repeat: Repeat): RecurrencePattern | null {
  switch (repeat) {
    case "daily": return { freq: "DAILY", interval: 1, end: { type: "never" } };
    case "weekdays":
      return { freq: "WEEKLY", interval: 1, byday: ["MO", "TU", "WE", "TH", "FR"], end: { type: "never" } };
    case "weekly": return { freq: "WEEKLY", interval: 1, end: { type: "never" } };
    case "none": return null;
  }
}

/**
 * Build the stored RRULE string. Monthly parts are derived from dtstart's UTC
 * fields to match the UTC-anchored expansion frame.
 */
export function buildRrule(pattern: RecurrencePattern, dtstart: Date, timezone = "UTC"): string {
  const parts: string[] = [`FREQ=${pattern.freq}`];
  if (pattern.interval > 1) parts.push(`INTERVAL=${pattern.interval}`);

  if (pattern.freq === "WEEKLY" && pattern.byday?.length) {
    parts.push(`BYDAY=${pattern.byday.join(",")}`);
  }
  if (pattern.freq === "MONTHLY") {
    if ((pattern.monthlyMode ?? "day_of_month") === "day_of_month") {
      parts.push(`BYMONTHDAY=${dtstart.getUTCDate()}`);
    } else {
      const weekday = WEEKDAY_CODES[(dtstart.getUTCDay() + 6) % 7];
      const nth = Math.ceil(dtstart.getUTCDate() / 7);
      parts.push(`BYDAY=${nth >= 5 ? -1 : nth}${weekday}`);
    }
  }

  if (pattern.end.type === "until") {
    parts.push(`UNTIL=${toRruleUtcString(endOfDayInTz(pattern.end.date, timezone))}`);
  } else if (pattern.end.type === "count") {
    parts.push(`COUNT=${pattern.end.count}`);
  }
  return parts.join(";");
}

/**
 * Parse a stored RRULE back into the structured pattern, or null when the
 * string uses features the builder can't represent (raw/power-editor rules).
 */
export function parseRrule(rrule: string | null | undefined, timezone = "UTC"): RecurrencePattern | null {
  if (!rrule) return null;
  let opts: Partial<import("rrule").Options>;
  try {
    opts = RRule.parseString(stripPrefix(rrule));
  } catch {
    return null;
  }

  const freq =
    opts.freq === RRule.DAILY ? "DAILY"
    : opts.freq === RRule.WEEKLY ? "WEEKLY"
    : opts.freq === RRule.MONTHLY ? "MONTHLY"
    : opts.freq === RRule.YEARLY ? "YEARLY"
    : null;
  if (!freq) return null;
  // Reject parts the builder doesn't model.
  if (opts.byhour != null || opts.byminute != null || opts.bysetpos != null || opts.byyearday != null || opts.byweekno != null) {
    return null;
  }

  const pattern: RecurrencePattern = {
    freq,
    interval: opts.interval ?? 1,
    end: opts.until
      ? { type: "until", date: formatDateInTz(opts.until, timezone) }
      : opts.count
        ? { type: "count", count: opts.count }
        : { type: "never" },
  };

  const weekdays = normalizeWeekdays(opts.byweekday);
  if (weekdays === undefined) return null; // unparseable weekday shape

  if (freq === "WEEKLY") {
    if (opts.bymonthday != null || weekdays?.some((w) => w.n != null)) return null;
    if (weekdays?.length) pattern.byday = weekdays.map((w) => WEEKDAY_CODES[w.weekday]);
  } else if (freq === "MONTHLY") {
    const monthDays = Array.isArray(opts.bymonthday)
      ? opts.bymonthday
      : opts.bymonthday != null ? [opts.bymonthday] : [];
    if (monthDays.length > 1) return null;
    if (weekdays?.length) {
      if (monthDays.length || weekdays.length > 1 || weekdays[0].n == null) return null;
      pattern.monthlyMode = "nth_weekday";
    } else {
      pattern.monthlyMode = "day_of_month";
    }
  } else if (weekdays?.length || opts.bymonthday != null) {
    return null; // daily/yearly with extra parts = custom
  }

  return pattern;
}

/** Human summary of a rule ("every 2 weeks on Monday, Thursday for 6 times"). */
export function describeRrule(rrule: string | null | undefined): string {
  if (!rrule) return "Once";
  try {
    const text = RRule.fromString(`RRULE:${stripPrefix(rrule)}`).toText();
    if (text && !/RRule error/i.test(text)) {
      return text.charAt(0).toUpperCase() + text.slice(1);
    }
  } catch {
    // fall through
  }
  return repeatLabel(rrule);
}

/**
 * Occurrences of the raw rule (exdates NOT applied — exdates count as elapsed
 * slots for COUNT accounting) strictly before `before`, starting at dtstart.
 */
export function countOccurrencesBefore(rrule: string, dtstart: Date, before: Date): number {
  if (before <= dtstart) return 0;
  const rule = RRule.fromString(`DTSTART:${toRruleUtcString(dtstart)}\nRRULE:${stripPrefix(rrule)}`);
  return rule.between(new Date(dtstart.getTime() - 1000), new Date(before.getTime() - 1), true).length;
}

/**
 * The rule that keeps only occurrences strictly before `splitAt` (the original
 * series after a "this and following" split). Returns null when nothing
 * remains (splitting at/before the first occurrence).
 */
export function truncateRrule(rrule: string, dtstart: Date, splitAt: Date): string | null {
  const elapsed = countOccurrencesBefore(rrule, dtstart, splitAt);
  if (elapsed === 0) return null;
  const parts = rruleParts(rrule);
  if (parts.COUNT) {
    parts.COUNT = String(Math.min(Number(parts.COUNT), elapsed));
  } else {
    parts.UNTIL = toRruleUtcString(new Date(splitAt.getTime() - 1000));
    delete parts.COUNT;
  }
  return joinRruleParts(parts);
}

/**
 * The rule for the NEW series created at `splitAt` by a "this and following"
 * split: same cadence, COUNT reduced by elapsed slots. Returns null when no
 * occurrences remain. (UNTIL and never-ending rules carry over unchanged.)
 */
export function remainderRrule(rrule: string, dtstart: Date, splitAt: Date): string | null {
  const parts = rruleParts(rrule);
  if (parts.COUNT) {
    const remaining = Number(parts.COUNT) - countOccurrencesBefore(rrule, dtstart, splitAt);
    if (remaining <= 0) return null;
    parts.COUNT = String(remaining);
  } else if (parts.UNTIL) {
    const until = RRule.parseString(`FREQ=DAILY;UNTIL=${parts.UNTIL}`).until;
    if (until && until < splitAt) return null;
  }
  return joinRruleParts(parts);
}

/**
 * Expand an RRULE between two instants. `dtstart` anchors the series (the
 * first occurrence's date + time of day). Returns dates strictly in [from, to),
 * capped at `limit`.
 *
 * Exception dates: full ISO datetimes are matched exactly against the
 * occurrence instant; legacy 10-char YYYY-MM-DD entries match by calendar date
 * in the rule's tz.
 */
export function materializeOccurrences(
  rrule: string,
  dtstart: Date,
  from: Date,
  to: Date,
  timezone = "UTC",
  exdates: string[] = [],
  limit = 100,
): Date[] {
  const rule = RRule.fromString(`DTSTART:${toRruleUtcString(dtstart)}\nRRULE:${stripPrefix(rrule)}`);
  let occurrences = rule.between(from, to, true);
  if (exdates.length > 0) {
    const excludedDays = new Set(exdates.filter((d) => d.length === 10));
    const excludedInstants = new Set(
      exdates.filter((d) => d.length > 10).map((d) => new Date(d).getTime()),
    );
    occurrences = occurrences.filter(
      (d) => !excludedInstants.has(d.getTime()) && !excludedDays.has(formatDateInTz(d, timezone)),
    );
  }
  return occurrences.slice(0, limit);
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function stripPrefix(rrule: string): string {
  return rrule.replace(/^RRULE:/i, "").replace(/;$/, "");
}

function rruleParts(rrule: string): Record<string, string> {
  const parts: Record<string, string> = {};
  for (const kv of stripPrefix(rrule).split(";")) {
    const eq = kv.indexOf("=");
    if (eq > 0) parts[kv.slice(0, eq).toUpperCase()] = kv.slice(eq + 1);
  }
  return parts;
}

function joinRruleParts(parts: Record<string, string>): string {
  return Object.entries(parts)
    .map(([k, v]) => `${k}=${v}`)
    .join(";");
}

/** rrule's byweekday can be numbers, Weekday objects, or strings. */
function normalizeWeekdays(
  byweekday: Partial<import("rrule").Options>["byweekday"],
): { weekday: number; n?: number | null }[] | null | undefined {
  if (byweekday == null) return null;
  const arr = Array.isArray(byweekday) ? byweekday : [byweekday];
  const out: { weekday: number; n?: number | null }[] = [];
  for (const w of arr) {
    if (typeof w === "number") out.push({ weekday: w });
    else if (w instanceof Weekday) out.push({ weekday: w.weekday, n: w.n });
    else if (typeof w === "string") {
      const idx = WEEKDAY_CODES.indexOf(w as WeekdayCode);
      if (idx === -1) return undefined;
      out.push({ weekday: idx });
    } else return undefined;
  }
  return out;
}

function toRruleUtcString(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

/** UTC instant for 23:59:59 of `dateStr` (YYYY-MM-DD) in `tz`. */
function endOfDayInTz(dateStr: string, tz: string): Date {
  const guess = new Date(`${dateStr}T23:59:59Z`);
  const offset = tzOffsetMs(guess, tz);
  return new Date(guess.getTime() - offset);
}

/** Milliseconds that `tz` is ahead of UTC at instant `d`. */
function tzOffsetMs(d: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
  return asUtc - d.getTime();
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
