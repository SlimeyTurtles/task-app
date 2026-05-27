"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Plus, Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc/client";
import {
  addDays,
  endOfLocalDay,
  formatDayLabel,
  isSameDay,
  startOfLocalDay,
} from "@/lib/scheduling";
import { DayGrid } from "@/components/calendar/day-grid";
import { InboxPanel } from "@/components/calendar/inbox-panel";
import { EventFormDialog, type EventDialogState } from "@/components/calendar/event-form-dialog";

export function TodayClient() {
  const [day, setDay] = useState(() => startOfLocalDay(new Date()));
  const [dialog, setDialog] = useState<EventDialogState>({ open: false });

  const dayStart = useMemo(() => startOfLocalDay(day), [day]);
  const dayEnd = useMemo(() => endOfLocalDay(day), [day]);

  const { data: events } = trpc.events.list.useQuery({ start: dayStart, end: dayEnd });
  const { data: blocks } = trpc.timeBlocks.list.useQuery({ start: dayStart, end: dayEnd });

  const totals = useMemo(() => {
    let stress = 0;
    let exhaustion = 0;
    let minutes = 0;
    for (const e of events ?? []) {
      const len = (e.endsAt.getTime() - e.startsAt.getTime()) / 60_000;
      minutes += len * e.confidence;
      for (const a of e.attributions) {
        const w = a.weight * e.confidence;
        stress += (a.task.stress ?? 0) * w;
        exhaustion += (a.task.exhaustion ?? 0) * w;
      }
    }
    return { stress, exhaustion, minutes };
  }, [events]);

  return (
    <>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => setDay((d) => addDays(d, -1))}>
            <ChevronLeft className="size-4" />
          </Button>
          <Button
            variant="outline"
            onClick={() => setDay(startOfLocalDay(new Date()))}
            disabled={isSameDay(day, new Date())}
          >
            Today
          </Button>
          <Button variant="outline" size="icon" onClick={() => setDay((d) => addDays(d, 1))}>
            <ChevronRight className="size-4" />
          </Button>
          <h2 className="text-lg font-semibold ml-2">{formatDayLabel(day)}</h2>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <Badge variant="secondary">⚡ {totals.stress.toFixed(0)} stress</Badge>
          <Badge variant="secondary">🪫 {totals.exhaustion.toFixed(0)} exhaustion</Badge>
          <Badge variant="secondary">⏱ {Math.round(totals.minutes)}m logged</Badge>
          <Button onClick={() => openNew(setDialog, day, false)}>
            <Plus className="size-4" /> Log event
          </Button>
          <Button variant="outline" onClick={() => openNew(setDialog, day, true)} title="Log a wide-window low-confidence event">
            <Sparkles className="size-4" /> Lazy log
          </Button>
        </div>
      </div>

      <div className="mt-4 flex gap-4 min-h-0">
        <div className="flex-1 min-w-0 overflow-x-auto">
          <DayGrid
            day={day}
            events={(events ?? []) as never}
            timeBlocks={(blocks ?? []) as never}
            onCreate={(init) => setDialog({ open: true, init })}
            onEdit={(eventId) => setDialog({ open: true, eventId })}
          />
        </div>
        <InboxPanel />
      </div>

      <EventFormDialog state={dialog} onClose={() => setDialog({ open: false })} />
    </>
  );
}

function openNew(
  setDialog: (s: EventDialogState) => void,
  day: Date,
  lazy: boolean,
) {
  const start = new Date(day);
  if (lazy) {
    start.setHours(9, 0, 0, 0);
    const end = new Date(start);
    end.setHours(21, 0, 0, 0);
    setDialog({ open: true, init: { startsAt: start, endsAt: end, lazy: true } });
  } else {
    start.setHours(9, 0, 0, 0);
    const end = new Date(start);
    end.setHours(10, 0, 0, 0);
    setDialog({ open: true, init: { startsAt: start, endsAt: end } });
  }
}
