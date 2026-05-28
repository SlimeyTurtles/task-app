"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Plus, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc/client";
import {
  addDays,
  endOfLocalDay,
  startOfLocalDay,
  startOfWeek,
} from "@/lib/scheduling";
import { TimeGrid, type GridEvent } from "@/components/calendar/time-grid";
import { MonthGrid } from "@/components/calendar/month-grid";
import { EventFormDialog, type EventDialogState } from "@/components/calendar/event-form-dialog";
import { PlanAheadDialog } from "@/components/calendar/plan-ahead-dialog";

type Granularity = "day" | "3day" | "week" | "2week" | "month";

const OPTIONS: { key: Granularity; label: string; mode: "time" | "box" }[] = [
  { key: "day", label: "Day", mode: "time" },
  { key: "3day", label: "3 Days", mode: "time" },
  { key: "week", label: "Week", mode: "time" },
  { key: "2week", label: "2 Weeks", mode: "box" },
  { key: "month", label: "Month", mode: "box" },
];

function monthStart(d: Date) {
  const o = startOfLocalDay(d);
  o.setDate(1);
  return o;
}
function monthEnd(d: Date) {
  const o = startOfLocalDay(d);
  o.setMonth(o.getMonth() + 1, 0);
  return endOfLocalDay(o);
}

