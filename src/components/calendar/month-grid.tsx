"use client";

import { EventKind } from "@prisma/client";

import { cn } from "@/lib/utils";
import { addDays, isSameDay, startOfLocalDay, startOfWeek, formatTime } from "@/lib/scheduling";
import { eventLabel, type GridEvent } from "./time-grid";

/**
 * Calendar "box" view for ranges wider than a week. Renders full weeks
 * covering [rangeStart, rangeEnd] as a grid of day cells with event chips.
 */
export function MonthGrid({
  rangeStart,
  rangeEnd,
  events,
  onCreateDay,
  onEditEvent,
}: {
  rangeStart: Date;
  rangeEnd: Date;
  events: GridEvent[];
  onCreateDay: (day: Date) => void;
  onEditEvent: (eventId: string) => void;
}) {
  const gridStart = startOfWeek(rangeStart);
  const lastWeek = startOfWeek(rangeEnd);
  const weeks: Date[][] = [];
  let cursor = gridStart;
  while (cursor <= lastWeek) {
    weeks.push(Array.from({ length: 7 }, (_, i) => addDays(cursor, i)));
    cursor = addDays(cursor, 7);
  }

  const dayNames = Array.from({ length: 7 }, (_, i) => addDays(gridStart, i)).map((d) =>
    d.toLocaleDateString(undefined, { weekday: "short" }),
  );

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="grid grid-cols-7 shrink-0 border-b">
        {dayNames.map((n) => (
          <div key={n} className="px-2 py-1.5 text-[0.7rem] uppercase tracking-wide text-muted-foreground text-center border-l first:border-l-0">
            {n}
          </div>
        ))}
      </div>
      <div className="flex-1 min-h-0 grid" style={{ gridTemplateRows: `repeat(${weeks.length}, minmax(0,1fr))` }}>
        {weeks.map((week, wi) => (
          <div key={wi} className="grid grid-cols-7 border-b last:border-b-0">
            {week.map((day) => (
              <MonthCell
                key={day.toISOString()}
                day={day}
                inRange={day >= startOfLocalDay(rangeStart) && day <= rangeEnd}
                events={events}
                onCreateDay={onCreateDay}
                onEditEvent={onEditEvent}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function MonthCell({
  day,
  inRange,
  events,
  onCreateDay,
  onEditEvent,
}: {
  day: Date;
  inRange: boolean;
  events: GridEvent[];
  onCreateDay: (day: Date) => void;
  onEditEvent: (eventId: string) => void;
}) {
  const dayStart = startOfLocalDay(day);
  const dayEnd = new Date(dayStart);
  dayEnd.setHours(23, 59, 59, 999);
  const dayEvents = events
    .filter((e) => e.startsAt <= dayEnd && e.endsAt >= dayStart)
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());

  const today = isSameDay(day, new Date());
  const MAX = 3;

  return (
    <button
      type="button"
      onClick={() => onCreateDay(day)}
      className={cn(
        "relative text-left border-l first:border-l-0 p-1 overflow-hidden hover:bg-accent/30 transition-colors flex flex-col gap-0.5",
        !inRange && "bg-muted/30 text-muted-foreground",
      )}
    >
      <div className="flex items-center justify-between px-0.5">
        <span
          className={cn(
            "text-xs tabular-nums size-5 inline-flex items-center justify-center rounded-full",
            today && "bg-primary text-primary-foreground font-medium",
          )}
        >
          {day.getDate()}
        </span>
      </div>
      {dayEvents.slice(0, MAX).map((ev) => {
        const task = ev.attributions[0]?.task;
        const color = task?.area?.color ?? "var(--primary)";
        const label = eventLabel(ev);
        return (
          <span
            key={ev.id}
            onClick={(e) => {
              e.stopPropagation();
              onEditEvent(ev.id);
            }}
            className="flex items-center gap-1 rounded px-1 py-0.5 text-[0.68rem] leading-tight truncate hover:brightness-95"
            style={{ backgroundColor: `color-mix(in oklch, ${color} 22%, var(--card))` }}
          >
            <span className="size-1.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
            <span className="tabular-nums text-muted-foreground">{formatTime(ev.startsAt).replace(":00", "")}</span>
            <span className="truncate">{label}</span>
          </span>
        );
      })}
      {dayEvents.length > MAX ? (
        <span className="px-1 text-[0.65rem] text-muted-foreground">+{dayEvents.length - MAX} more</span>
      ) : null}
    </button>
  );
}
