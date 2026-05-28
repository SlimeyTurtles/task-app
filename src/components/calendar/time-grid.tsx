"use client";

import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { EventKind } from "@prisma/client";

import { cn } from "@/lib/utils";
import {
  DAY_START_HOUR,
  DAY_END_HOUR,
  formatHour,
  formatTime,
  isSameDay,
  startOfLocalDay,
} from "@/lib/scheduling";

const WINDOW_MINUTES = (DAY_END_HOUR - DAY_START_HOUR) * 60;
const SNAP = 15;
const MIN_DURATION = 15;
const DRAG_THRESHOLD_MIN = 10;

type EventTask = {
  id: string;
  name: string;
  area: { id: string; name: string; color: string | null } | null;
};
export type GridEvent = {
  id: string;
  startsAt: Date;
  endsAt: Date;
  kind: EventKind;
  confidence: number;
  notes: string | null;
  attributions: { task: EventTask }[];
};
type GridBlock = { id: string; startsAt: Date; endsAt: Date; kind: string; label: string | null };

type DragState =
  | null
  | {
      mode: "create" | "move" | "resize";
      eventId?: string;
      startDayIndex: number;
      startMin: number; // window-relative minutes at pointer down
      curDayIndex: number;
      curMin: number;
      grabOffsetMin?: number; // for move: how far into the event the grab was
      durationMin?: number; // for move
      moved: boolean;
    };

function snap(min: number): number {
  return Math.round(min / SNAP) * SNAP;
}
function clampMin(min: number): number {
  return Math.max(0, Math.min(WINDOW_MINUTES, min));
}
function dateToWindowMin(d: Date): number {
  return d.getHours() * 60 + d.getMinutes() - DAY_START_HOUR * 60;
}
function windowMinToDate(day: Date, min: number): Date {
  const d = startOfLocalDay(day);
  d.setMinutes(DAY_START_HOUR * 60 + min);
  return d;
}