export function CalendarClient() {
  const [granularity, setGranularity] = useState<Granularity>("week");
  const [anchor, setAnchor] = useState(() => startOfLocalDay(new Date()));
  const [dialog, setDialog] = useState<EventDialogState>({ open: false });
  const [planOpen, setPlanOpen] = useState(false);

  const mode = OPTIONS.find((o) => o.key === granularity)!.mode;

  // Compute the visible range + (for time mode) the day columns.
  const { days, rangeStart, rangeEnd, title } = useMemo(() => {
    if (granularity === "day") {
      return { days: [anchor], rangeStart: anchor, rangeEnd: endOfLocalDay(anchor), title: longDay(anchor) };
    }
    if (granularity === "3day") {
      const ds = [0, 1, 2].map((i) => addDays(anchor, i));
      return { days: ds, rangeStart: ds[0], rangeEnd: endOfLocalDay(ds[2]), title: `${shortDay(ds[0])} – ${shortDay(ds[2])}` };
    }
    if (granularity === "week") {
      const ws = startOfWeek(anchor);
      const ds = Array.from({ length: 7 }, (_, i) => addDays(ws, i));
      return { days: ds, rangeStart: ds[0], rangeEnd: endOfLocalDay(ds[6]), title: rangeLabel(ds[0], ds[6]) };
    }
    if (granularity === "2week") {
      const ws = startOfWeek(anchor);
      const start = ws;
      const end = endOfLocalDay(addDays(ws, 13));
      return { days: [], rangeStart: start, rangeEnd: end, title: rangeLabel(start, end) };
    }
    // month
    const start = monthStart(anchor);
    const end = monthEnd(anchor);
    return { days: [], rangeStart: start, rangeEnd: end, title: anchor.toLocaleDateString(undefined, { month: "long", year: "numeric" }) };
  }, [granularity, anchor]);

  // Fetch over the full visible grid (pad to week boundaries for the box view).
  const fetchStart = mode === "box" ? startOfWeek(rangeStart) : rangeStart;
  const fetchEnd = mode === "box" ? endOfLocalDay(addDays(startOfWeek(rangeEnd), 6)) : rangeEnd;

  const utils = trpc.useUtils();
  const { data: events } = trpc.events.list.useQuery({ start: fetchStart, end: fetchEnd });
  const { data: blocks } = trpc.timeBlocks.list.useQuery({ start: fetchStart, end: fetchEnd });

  const update = trpc.events.update.useMutation({
    onSuccess: () => utils.events.list.invalidate(),
    onError: (e) => {
      toast.error(e.message);
      void utils.events.list.invalidate();
    },
  });

  const gridEvents = (events ?? []) as unknown as GridEvent[];

  function shift(dir: -1 | 1) {
    setAnchor((a) => {
      switch (granularity) {
        case "day": return addDays(a, dir);
        case "3day": return addDays(a, dir * 3);
        case "week": return addDays(a, dir * 7);
        case "2week": return addDays(a, dir * 14);
        case "month": {
          const o = startOfLocalDay(a);
          o.setMonth(o.getMonth() + dir);
          return o;
        }
      }
    });
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3 flex-wrap shrink-0 mb-3">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => shift(-1)} aria-label="Previous">
            <ChevronLeft className="size-4" />
          </Button>
          <Button variant="outline" onClick={() => setAnchor(startOfLocalDay(new Date()))}>
            Today
          </Button>
          <Button variant="outline" size="icon" onClick={() => shift(1)} aria-label="Next">
            <ChevronRight className="size-4" />
          </Button>
          <h2 className="font-heading text-xl font-semibold ml-1">{title}</h2>
        </div>

        <div className="flex items-center gap-2">
          {/* Granularity segmented control */}
          <div className="inline-flex rounded-lg border p-0.5 bg-card">
            {OPTIONS.map((o) => (
              <button
                key={o.key}
                onClick={() => setGranularity(o.key)}
                className={
                  "px-2.5 py-1 text-sm rounded-md transition-colors " +
                  (granularity === o.key
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground")
                }
              >
                {o.label}
              </button>
            ))}
          </div>
          <Button variant="outline" onClick={() => setPlanOpen(true)}>
            <Sparkles className="size-4" /> Plan ahead
          </Button>
          <Button onClick={() => openCreate(setDialog, anchor)}>
            <Plus className="size-4" /> Event
          </Button>
        </div>
      </div>

      {/* Calendar surface */}
      <div className="flex-1 min-h-0 rounded-lg border bg-card overflow-hidden">
        {mode === "time" ? (
          <TimeGrid
            days={days}
            events={gridEvents}
            timeBlocks={(blocks ?? []) as never}
            onCreateRange={(start, end) => setDialog({ open: true, init: { startsAt: start, endsAt: end } })}
            onEditEvent={(eventId) => setDialog({ open: true, eventId })}
            onMoveEvent={(eventId, start, end) => update.mutate({ id: eventId, startsAt: start, endsAt: end })}
            onResizeEvent={(eventId, start, end) => update.mutate({ id: eventId, startsAt: start, endsAt: end })}
          />
        ) : (
          <MonthGrid
            rangeStart={rangeStart}
            rangeEnd={rangeEnd}
            events={gridEvents}
            onCreateDay={(day) => {
              const start = new Date(day);
              start.setHours(9, 0, 0, 0);
              const end = new Date(start.getTime() + 60 * 60_000);
              setDialog({ open: true, init: { startsAt: start, endsAt: end } });
            }}
            onEditEvent={(eventId) => setDialog({ open: true, eventId })}
          />
        )}
      </div>

      <EventFormDialog state={dialog} onClose={() => setDialog({ open: false })} />
      <PlanAheadDialog open={planOpen} onOpenChange={setPlanOpen} />
    </div>
  );
}

function openCreate(setDialog: (s: EventDialogState) => void, anchor: Date) {
  const start = new Date(anchor);
  start.setHours(9, 0, 0, 0);
  const end = new Date(start.getTime() + 60 * 60_000);
  setDialog({ open: true, init: { startsAt: start, endsAt: end } });
}

function shortDay(d: Date) {
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
function longDay(d: Date) {
  return d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
}
function rangeLabel(a: Date, b: Date) {
  if (a.getMonth() === b.getMonth()) {
    return `${a.toLocaleDateString(undefined, { month: "long" })} ${a.getDate()}–${b.getDate()}`;
  }
  return `${shortDay(a)} – ${shortDay(b)}`;
}
