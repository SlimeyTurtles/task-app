"use client";

import { useEffect, useRef, useState } from "react";
import { CalendarRange, ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { addDays, isSameDay, startOfLocalDay, startOfWeek } from "@/lib/scheduling";

export type CalendarView =
  | { mode: "rolling"; before: number; after: number }
  | { mode: "static"; start: string; span: number }; // start = yyyy-mm-dd (local)

function isoDay(d: Date): string {
  const x = startOfLocalDay(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
}
function parseDay(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}
function daysBetween(a: Date, b: Date): number {
  return Math.round((startOfLocalDay(b).getTime() - startOfLocalDay(a).getTime()) / 86_400_000);
}
function startOfMonth(d: Date): Date {
  const x = startOfLocalDay(d);
  x.setDate(1);
  return x;
}
function spanOf(view: CalendarView): number {
  return view.mode === "rolling" ? view.before + view.after + 1 : view.span;
}

/** The absolute [start, end] the view currently selects, anchored at today. */
export function selectedRange(view: CalendarView): { start: Date; end: Date } {
  const today = startOfLocalDay(new Date());
  if (view.mode === "rolling") {
    return { start: addDays(today, -view.before), end: addDays(today, view.after) };
  }
  const start = parseDay(view.start);
  return { start, end: addDays(start, view.span - 1) };
}

/** The visible window for a view at a given navigation offset (in spans from "home"). */
export function windowFor(view: CalendarView, navOffset: number): { start: Date; end: Date; span: number } {
  const span = spanOf(view);
  if (view.mode === "rolling") {
    const today = startOfLocalDay(new Date());
    const base = addDays(today, navOffset * span);
    return { start: addDays(base, -view.before), end: addDays(base, view.after), span };
  }
  const baseStart = addDays(parseDay(view.start), navOffset * span);
  return { start: baseStart, end: addDays(baseStart, span - 1), span };
}

export function viewLabel(view: CalendarView): string {
  const span = spanOf(view);
  const unit = `${span} day${span === 1 ? "" : "s"}`;
  return view.mode === "rolling" ? `${unit} · rolling` : `${unit} · fixed`;
}

const PRESETS: { label: string; before: number; after: number }[] = [
  { label: "Day", before: 0, after: 0 },
  { label: "3 days", before: 0, after: 2 },
  { label: "Week", before: 0, after: 6 },
  { label: "2 weeks", before: 0, after: 13 },
  { label: "Month", before: 0, after: 29 },
];

export function ViewControl({
  view,
  onChange,
  hourHeight,
  onHourHeightChange,
}: {
  view: CalendarView;
  onChange: (v: CalendarView) => void;
  hourHeight: number;
  onHourHeightChange: (h: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [monthAnchor, setMonthAnchor] = useState(() => startOfMonth(new Date()));
  const [dragStart, setDragStart] = useState<Date | null>(null);
  const [dragEnd, setDragEnd] = useState<Date | null>(null);
  const draggingRef = useRef(false);

  const today = startOfLocalDay(new Date());
  const sel = selectedRange(view);
  const previewStart = dragStart && dragEnd ? minDate(dragStart, dragEnd) : sel.start;
  const previewEnd = dragStart && dragEnd ? maxDate(dragStart, dragEnd) : sel.end;

  useEffect(() => {
    function onUp() {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      if (dragStart && dragEnd) applyRange(minDate(dragStart, dragEnd), maxDate(dragStart, dragEnd));
      setDragStart(null);
      setDragEnd(null);
    }
    window.addEventListener("pointerup", onUp);
    return () => window.removeEventListener("pointerup", onUp);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragStart, dragEnd, view.mode]);

  function applyRange(start: Date, end: Date) {
    if (view.mode === "rolling") {
      onChange({ mode: "rolling", before: daysBetween(start, today), after: daysBetween(today, end) });
    } else {
      onChange({ mode: "static", start: isoDay(start), span: daysBetween(start, end) + 1 });
    }
  }

  function setMode(mode: "rolling" | "static") {
    if (mode === view.mode) return;
    // Preserve the current absolute window when switching.
    if (mode === "rolling") {
      onChange({ mode: "rolling", before: daysBetween(sel.start, today), after: daysBetween(today, sel.end) });
    } else {
      onChange({ mode: "static", start: isoDay(sel.start), span: daysBetween(sel.start, sel.end) + 1 });
    }
  }

  function applyPreset(p: { before: number; after: number }) {
    if (view.mode === "rolling") {
      onChange({ mode: "rolling", before: p.before, after: p.after });
    } else {
      // Static presets anchor sensibly around today.
      const span = p.before + p.after + 1;
      const start = span >= 28 ? startOfMonth(today) : span >= 7 ? startOfWeek(today) : today;
      onChange({ mode: "static", start: isoDay(start), span });
    }
  }

  // Mini-month grid (6 weeks from the Monday on/before the 1st).
  const gridStart = startOfWeek(startOfMonth(monthAnchor));
  const cells = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const dayNames = Array.from({ length: 7 }, (_, i) => addDays(gridStart, i)).map((d) =>
    d.toLocaleDateString(undefined, { weekday: "narrow" }),
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button variant="outline" className="gap-2">
            <CalendarRange className="size-4" />
            {viewLabel(view)}
          </Button>
        }
      />
      <PopoverContent align="end" className="w-80 p-4">
        {/* Rolling / static toggle */}
        <div className="inline-flex rounded-lg border p-0.5 w-full mb-3">
          {(["rolling", "static"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={cn(
                "flex-1 px-3 py-1.5 text-sm rounded-md transition-colors capitalize",
                view.mode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {m}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground mb-3 h-4 leading-4">
          {view.mode === "rolling"
            ? "Slides with today, every day."
            : "Fixed dates — page with ‹ ›."}
        </p>

        {/* Presets */}
        <div className="flex flex-wrap gap-1.5 mb-3">
          {PRESETS.map((p) => {
            const active =
              view.mode === "rolling"
                ? view.before === p.before && view.after === p.after
                : view.span === p.before + p.after + 1;
            return (
              <button
                key={p.label}
                type="button"
                onClick={() => applyPreset(p)}
                className={cn(
                  "px-2 py-1 text-xs rounded-md border transition-colors",
                  active ? "border-primary text-primary bg-primary/10" : "text-muted-foreground hover:bg-accent/50",
                )}
              >
                {p.label}
              </button>
            );
          })}
        </div>

        {/* Mini month with drag-select */}
        <div className="rounded-lg border p-2 select-none">
          <div className="flex items-center justify-between mb-1.5 px-1">
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground"
              onClick={() => setMonthAnchor((m) => addMonths(m, -1))}
              aria-label="Previous month"
            >
              <ChevronLeft className="size-4" />
            </button>
            <span className="text-sm font-medium">
              {monthAnchor.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
            </span>
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground"
              onClick={() => setMonthAnchor((m) => addMonths(m, 1))}
              aria-label="Next month"
            >
              <ChevronRight className="size-4" />
            </button>
          </div>
          <div className="grid grid-cols-7">
            {dayNames.map((n, i) => (
              <div key={i} className="text-[0.65rem] text-center text-muted-foreground py-0.5">
                {n}
              </div>
            ))}
            {cells.map((d) => {
              const inMonth = d.getMonth() === monthAnchor.getMonth();
              const inRange = d >= startOfLocalDay(previewStart) && d <= startOfLocalDay(previewEnd);
              const isToday = isSameDay(d, today);
              const isStart = isSameDay(d, previewStart);
              const isEnd = isSameDay(d, previewEnd);
              return (
                <button
                  key={d.toISOString()}
                  type="button"
                  data-day={isoDay(d)}
                  onPointerDown={(e) => {
                    e.preventDefault();
                    draggingRef.current = true;
                    setDragStart(d);
                    setDragEnd(d);
                  }}
                  onPointerEnter={() => {
                    if (draggingRef.current) setDragEnd(d);
                  }}
                  className={cn(
                    "h-8 text-xs tabular-nums relative",
                    !inMonth && "text-muted-foreground/40",
                    inRange && "bg-primary/15",
                    isStart && "rounded-l-md",
                    isEnd && "rounded-r-md",
                  )}
                >
                  <span
                    className={cn(
                      "inline-flex items-center justify-center size-6 rounded-full",
                      isToday && "ring-1 ring-primary ring-inset font-semibold",
                      (isStart || isEnd) && "bg-primary text-primary-foreground",
                    )}
                  >
                    {d.getDate()}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <p className="text-xs text-muted-foreground mt-3">
          {rangeSummary(view)}
        </p>

        {/* Hour height (zoom) — taller rows scroll inside the calendar. */}
        <div className="mt-3 pt-3 border-t">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Hour height
            </span>
            <span className="text-xs text-muted-foreground tabular-nums">{hourHeight}px</span>
          </div>
          <input
            type="range"
            min={28}
            max={120}
            step={4}
            value={hourHeight}
            onChange={(e) => onHourHeightChange(Number(e.target.value))}
            className="w-full accent-primary"
            aria-label="Hour height"
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}

function rangeSummary(view: CalendarView): string {
  const { start, end } = selectedRange(view);
  const span = spanOf(view);
  const fmt = (d: Date) => d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  if (view.mode === "rolling") {
    const b = view.before === 0 ? "today" : `${view.before}d back`;
    const a = view.after === 0 ? "today" : `+${view.after}d`;
    return `${span} days · ${b} → ${a}, sliding daily`;
  }
  return `${fmt(start)} – ${fmt(end)} · fixed`;
}

function addMonths(d: Date, n: number): Date {
  const x = startOfLocalDay(d);
  x.setMonth(x.getMonth() + n, 1);
  return x;
}
function minDate(a: Date, b: Date): Date {
  return a <= b ? a : b;
}
function maxDate(a: Date, b: Date): Date {
  return a >= b ? a : b;
}
