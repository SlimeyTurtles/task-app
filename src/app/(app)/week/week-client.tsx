"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc/client";
import {
  addDays,
  endOfLocalDay,
  formatWeekLabel,
  isSameDay,
  startOfLocalDay,
  startOfWeek,
} from "@/lib/scheduling";
import { DayGrid } from "@/components/calendar/day-grid";
import { EventFormDialog, type EventDialogState } from "@/components/calendar/event-form-dialog";

export function WeekClient() {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [dialog, setDialog] = useState<EventDialogState>({ open: false });

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const rangeStart = days[0];
  const rangeEnd = endOfLocalDay(days[6]);

  const { data: events } = trpc.events.list.useQuery({ start: rangeStart, end: rangeEnd });
  const { data: blocks } = trpc.timeBlocks.list.useQuery({ start: rangeStart, end: rangeEnd });

  const totalsByDay = useMemo(() => {
    return days.map((d) => {
      const ds = startOfLocalDay(d);
      const de = endOfLocalDay(d);
      let stress = 0;
      let exhaustion = 0;
      let minutes = 0;
      for (const e of events ?? []) {
        if (e.endsAt <= ds || e.startsAt >= de) continue;
        const len = (Math.min(e.endsAt.getTime(), de.getTime()) - Math.max(e.startsAt.getTime(), ds.getTime())) / 60_000;
        minutes += len * e.confidence;
        for (const a of e.attributions) {
          const w = a.weight * e.confidence;
          stress += (a.task.stress ?? 0) * w;
          exhaustion += (a.task.exhaustion ?? 0) * w;
        }
      }
      return { stress, exhaustion, minutes };
    });
  }, [days, events]);

  return (
    <>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => setWeekStart((d) => addDays(d, -7))}>
            <ChevronLeft className="size-4" />
          </Button>
          <Button variant="outline" onClick={() => setWeekStart(startOfWeek(new Date()))}>
            This week
          </Button>
          <Button variant="outline" size="icon" onClick={() => setWeekStart((d) => addDays(d, 7))}>
            <ChevronRight className="size-4" />
          </Button>
          <h2 className="text-lg font-semibold ml-2">{formatWeekLabel(weekStart)}</h2>
        </div>
        <Button onClick={() => setDialog({
          open: true,
          init: { startsAt: defaultEventStart(weekStart), endsAt: defaultEventEnd(weekStart) },
        })}>
          <Plus className="size-4" /> Log event
        </Button>
      </div>

      <div className="mt-4 overflow-x-auto">
        <div className="grid grid-cols-[3.25rem_repeat(7,minmax(11rem,1fr))] gap-2">
          <div />
          {days.map((d, i) => (
            <div key={d.toISOString()} className="text-xs">
              <div className={`font-medium ${isSameDay(d, new Date()) ? "text-foreground" : "text-muted-foreground"}`}>
                {d.toLocaleDateString(undefined, { weekday: "short" })} {d.getDate()}
              </div>
              <div className="flex flex-wrap gap-1 mt-1">
                <Badge variant="outline" className="text-[10px] font-normal">
                  ⚡ {Math.round(totalsByDay[i].stress)}
                </Badge>
                <Badge variant="outline" className="text-[10px] font-normal">
                  🪫 {Math.round(totalsByDay[i].exhaustion)}
                </Badge>
              </div>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-[3.25rem_repeat(7,minmax(11rem,1fr))] gap-2 mt-2">
          <DayHourRail />
          {days.map((d) => (
            <DayGrid
              key={d.toISOString()}
              day={d}
              events={(events ?? []) as never}
              timeBlocks={(blocks ?? []) as never}
              showHourLabels={false}
              compact
              onCreate={(init) => setDialog({ open: true, init })}
              onEdit={(eventId) => setDialog({ open: true, eventId })}
            />
          ))}
        </div>
      </div>

      <EventFormDialog state={dialog} onClose={() => setDialog({ open: false })} />
    </>
  );
}

function defaultEventStart(weekStart: Date): Date {
  const out = new Date(weekStart);
  out.setHours(9, 0, 0, 0);
  return out;
}

function defaultEventEnd(weekStart: Date): Date {
  const out = new Date(weekStart);
  out.setHours(10, 0, 0, 0);
  return out;
}

function DayHourRail() {
  const HOURS_VISIBLE_LOCAL = 24 - 6;
  return (
    <div
      className="relative shrink-0 text-xs text-muted-foreground"
      style={{ height: HOURS_VISIBLE_LOCAL * 56 }}
    >
      {Array.from({ length: HOURS_VISIBLE_LOCAL + 1 }, (_, i) => {
        const h = 6 + i;
        const label =
          h === 0 || h === 24 ? "12a" : h === 12 ? "12p" : h < 12 ? `${h}a` : `${h - 12}p`;
        return (
          <div
            key={h}
            className="absolute right-2 -translate-y-1/2 select-none"
            style={{ top: i * 56 }}
          >
            {h === 6 ? "" : label}
          </div>
        );
      })}
    </div>
  );
}
