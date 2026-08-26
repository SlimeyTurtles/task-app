"use client";

import { useMemo } from "react";

import { Input } from "@/components/ui/input";
import {
  buildRrule,
  describeRrule,
  WEEKDAY_CODES,
  type RecurrencePattern,
  type WeekdayCode,
} from "@/lib/recurrence";

const WEEKDAY_LABELS: Record<WeekdayCode, string> = {
  MO: "M", TU: "T", WE: "W", TH: "T", FR: "F", SA: "S", SU: "S",
};
const WEEKDAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const NTH_NAMES = ["first", "second", "third", "fourth", "last"];

type Preset =
  | "none" | "daily" | "weekdays" | "weekly"
  | "monthly_dom" | "monthly_nth" | "yearly" | "custom";

const selectClass =
  "h-8 w-full rounded-md border border-input bg-transparent px-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

export function RecurrenceEditor({
  value,
  onChange,
  anchor,
  selectId = "recurrence-preset",
}: {
  value: RecurrencePattern | null;
  onChange: (p: RecurrencePattern | null) => void;
  /** The first occurrence — drives weekday/day-of-month labels. */
  anchor: Date;
  selectId?: string;
}) {
  const anchorDay = WEEKDAY_CODES[(anchor.getDay() + 6) % 7];
  const nth = Math.min(Math.ceil(anchor.getDate() / 7), 5) - 1;

  const preset = useMemo<Preset>(() => detectPreset(value, anchorDay), [value, anchorDay]);

  function pickPreset(p: Preset) {
    switch (p) {
      case "none": return onChange(null);
      case "daily": return onChange({ freq: "DAILY", interval: 1, end: { type: "never" } });
      case "weekdays":
        return onChange({ freq: "WEEKLY", interval: 1, byday: ["MO", "TU", "WE", "TH", "FR"], end: { type: "never" } });
      case "weekly":
        return onChange({ freq: "WEEKLY", interval: 1, byday: [anchorDay], end: { type: "never" } });
      case "monthly_dom":
        return onChange({ freq: "MONTHLY", interval: 1, monthlyMode: "day_of_month", end: { type: "never" } });
      case "monthly_nth":
        return onChange({ freq: "MONTHLY", interval: 1, monthlyMode: "nth_weekday", end: { type: "never" } });
      case "yearly": return onChange({ freq: "YEARLY", interval: 1, end: { type: "never" } });
      case "custom":
        return onChange({
          ...(value ?? { freq: "WEEKLY", byday: [anchorDay], end: { type: "never" } }),
          interval: value?.interval && value.interval > 1 ? value.interval : 2,
        } as RecurrencePattern);
    }
  }

  const summary = value ? describeRrule(buildRrule(value, anchor)) : null;

  return (
    <div className="grid gap-2">
      <select id={selectId} value={preset} onChange={(e) => pickPreset(e.target.value as Preset)} className={selectClass}>
        <option value="none">Does not repeat</option>
        <option value="daily">Every day</option>
        <option value="weekdays">Weekdays (Mon–Fri)</option>
        <option value="weekly">Weekly on {WEEKDAY_NAMES[(anchor.getDay() + 6) % 7]}</option>
        <option value="monthly_dom">Monthly on day {anchor.getDate()}</option>
        <option value="monthly_nth">
          Monthly on the {NTH_NAMES[nth]} {WEEKDAY_NAMES[(anchor.getDay() + 6) % 7]}
        </option>
        <option value="yearly">
          Yearly on {anchor.toLocaleDateString(undefined, { month: "long", day: "numeric" })}
        </option>
        <option value="custom">Custom…</option>
      </select>

      {preset === "custom" && value ? (
        <div className="grid gap-2.5 rounded-md border border-dashed border-primary/30 bg-primary/[0.03] p-3">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Every</span>
            <Input
              type="number"
              min={1}
              max={365}
              value={value.interval}
              onChange={(e) =>
                onChange({ ...value, interval: Math.max(1, Math.min(365, Number(e.target.value) || 1)) })
              }
              className="h-8 w-16 text-center"
              aria-label="Repeat interval"
            />
            <select
              value={value.freq}
              onChange={(e) => {
                const freq = e.target.value as RecurrencePattern["freq"];
                onChange({
                  ...value,
                  freq,
                  byday: freq === "WEEKLY" ? (value.byday?.length ? value.byday : [anchorDay]) : undefined,
                  monthlyMode: freq === "MONTHLY" ? (value.monthlyMode ?? "day_of_month") : undefined,
                });
              }}
              className={`${selectClass} w-auto`}
              aria-label="Repeat unit"
            >
              <option value="DAILY">{value.interval === 1 ? "day" : "days"}</option>
              <option value="WEEKLY">{value.interval === 1 ? "week" : "weeks"}</option>
              <option value="MONTHLY">{value.interval === 1 ? "month" : "months"}</option>
              <option value="YEARLY">{value.interval === 1 ? "year" : "years"}</option>
            </select>
          </div>

          {value.freq === "WEEKLY" ? (
            <div className="flex gap-1" role="group" aria-label="Repeat on days">
              {WEEKDAY_CODES.map((code) => {
                const on = value.byday?.includes(code) ?? false;
                return (
                  <button
                    key={code}
                    type="button"
                    aria-pressed={on}
                    aria-label={WEEKDAY_NAMES[WEEKDAY_CODES.indexOf(code)]}
                    onClick={() => {
                      const current = value.byday ?? [];
                      const next = on ? current.filter((c) => c !== code) : [...current, code];
                      if (next.length === 0) return; // keep at least one day
                      onChange({ ...value, byday: WEEKDAY_CODES.filter((c) => next.includes(c)) });
                    }}
                    className={`size-7 rounded-full text-[11px] font-medium transition-colors ${
                      on
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground hover:bg-accent"
                    }`}
                  >
                    {WEEKDAY_LABELS[code]}
                  </button>
                );
              })}
            </div>
          ) : null}

          {value.freq === "MONTHLY" ? (
            <div className="grid gap-1 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="monthly-mode"
                  checked={(value.monthlyMode ?? "day_of_month") === "day_of_month"}
                  onChange={() => onChange({ ...value, monthlyMode: "day_of_month" })}
                  className="accent-primary"
                />
                On day {anchor.getDate()}
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="monthly-mode"
                  checked={value.monthlyMode === "nth_weekday"}
                  onChange={() => onChange({ ...value, monthlyMode: "nth_weekday" })}
                  className="accent-primary"
                />
                On the {NTH_NAMES[nth]} {WEEKDAY_NAMES[(anchor.getDay() + 6) % 7]}
              </label>
            </div>
          ) : null}

          <div className="grid gap-1 text-sm">
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Ends</span>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="rec-end"
                checked={value.end.type === "never"}
                onChange={() => onChange({ ...value, end: { type: "never" } })}
                className="accent-primary"
              />
              Never
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="rec-end"
                checked={value.end.type === "until"}
                onChange={() =>
                  onChange({ ...value, end: { type: "until", date: defaultUntil(anchor) } })
                }
                className="accent-primary"
              />
              On
              <Input
                type="date"
                value={value.end.type === "until" ? value.end.date : defaultUntil(anchor)}
                onChange={(e) => onChange({ ...value, end: { type: "until", date: e.target.value } })}
                onFocus={() => {
                  if (value.end.type !== "until") {
                    onChange({ ...value, end: { type: "until", date: defaultUntil(anchor) } });
                  }
                }}
                className="h-7 w-36 text-xs"
                aria-label="Ends on date"
              />
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="rec-end"
                checked={value.end.type === "count"}
                onChange={() => onChange({ ...value, end: { type: "count", count: 10 } })}
                className="accent-primary"
              />
              After
              <Input
                type="number"
                min={1}
                max={1000}
                value={value.end.type === "count" ? value.end.count : 10}
                onChange={(e) =>
                  onChange({
                    ...value,
                    end: { type: "count", count: Math.max(1, Math.min(1000, Number(e.target.value) || 1)) },
                  })
                }
                onFocus={() => {
                  if (value.end.type !== "count") {
                    onChange({ ...value, end: { type: "count", count: 10 } });
                  }
                }}
                className="h-7 w-16 text-center text-xs"
                aria-label="Ends after occurrences"
              />
              occurrences
            </label>
          </div>
        </div>
      ) : null}

      {summary && preset !== "none" ? (
        <p className="font-heading text-xs italic text-muted-foreground">{summary}</p>
      ) : null}
    </div>
  );
}

function detectPreset(value: RecurrencePattern | null, anchorDay: WeekdayCode): Preset {
  if (!value) return "none";
  if (value.interval !== 1 || value.end.type !== "never") return "custom";
  switch (value.freq) {
    case "DAILY":
      return value.byday?.length ? "custom" : "daily";
    case "WEEKLY": {
      const days = value.byday ?? [];
      if (days.length === 5 && ["MO", "TU", "WE", "TH", "FR"].every((d) => days.includes(d as WeekdayCode))) {
        return "weekdays";
      }
      if (days.length === 0 || (days.length === 1 && days[0] === anchorDay)) return "weekly";
      return "custom";
    }
    case "MONTHLY":
      return value.monthlyMode === "nth_weekday" ? "monthly_nth" : "monthly_dom";
    case "YEARLY":
      return "yearly";
  }
}

function defaultUntil(anchor: Date): string {
  const d = new Date(anchor);
  d.setMonth(d.getMonth() + 3);
  return d.toISOString().slice(0, 10);
}
