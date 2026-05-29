"use client";

import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { EventKind } from "@prisma/client";

import { cn } from "@/lib/utils";
import { formatHour, formatTime, isSameDay, startOfLocalDay } from "@/lib/scheduling";

const DAY_MS = 24 * 60 * 60_000;
const WINDOW_MINUTES = 24 * 60; // full day, fits viewport (no scroll)
const SNAP = 15;
const MIN_DURATION_MS = 15 * 60_000;
const DRAG_THRESHOLD_MIN = 8;

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
      startMin: number;
      curDayIndex: number;
      curMin: number;
      grabOffsetMs?: number; // move: pointer time − event start
      durationMs?: number; // move
      fixedStart?: number; // resize: event start (ms)
      moved: boolean;
    };

function snapMin(min: number): number {
  return Math.round(min / SNAP) * SNAP;
}
function clampMin(min: number): number {
  return Math.max(0, Math.min(WINDOW_MINUTES, min));
}
function windowMinToDate(day: Date, min: number): Date {
  const d = startOfLocalDay(day);
  d.setMinutes(min);
  return d;
}
function snapDateMs(ms: number): number {
  const step = SNAP * 60_000;
  return Math.round(ms / step) * step;
}
function clampToDay(startMs: number, endMs: number, day: Date): { topPct: number; heightPct: number } | null {
  const dayStart = startOfLocalDay(day).getTime();
  const dayEnd = dayStart + DAY_MS;
  const s = Math.max(startMs, dayStart);
  const e = Math.min(endMs, dayEnd);
  if (e <= s) return null;
  return {
    topPct: ((s - dayStart) / DAY_MS) * 100,
    heightPct: Math.max(((e - s) / DAY_MS) * 100, 1.2),
  };
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
    const m = snapMin(min);
    setDrag({ mode: "create", startDayIndex: dayIndex, startMin: m, curDayIndex: dayIndex, curMin: m, moved: false });
  }

  function beginMove(e: ReactPointerEvent, ev: GridEvent, dayIndex: number) {
    e.stopPropagation();
    if (e.button !== 0) return;
    const { min } = readPointer(e.clientX, e.clientY);
    const grabTime = windowMinToDate(days[dayIndex], min).getTime();
    setDrag({
      mode: "move",
      eventId: ev.id,
      startDayIndex: dayIndex,
      startMin: min,
      curDayIndex: dayIndex,
      curMin: min,
      grabOffsetMs: grabTime - ev.startsAt.getTime(),
      durationMs: ev.endsAt.getTime() - ev.startsAt.getTime(),
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
      startMin: min,
      curDayIndex: dayIndex,
      curMin: min,
      fixedStart: ev.startsAt.getTime(),
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
      if (d) commit(d);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag?.mode, drag?.eventId, days.length, pxPerMin]);

  // Resolve a drag to an absolute [start, end] range (ms) for preview + commit.
  function resolveRange(d: NonNullable<DragState>): { start: number; end: number } {
    if (d.mode === "create") {
      const anchor = windowMinToDate(days[d.startDayIndex], snapMin(d.startMin)).getTime();
      const cur = windowMinToDate(days[d.curDayIndex], snapMin(d.curMin)).getTime();
      let start = Math.min(anchor, cur);
      let end = Math.max(anchor, cur);
      if (end - start < MIN_DURATION_MS) end = start + 60 * 60_000; // click → 1h
      return { start, end };
    }
    if (d.mode === "move") {
      const curTime = windowMinToDate(days[d.curDayIndex], d.curMin).getTime();
      const start = snapDateMs(curTime - (d.grabOffsetMs ?? 0));
      return { start, end: start + (d.durationMs ?? 60 * 60_000) };
    }
    // resize
    const start = d.fixedStart!;
    const curTime = windowMinToDate(days[d.curDayIndex], snapMin(d.curMin)).getTime();
    const end = Math.max(curTime, start + MIN_DURATION_MS);
    return { start, end };
  }

  function commit(d: NonNullable<DragState>) {
    if (d.mode === "create" && !d.moved) {
      const start = windowMinToDate(days[d.startDayIndex], snapMin(d.startMin));
      onCreateRange(start, new Date(start.getTime() + 60 * 60_000));
      return;
    }
    if (d.mode === "move" && !d.moved) {
      if (d.eventId) onEditEvent(d.eventId);
      return;
    }
    const { start, end } = resolveRange(d);
    if (d.mode === "create") onCreateRange(new Date(start), new Date(end));
    else if (d.mode === "move" && d.eventId) onMoveEvent(d.eventId, new Date(start), new Date(end));
    else if (d.mode === "resize" && d.eventId) onResizeEvent(d.eventId, new Date(start), new Date(end));
  }

  const previewRange = drag && drag.moved ? resolveRange(drag) : null;
  const draggedEventId = drag && drag.moved ? drag.eventId : undefined;

  const hours = Array.from({ length: 25 }, (_, i) => i);

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
              <div className={cn("font-heading text-lg leading-none mt-0.5", today && "text-primary")}>
                {d.getDate()}
              </div>
            </div>
          );
        })}
      </div>

      {/* Body */}
      <div className="grid flex-1 min-h-0" style={{ gridTemplateColumns: `3.25rem repeat(${days.length}, minmax(0,1fr))` }}>
        {/* Hour rail */}
        <div className="relative">
          {hours.map((h, i) => {
            if (i === hours.length - 1) return null;
            return (
              <div
                key={h}
                className={cn(
                  "absolute right-1.5 text-[0.7rem] text-muted-foreground tabular-nums",
                  i === 0 ? "top-0" : "-translate-y-1/2",
                )}
                style={i === 0 ? undefined : { top: `${(i / (hours.length - 1)) * 100}%` }}
              >
                {formatHour(h)}
              </div>
            );
          })}
        </div>

        {/* Columns */}
        <div
          ref={colsRef}
          data-testid="time-grid"
          className="relative grid"
          style={{ gridColumn: `2 / span ${days.length}`, gridTemplateColumns: `repeat(${days.length}, minmax(0,1fr))` }}
        >
          {hours.slice(0, -1).map((h, i) => (
            <div
              key={`line-${h}`}
              className="absolute left-0 right-0 border-t border-border/50 pointer-events-none"
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
              previewRange={previewRange}
              draggedEventId={draggedEventId}
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
  previewRange,
  draggedEventId,
  onPointerDownEmpty,
  onPointerDownEvent,
  onPointerDownResize,
}: {
  day: Date;
  dayIndex: number;
  isLast: boolean;
  events: GridEvent[];
  blocks: GridBlock[];
  previewRange: { start: number; end: number } | null;
  draggedEventId?: string;
  onPointerDownEmpty: (e: ReactPointerEvent) => void;
  onPointerDownEvent: (e: ReactPointerEvent, ev: GridEvent, dayIndex: number) => void;
  onPointerDownResize: (e: ReactPointerEvent, ev: GridEvent, dayIndex: number) => void;
}) {
  const dayStart = startOfLocalDay(day).getTime();
  const dayEnd = dayStart + DAY_MS;

  const dayEvents = events.filter((e) => e.startsAt.getTime() < dayEnd && e.endsAt.getTime() > dayStart);
  const dayBlocks = blocks.filter((b) => b.startsAt.getTime() < dayEnd && b.endsAt.getTime() > dayStart);
  const laned = assignLanes(dayEvents);

  const now = new Date();
  const showNow = isSameDay(day, now);
  const nowPct = ((now.getTime() - dayStart) / DAY_MS) * 100;

  const previewPos = previewRange ? clampToDay(previewRange.start, previewRange.end, day) : null;

  return (
    <div className={cn("relative h-full", !isLast && "border-r")} onPointerDown={onPointerDownEmpty}>
      {/* background blocks */}
      {dayBlocks.map((b) => {
        const pos = clampToDay(b.startsAt.getTime(), b.endsAt.getTime(), day);
        if (!pos) return null;
        return (
          <div
            key={b.id}
            className={cn("absolute left-0 right-0 pointer-events-none", blockBg(b.kind))}
            style={{ top: `${pos.topPct}%`, height: `${pos.heightPct}%` }}
          >
            {b.label ? <div className="px-1 pt-0.5 text-[0.62rem] text-muted-foreground/80">{b.label}</div> : null}
          </div>
        );
      })}

      {/* events */}
      {laned.map(({ ev, lane, lanes }) => {
        const pos = clampToDay(ev.startsAt.getTime(), ev.endsAt.getTime(), day);
        if (!pos) return null;
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
        const isDragging = draggedEventId === ev.id;
        const multiDay = ev.endsAt.getTime() > dayEnd || ev.startsAt.getTime() < dayStart;
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
              top: `${pos.topPct}%`,
              height: `${pos.heightPct}%`,
              left: `calc(${lane * widthPct}% + 2px)`,
              width: `calc(${widthPct}% - 4px)`,
              backgroundColor: `color-mix(in oklch, ${color} 22%, var(--card))`,
              borderColor: color,
            }}
          >
            <div className="px-1.5 py-0.5 font-medium leading-tight truncate">{label}</div>
            <div className="px-1.5 text-[0.62rem] text-muted-foreground tabular-nums">
              {formatTime(ev.startsAt)}
              {multiDay ? " →" : ""}
            </div>
            {/* resize handle only on the day the event actually ends */}
            {ev.endsAt.getTime() <= dayEnd ? (
              <div
                onPointerDown={(e) => onPointerDownResize(e, ev, dayIndex)}
                className="absolute bottom-0 left-0 right-0 h-2 cursor-ns-resize"
              />
            ) : null}
          </div>
        );
      })}

      {/* drag preview */}
      {previewPos ? (
        <div
          className="absolute left-0.5 right-0.5 rounded-md border-2 border-primary bg-primary/15 pointer-events-none z-20"
          style={{ top: `${previewPos.topPct}%`, height: `${previewPos.heightPct}%` }}
        >
          <div className="px-1 text-[0.62rem] font-medium text-primary tabular-nums">
            {formatTime(new Date(previewRange!.start))} – {formatTime(new Date(previewRange!.end))}
          </div>
        </div>
      ) : null}

      {showNow ? (
        <div className="absolute left-0 right-0 z-10 pointer-events-none" style={{ top: `${nowPct}%` }}>
          <div className="h-px bg-destructive" />
          <div className="absolute -left-1 -top-1 size-2 rounded-full bg-destructive" />
        </div>
      ) : null}
    </div>
  );
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