export function TimeGrid({
  days,
  events,
  timeBlocks,
  onCreateRange,
  onMoveEvent,
  onResizeEvent,
  onEditEvent,
}: {
  days: Date[];
  events: GridEvent[];
  timeBlocks: GridBlock[];
  onCreateRange: (start: Date, end: Date) => void;
  onMoveEvent: (eventId: string, start: Date, end: Date) => void;
  onResizeEvent: (eventId: string, start: Date, end: Date) => void;
  onEditEvent: (eventId: string) => void;
}) {
  const colsRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(640);
  const [drag, setDragState] = useState<DragState>(null);
  // Mirror of `drag` so pointerup can read the latest value and commit
  // *outside* of a state updater (committing inside the updater would call
  // the parent's setState during render — the "setState while rendering" bug).
  const dragRef = useRef<DragState>(null);
  function setDrag(next: DragState) {
    dragRef.current = next;
    setDragState(next);
  }

  useLayoutEffect(() => {
    const el = colsRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHeight(el.clientHeight));
    ro.observe(el);
    setHeight(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  const pxPerMin = height / WINDOW_MINUTES;

  // Read window-relative minutes + day index from a pointer event.
  function readPointer(clientX: number, clientY: number): { dayIndex: number; min: number } {
    const el = colsRef.current!;
    const rect = el.getBoundingClientRect();
    const colWidth = rect.width / days.length;
    const dayIndex = Math.max(0, Math.min(days.length - 1, Math.floor((clientX - rect.left) / colWidth)));
    const min = clampMin((clientY - rect.top) / pxPerMin);
    return { dayIndex, min };
  }

  function beginCreate(e: ReactPointerEvent, dayIndex: number) {
    if (e.button !== 0) return;
    const { min } = readPointer(e.clientX, e.clientY);
    const m = snap(min);
    setDrag({ mode: "create", startDayIndex: dayIndex, startMin: m, curDayIndex: dayIndex, curMin: m, moved: false });
  }

  function beginMove(e: ReactPointerEvent, ev: GridEvent, dayIndex: number) {
    e.stopPropagation();
    if (e.button !== 0) return;
    const { min } = readPointer(e.clientX, e.clientY);
    const evStartMin = dateToWindowMin(ev.startsAt);
    const durationMin = (ev.endsAt.getTime() - ev.startsAt.getTime()) / 60_000;
    setDrag({
      mode: "move",
      eventId: ev.id,
      startDayIndex: dayIndex,
      startMin: min,
      curDayIndex: dayIndex,
      curMin: min,
      grabOffsetMin: min - evStartMin,
      durationMin,
      moved: false,
    });
  }

  function beginResize(e: ReactPointerEvent, ev: GridEvent, dayIndex: number) {
    e.stopPropagation();
    if (e.button !== 0) return;
    const { min } = readPointer(e.clientX, e.clientY);
    setDrag({
      mode: "resize",
      eventId: ev.id,
      startDayIndex: dayIndex,
      startMin: dateToWindowMin(ev.startsAt),
      curDayIndex: dayIndex,
      curMin: min,
      moved: false,
    });
  }

  useEffect(() => {
    if (!drag) return;
    function onMove(e: PointerEvent) {
      const d = dragRef.current;
      if (!d) return;
      const { dayIndex, min } = readPointer(e.clientX, e.clientY);
      const moved = d.moved || Math.abs(min - d.startMin) > DRAG_THRESHOLD_MIN || dayIndex !== d.startDayIndex;
      setDrag({ ...d, curDayIndex: dayIndex, curMin: min, moved });
    }
    function onUp() {
      const d = dragRef.current;
      setDrag(null);
      if (d) commit(d); // runs in the event handler, not during render
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag?.mode, drag?.eventId, days.length, pxPerMin]);

  function commit(d: NonNullable<DragState>) {
    if (d.mode === "create") {
      if (!d.moved) {
        // click → default 1h block
        const start = windowMinToDate(days[d.startDayIndex], snap(d.startMin));
        const end = new Date(start.getTime() + 60 * 60_000);
        onCreateRange(start, end);
        return;
      }
      const a = snap(Math.min(d.startMin, d.curMin));
      const b = snap(Math.max(d.startMin, d.curMin));
      const start = windowMinToDate(days[d.startDayIndex], a);
      const end = windowMinToDate(days[d.startDayIndex], Math.max(b, a + MIN_DURATION));
      onCreateRange(start, end);
    } else if (d.mode === "move") {
      if (!d.moved) {
        if (d.eventId) onEditEvent(d.eventId);
        return;
      }
      const newStartMin = snap(d.curMin - (d.grabOffsetMin ?? 0));
      const start = windowMinToDate(days[d.curDayIndex], newStartMin);
      const end = new Date(start.getTime() + (d.durationMin ?? 60) * 60_000);
      if (d.eventId) onMoveEvent(d.eventId, start, end);
    } else if (d.mode === "resize") {
      const endMin = snap(Math.max(d.curMin, d.startMin + MIN_DURATION));
      const start = windowMinToDate(days[d.startDayIndex], d.startMin);
      const end = windowMinToDate(days[d.startDayIndex], endMin);
      if (d.eventId) onResizeEvent(d.eventId, start, end);
    }
  }

  const hours = Array.from({ length: DAY_END_HOUR - DAY_START_HOUR + 1 }, (_, i) => DAY_START_HOUR + i);

  return (
    <div className="flex flex-col h-full min-h-0 select-none">
      {/* Day headers */}
      <div
        className="grid shrink-0 border-b"
        style={{ gridTemplateColumns: `3.25rem repeat(${days.length}, minmax(0,1fr))` }}
      >
        <div />
        {days.map((d) => {
          const today = isSameDay(d, new Date());
          return (
            <div key={d.toISOString()} className="px-2 py-2 text-center border-l first:border-l-0">
              <div className="text-[0.7rem] uppercase tracking-wide text-muted-foreground">
                {d.toLocaleDateString(undefined, { weekday: "short" })}
              </div>
              <div
                className={cn(
                  "font-heading text-lg leading-none mt-0.5",
                  today && "text-primary",
                )}
              >
                {d.getDate()}
              </div>
            </div>
          );
        })}
      </div>

      {/* Body */}
      <div
        className="grid flex-1 min-h-0"
        style={{ gridTemplateColumns: `3.25rem repeat(${days.length}, minmax(0,1fr))` }}
      >
        {/* Hour rail */}
        <div className="relative">
          {hours.map((h, i) => {
            const isFirst = i === 0;
            const isLast = i === hours.length - 1;
            if (isLast) return null; // 24:00 line coincides with the next day's top
            return (
            <div
              key={h}
              className={cn(
                "absolute right-1.5 text-[0.7rem] text-muted-foreground tabular-nums",
                isFirst ? "top-0" : "-translate-y-1/2",
              )}
              style={isFirst ? undefined : { top: `${(i / (hours.length - 1)) * 100}%` }}
            >
              {formatHour(h)}
            </div>
            );
          })}
        </div>

        {/* Columns container (measured) */}
        <div ref={colsRef} data-testid="time-grid" className="relative col-span-full col-start-2 grid"
          style={{ gridColumn: `2 / span ${days.length}`, gridTemplateColumns: `repeat(${days.length}, minmax(0,1fr))` }}
        >
          {/* hour gridlines spanning all columns */}
          {hours.slice(0, -1).map((h, i) => (
            <div
              key={`line-${h}`}
              className="absolute left-0 right-0 border-t border-border/60 pointer-events-none"
              style={{ top: `${(i / (hours.length - 1)) * 100}%` }}
            />
          ))}

          {days.map((day, dayIndex) => (
            <DayColumn
              key={day.toISOString()}
              day={day}
              dayIndex={dayIndex}
              isLast={dayIndex === days.length - 1}
              events={events}
              blocks={timeBlocks}
              pxPerMin={pxPerMin}
              drag={drag}
              onPointerDownEmpty={(e) => beginCreate(e, dayIndex)}
              onPointerDownEvent={beginMove}
              onPointerDownResize={beginResize}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function DayColumn({
  day,
  dayIndex,
  isLast,
  events,
  blocks,
  pxPerMin,
  drag,
  onPointerDownEmpty,
  onPointerDownEvent,
  onPointerDownResize,
}: {
  day: Date;
  dayIndex: number;
  isLast: boolean;
  events: GridEvent[];
  blocks: GridBlock[];
  pxPerMin: number;
  drag: DragState;
  onPointerDownEmpty: (e: ReactPointerEvent) => void;
  onPointerDownEvent: (e: ReactPointerEvent, ev: GridEvent, dayIndex: number) => void;
  onPointerDownResize: (e: ReactPointerEvent, ev: GridEvent, dayIndex: number) => void;
}) {
  const dayStart = startOfLocalDay(day);
  const dayEnd = new Date(dayStart);
  dayEnd.setHours(23, 59, 59, 999);

  const dayEvents = events.filter((e) => e.startsAt <= dayEnd && e.endsAt >= dayStart);
  const dayBlocks = blocks.filter((b) => b.startsAt <= dayEnd && b.endsAt >= dayStart);

  // lane assignment within day for overlaps
  const laned = assignLanes(dayEvents);

  function topPct(d: Date): number {
    return (clampMin(dateToWindowMin(d)) / WINDOW_MINUTES) * 100;
  }
  function heightPct(s: Date, e: Date): number {
    const a = clampMin(dateToWindowMin(s));
    const b = clampMin(dateToWindowMin(e));
    return Math.max(((b - a) / WINDOW_MINUTES) * 100, 1.2);
  }

  const now = new Date();
  const showNow = isSameDay(day, now);
  const nowPct = (clampMin(dateToWindowMin(now)) / WINDOW_MINUTES) * 100;

  // live preview for active drag targeting this column
  let preview: { topPct: number; heightPct: number; label: string } | null = null;
  if (drag && drag.moved) {
    if (drag.mode === "create" && drag.startDayIndex === dayIndex) {
      const a = Math.min(drag.startMin, drag.curMin);
      const b = Math.max(drag.startMin, drag.curMin);
      preview = {
        topPct: (a / WINDOW_MINUTES) * 100,
        heightPct: (Math.max(b - a, MIN_DURATION) / WINDOW_MINUTES) * 100,
        label: `${fmtMin(a)} – ${fmtMin(b)}`,
      };
    } else if (drag.mode === "move" && drag.curDayIndex === dayIndex && drag.durationMin != null) {
      const ns = drag.curMin - (drag.grabOffsetMin ?? 0);
      preview = {
        topPct: (clampMin(ns) / WINDOW_MINUTES) * 100,
        heightPct: (drag.durationMin / WINDOW_MINUTES) * 100,
        label: `${fmtMin(ns)}`,
      };
    } else if (drag.mode === "resize" && drag.startDayIndex === dayIndex) {
      const end = Math.max(drag.curMin, drag.startMin + MIN_DURATION);
      preview = {
        topPct: (drag.startMin / WINDOW_MINUTES) * 100,
        heightPct: ((end - drag.startMin) / WINDOW_MINUTES) * 100,
        label: `${fmtMin(drag.startMin)} – ${fmtMin(end)}`,
      };
    }
  }

  const beingDragged = drag?.eventId;

  return (
    <div
      className={cn("relative h-full", !isLast && "border-r")}
      onPointerDown={onPointerDownEmpty}
    >
      {/* background blocks */}
      {dayBlocks.map((b) => (
        <div
          key={b.id}
          className={cn("absolute left-0 right-0 pointer-events-none", blockBg(b.kind))}
          style={{ top: `${topPct(b.startsAt)}%`, height: `${heightPct(b.startsAt, b.endsAt)}%` }}
        >
          {b.label ? <div className="px-1 pt-0.5 text-[0.65rem] text-muted-foreground/80">{b.label}</div> : null}
        </div>
      ))}

      {/* events */}
      {laned.map(({ ev, lane, lanes }) => {
        const lazy = ev.confidence < 1;
        const titleTask = ev.attributions[0]?.task;
        const label =
          ev.attributions.length === 0
            ? "Untitled"
            : ev.attributions.length === 1
            ? titleTask?.name ?? "Event"
            : `${ev.attributions.length} parallel`;
        const color = titleTask?.area?.color ?? "var(--primary)";
        const widthPct = 100 / lanes;
        const isDragging = beingDragged === ev.id;
        return (
          <div
            key={ev.id}
            onPointerDown={(e) => onPointerDownEvent(e, ev, dayIndex)}
            className={cn(
              "absolute rounded-md overflow-hidden border text-[0.7rem] cursor-grab active:cursor-grabbing shadow-sm",
              lazy && "border-dashed",
              isDragging && "opacity-40",
            )}
            style={{
              top: `${topPct(ev.startsAt)}%`,
              height: `${heightPct(ev.startsAt, ev.endsAt)}%`,
              left: `calc(${lane * widthPct}% + 2px)`,
              width: `calc(${widthPct}% - 4px)`,
              backgroundColor: `color-mix(in oklch, ${color} 22%, var(--card))`,
              borderColor: color,
            }}
          >
            <div className="px-1.5 py-0.5 font-medium leading-tight truncate" style={{ color: "var(--foreground)" }}>
              {label}
            </div>
            <div className="px-1.5 text-[0.62rem] text-muted-foreground tabular-nums">
              {formatTime(ev.startsAt)}
            </div>
            {/* resize handle */}
            <div
              onPointerDown={(e) => onPointerDownResize(e, ev, dayIndex)}
              className="absolute bottom-0 left-0 right-0 h-2 cursor-ns-resize"
            />
          </div>
        );
      })}

      {/* drag preview */}
      {preview ? (
        <div
          className="absolute left-0.5 right-0.5 rounded-md border-2 border-primary bg-primary/15 pointer-events-none z-20"
          style={{ top: `${preview.topPct}%`, height: `${preview.heightPct}%` }}
        >
          <div className="px-1 text-[0.62rem] font-medium text-primary tabular-nums">{preview.label}</div>
        </div>
      ) : null}

      {/* now line */}
      {showNow ? (
        <div className="absolute left-0 right-0 z-10 pointer-events-none" style={{ top: `${nowPct}%` }}>
          <div className="h-px bg-destructive" />
          <div className="absolute -left-1 -top-1 size-2 rounded-full bg-destructive" />
        </div>
      ) : null}
    </div>
  );
}

function fmtMin(windowMin: number): string {
  const total = DAY_START_HOUR * 60 + windowMin;
  const h = Math.floor(total / 60);
  const m = Math.round((total % 60) / SNAP) * SNAP;
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return formatTime(d);
}

function blockBg(kind: string): string {
  switch (kind) {
    case "SLEEP": return "bg-indigo-500/10";
    case "WORK_HOURS": return "bg-amber-500/10";
    case "FOCUS": return "bg-emerald-500/10";
    case "REST": return "bg-sky-500/10";
    case "COMMUTE": return "bg-rose-500/10";
    case "MEAL": return "bg-orange-500/10";
    default: return "bg-muted/50";
  }
}

type Laned = { ev: GridEvent; lane: number; lanes: number };
function assignLanes(items: GridEvent[]): Laned[] {
  const sorted = [...items].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  const result: Laned[] = [];
  let cluster: GridEvent[] = [];
  let clusterEnd = 0;
  const flush = () => {
    if (cluster.length === 0) return;
    const laneEnds: number[] = [];
    const assign = cluster.map((ev) => {
      let lane = laneEnds.findIndex((end) => end <= ev.startsAt.getTime());
      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(ev.endsAt.getTime());
      } else {
        laneEnds[lane] = ev.endsAt.getTime();
      }
      return { ev, lane };
    });
    for (const a of assign) result.push({ ...a, lanes: laneEnds.length });
    cluster = [];
  };
  for (const ev of sorted) {
    if (cluster.length && ev.startsAt.getTime() < clusterEnd) {
      cluster.push(ev);
      clusterEnd = Math.max(clusterEnd, ev.endsAt.getTime());
    } else {
      flush();
      cluster = [ev];
      clusterEnd = ev.endsAt.getTime();
    }
  }
  flush();
  return result;
}
