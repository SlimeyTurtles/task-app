"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Plus, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc/client";
import { addDays, endOfLocalDay, startOfLocalDay, startOfWeek } from "@/lib/scheduling";
import { TimeGrid, type GridEvent } from "@/components/calendar/time-grid";
import { MonthGrid } from "@/components/calendar/month-grid";
import { EventFormDialog, type EventDialogState } from "@/components/calendar/event-form-dialog";
import { PlanAheadDialog } from "@/components/calendar/plan-ahead-dialog";
import { ViewControl, windowFor, type CalendarView } from "@/components/calendar/view-control";

function defaultView(): CalendarView {
  const ws = startOfWeek(new Date());
  const iso = `${ws.getFullYear()}-${String(ws.getMonth() + 1).padStart(2, "0")}-${String(ws.getDate()).padStart(2, "0")}`;
  return { mode: "static", start: iso, span: 7 };
}

export function CalendarClient() {
  const [view, setViewState] = useState<CalendarView>(defaultView);
  const [navOffset, setNavOffset] = useState(0);
  const [hourHeight, setHourHeight] = useState(48);
  const [dialog, setDialog] = useState<EventDialogState>({ open: false });
  const [planOpen, setPlanOpen] = useState(false);

  function setView(v: CalendarView) {
    setViewState(v);
    setNavOffset(0);
  }

  const win = useMemo(() => windowFor(view, navOffset), [view, navOffset]);
  const span = win.span;
  const usesTimeGrid = span <= 7;

  const rangeStart = win.start;
  const rangeEnd = endOfLocalDay(win.end);
  const days = useMemo(
    () => (usesTimeGrid ? Array.from({ length: span }, (_, i) => addDays(rangeStart, i)) : []),
    [usesTimeGrid, span, rangeStart],
  );

  // Box view pads to whole weeks; fetch generously.
  const fetchStart = usesTimeGrid ? rangeStart : startOfWeek(rangeStart);
  const fetchEnd = usesTimeGrid ? rangeEnd : endOfLocalDay(addDays(startOfWeek(win.end), 6));

  const utils = trpc.useUtils();
  const { data: events } = trpc.events.list.useQuery({ start: fetchStart, end: fetchEnd });
  const { data: blocks } = trpc.timeBlocks.occurrences.useQuery({ start: fetchStart, end: fetchEnd });

  const update = trpc.events.update.useMutation({
    onSuccess: () => utils.events.list.invalidate(),
    onError: (e) => {
      toast.error(e.message);
      void utils.events.list.invalidate();
    },
  });

  const gridEvents = (events ?? []) as unknown as GridEvent[];
  const title = rangeLabel(rangeStart, win.end);

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3 flex-wrap shrink-0 mb-3">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => setNavOffset((n) => n - 1)} aria-label="Previous">
            <ChevronLeft className="size-4" />
          </Button>
          <Button variant="outline" onClick={() => setNavOffset(0)} disabled={navOffset === 0}>
            Today
          </Button>
          <Button variant="outline" size="icon" onClick={() => setNavOffset((n) => n + 1)} aria-label="Next">
            <ChevronRight className="size-4" />
          </Button>
          <h2 className="font-heading text-xl font-semibold ml-1">{title}</h2>
        </div>

        <div className="flex items-center gap-2">
          <ViewControl
            view={view}
            onChange={setView}
            hourHeight={hourHeight}
            onHourHeightChange={setHourHeight}
          />
          <Button variant="outline" onClick={() => setPlanOpen(true)}>
            <Sparkles className="size-4" /> Plan ahead
          </Button>
          <Button onClick={() => openCreate(setDialog, rangeStart)}>
            <Plus className="size-4" /> Event
          </Button>
        </div>
      </div>

      {/* Calendar surface */}
      <div className="flex-1 min-h-0 rounded-lg border bg-card overflow-hidden">
        {usesTimeGrid ? (
          <TimeGrid
            days={days}
            events={gridEvents}
            timeBlocks={(blocks ?? []) as never}
            hourHeight={hourHeight}
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
  const start = startOfLocalDay(anchor);
  start.setHours(9, 0, 0, 0);
  const end = new Date(start.getTime() + 60 * 60_000);
  setDialog({ open: true, init: { startsAt: start, endsAt: end } });
}

function rangeLabel(start: Date, end: Date): string {
  const sameDay = start.toDateString() === end.toDateString();
  if (sameDay) return start.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  const sameMonth = start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear();
  if (sameMonth) {
    return `${start.toLocaleDateString(undefined, { month: "long" })} ${start.getDate()}–${end.getDate()}`;
  }
  const s = start.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const e = end.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  return `${s} – ${e}`;
}
