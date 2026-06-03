"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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

  // Persist {view, hourHeight} to the user's DB-backed settings so the
  // configuration follows them across devices and server restarts. `loaded`
  // gates the write effect so it only fires AFTER the query's setStates have
  // been applied — otherwise the write would run in the same commit as the
  // read and clobber the saved values with the still-default ones.
  const [loaded, setLoaded] = useState(false);
  const settingsQuery = trpc.settings.get.useQuery();
  const updateSettings = trpc.settings.update.useMutation({
    onError: (e) => toast.error(`Couldn't save settings: ${e.message}`),
  });
  useEffect(() => {
    if (loaded || !settingsQuery.data) return;
    const cal = settingsQuery.data.calendar;
    if (cal?.view) setViewState(cal.view);
    if (typeof cal?.hourHeight === "number") setHourHeight(cal.hourHeight);
    setLoaded(true);
  }, [loaded, settingsQuery.data]);

  // Latest local state in a ref, so the pagehide handler can read it without
  // re-binding on every change.
  const latestRef = useRef({ view, hourHeight });
  latestRef.current = { view, hourHeight };

  useEffect(() => {
    if (!loaded) return;
    // Debounce so dragging the hour-height slider doesn't fire a mutation per step.
    const t = setTimeout(() => {
      updateSettings.mutate({ calendar: { view, hourHeight } });
    }, 250);
    return () => clearTimeout(t);
    // updateSettings is a stable mutation handle from tRPC
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, hourHeight, loaded]);

  // Flush any pending change immediately on tab hide / refresh / nav-away.
  // Without this, a quick refresh after a change would cancel the 250ms
  // debounce and lose the write. We can't await fetch from a pagehide
  // handler, but `keepalive: true` lets the request finish in the background
  // after the page is gone — which is exactly what we want here.
  useEffect(() => {
    if (!loaded) return;
    function flush() {
      // tRPC v11 batch wire format: POST /api/trpc/<proc>?batch=1 with body
      // {"0": {"json": INPUT}}. keepalive lets the request complete after
      // the page is gone — exactly the case we want to cover here.
      const body = JSON.stringify({
        0: { json: { calendar: latestRef.current } },
      });
      try {
        fetch("/api/trpc/settings.update?batch=1", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
          keepalive: true,
        }).catch(() => {});
      } catch {
        // ignore — best-effort
      }
    }
    function onHide() {
      if (document.visibilityState === "hidden") flush();
    }
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, [loaded]);

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
