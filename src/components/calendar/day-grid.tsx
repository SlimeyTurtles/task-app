"use client";

import { useEffect, useRef, useState, type DragEvent as ReactDragEvent } from "react";
import { EventKind } from "@prisma/client";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import {
  DAY_START_HOUR,
  DAY_END_HOUR,
  GRID_HEIGHT,
  PX_PER_HOUR,
  PX_PER_MINUTE,
  assignLanes,
  dateRangeToPx,
  formatHour,
  formatTime,
  isSameDay,
  pxToDate,
  startOfLocalDay,
} from "@/lib/scheduling";
import { trpc } from "@/lib/trpc/client";
import type { EventDialogState } from "./event-form-dialog";

type EventTask = {
  id: string;
  name: string;
  area: { id: string; name: string; color: string | null } | null;
};
type EventWithAttributions = {
  id: string;
  startsAt: Date;
  endsAt: Date;
  kind: EventKind;
  confidence: number;
  notes: string | null;
  attributions: { task: EventTask }[];
};
type TimeBlock = {
  id: string;
  startsAt: Date;
  endsAt: Date;
  kind: string;
  label: string | null;
};

export function DayGrid({
  day,
  events,
  timeBlocks,
  showHourLabels = true,
  compact = false,
  onCreate,
  onEdit,
}: {
  day: Date;
  events: EventWithAttributions[];
  timeBlocks: TimeBlock[];
  showHourLabels?: boolean;
  compact?: boolean;
  onCreate: (init: EventDialogState["init"]) => void;
  onEdit: (eventId: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dragOverY, setDragOverY] = useState<number | null>(null);
  const [hoverTime, setHoverTime] = useState<string | null>(null);
  const utils = trpc.useUtils();
  const logTask = trpc.events.logTask.useMutation({
    onSuccess: () => utils.events.list.invalidate(),
    onError: (e) => toast.error(e.message),
  });

  // Restrict events / blocks to ones whose range overlaps this day.
  const dayEvents = events.filter((e) => dateRangeToPx(e.startsAt, e.endsAt, day) !== null);
  const dayBlocks = timeBlocks.filter((b) => dateRangeToPx(b.startsAt, b.endsAt, day) !== null);

  const laned = assignLanes(dayEvents);

  function handleClickGrid(e: React.MouseEvent<HTMLDivElement>) {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const start = pxToDate(y, day);
    const end = new Date(start);
    end.setMinutes(end.getMinutes() + 60);
    onCreate({ startsAt: start, endsAt: end });
  }

  function handleDragOver(e: ReactDragEvent<HTMLDivElement>) {
    if (!e.dataTransfer.types.includes("application/x-task-id")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      setDragOverY(e.clientY - rect.top);
    }
  }

  function handleDragLeave() {
    setDragOverY(null);
  }

  async function handleDrop(e: ReactDragEvent<HTMLDivElement>) {
    e.preventDefault();
    const taskId = e.dataTransfer.getData("application/x-task-id");
    setDragOverY(null);
    if (!taskId || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const startsAt = pxToDate(y, day);
    const endsAt = new Date(startsAt);
    endsAt.setMinutes(endsAt.getMinutes() + 60);
    logTask.mutate({ taskId, startsAt, endsAt, lazy: false });
  }

  function handlePointerMove(e: React.MouseEvent<HTMLDivElement>) {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    setHoverTime(formatTime(pxToDate(e.clientY - rect.top, day)));
  }

  return (
    <div className={cn("flex gap-2", compact && "gap-0")}>
      {showHourLabels ? (
        <div className="relative shrink-0 w-12 text-xs text-muted-foreground" style={{ height: GRID_HEIGHT }}>
          {Array.from({ length: DAY_END_HOUR - DAY_START_HOUR + 1 }, (_, i) => {
            const h = DAY_START_HOUR + i;
            return (
              <div
                key={h}
                className="absolute right-2 -translate-y-1/2 select-none"
                style={{ top: i * PX_PER_HOUR }}
              >
                {h === DAY_START_HOUR ? "" : formatHour(h)}
              </div>
            );
          })}
        </div>
      ) : null}

      <div
        ref={containerRef}
        className="relative flex-1 min-w-0 rounded-md border bg-card cursor-pointer select-none"
        style={{ height: GRID_HEIGHT }}
        onClick={handleClickGrid}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onMouseMove={handlePointerMove}
        onMouseLeave={() => setHoverTime(null)}
      >
        {/* Hour gridlines */}
        {Array.from({ length: DAY_END_HOUR - DAY_START_HOUR }, (_, i) => (
          <div
            key={i}
            className="absolute left-0 right-0 border-t border-border/50 pointer-events-none"
            style={{ top: i * PX_PER_HOUR }}
          />
        ))}
        {/* Half-hour gridlines */}
        {Array.from({ length: DAY_END_HOUR - DAY_START_HOUR }, (_, i) => (
          <div
            key={`half-${i}`}
            className="absolute left-0 right-0 border-t border-dashed border-border/25 pointer-events-none"
            style={{ top: i * PX_PER_HOUR + PX_PER_HOUR / 2 }}
          />
        ))}

        {/* Background time blocks */}
        {dayBlocks.map((b) => {
          const pos = dateRangeToPx(b.startsAt, b.endsAt, day);
          if (!pos) return null;
          return (
            <div
              key={b.id}
              className={cn(
                "absolute left-0 right-0 pointer-events-none",
                blockBackground(b.kind),
              )}
              style={{ top: pos.topPx, height: pos.heightPx }}
            >
              {!compact && b.label ? (
                <div className="px-2 py-1 text-xs text-muted-foreground">{b.label}</div>
              ) : null}
            </div>
          );
        })}

        {/* Events */}
        {laned.map(({ item, lane, lanes }) => {
          const pos = dateRangeToPx(item.startsAt, item.endsAt, day);
          if (!pos) return null;
          const widthPct = 100 / lanes;
          const leftPct = lane * widthPct;
          const lazy = item.confidence < 1;
          const titleTask = item.attributions[0]?.task;
          const labelText =
            item.attributions.length === 0
              ? "Untitled event"
              : item.attributions.length === 1
              ? titleTask?.name ?? "Event"
              : `${item.attributions.length} parallel`;
          const color = titleTask?.area?.color ?? "#6366f1";

          return (
            <button
              key={item.id}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onEdit(item.id);
              }}
              className={cn(
                "absolute rounded-md text-left text-xs overflow-hidden border-2",
                "transition-shadow hover:shadow-md",
                lazy
                  ? "border-dashed bg-[image:repeating-linear-gradient(45deg,_var(--card)_0,_var(--card)_4px,_color-mix(in_srgb,var(--card),var(--foreground)_8%)_4px,_color-mix(in_srgb,var(--card),var(--foreground)_8%)_8px)]"
                  : "border-solid",
              )}
              style={{
                top: pos.topPx + 1,
                height: Math.max(pos.heightPx - 2, 20),
                left: `calc(${leftPct}% + 2px)`,
                width: `calc(${widthPct}% - 4px)`,
                borderColor: color,
                backgroundColor: lazy ? undefined : `color-mix(in srgb, ${color} 15%, var(--card))`,
              }}
              title={labelText}
            >
              <div className="px-1.5 py-0.5 font-medium truncate">{labelText}</div>
              {pos.heightPx > 28 && !compact ? (
                <div className="px-1.5 text-[10px] text-muted-foreground">
                  {formatTime(item.startsAt)} – {formatTime(item.endsAt)}
                  {item.attributions.length > 1 ? " · parallel" : ""}
                  {lazy ? " · low confidence" : ""}
                </div>
              ) : null}
            </button>
          );
        })}

        {/* Now line */}
        {isSameDay(day, new Date()) ? <NowLine /> : null}

        {/* Drop preview */}
        {dragOverY != null ? (
          <div
            className="absolute left-0 right-0 pointer-events-none border-t-2 border-dashed border-foreground/60"
            style={{ top: snapY(dragOverY) }}
          >
            <span className="absolute left-1 -top-3 text-[10px] text-foreground bg-background px-1 rounded">
              {formatTime(pxToDate(snapY(dragOverY), day))}
            </span>
          </div>
        ) : null}

        {/* Hover time indicator */}
        {hoverTime != null && dragOverY == null ? (
          <div className="absolute top-1 right-2 text-[10px] text-muted-foreground bg-background/80 px-1 rounded pointer-events-none">
            click to log @ {hoverTime}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function snapY(y: number): number {
  const minutes = Math.round((y / PX_PER_MINUTE) / 15) * 15;
  return minutes * PX_PER_MINUTE;
}

function blockBackground(kind: string): string {
  switch (kind) {
    case "SLEEP":
      return "bg-indigo-500/10 dark:bg-indigo-500/20";
    case "WORK_HOURS":
      return "bg-amber-500/10 dark:bg-amber-500/20";
    case "FOCUS":
      return "bg-emerald-500/10 dark:bg-emerald-500/20";
    case "REST":
      return "bg-sky-500/10 dark:bg-sky-500/20";
    case "COMMUTE":
      return "bg-rose-500/10 dark:bg-rose-500/20";
    case "MEAL":
      return "bg-orange-500/10 dark:bg-orange-500/20";
    default:
      return "bg-muted/60";
  }
}

function NowLine() {
  const [topPx, setTopPx] = useState<number | null>(null);
  useEffect(() => {
    function update() {
      const now = new Date();
      const start = startOfLocalDay(now);
      start.setHours(DAY_START_HOUR, 0, 0, 0);
      const minutes = (now.getTime() - start.getTime()) / 60_000;
      if (minutes < 0 || minutes > (DAY_END_HOUR - DAY_START_HOUR) * 60) {
        setTopPx(null);
      } else {
        setTopPx(minutes * PX_PER_MINUTE);
      }
    }
    update();
    const interval = setInterval(update, 60_000);
    return () => clearInterval(interval);
  }, []);
  if (topPx == null) return null;
  return (
    <div className="absolute left-0 right-0 pointer-events-none z-10" style={{ top: topPx }}>
      <div className="h-px bg-destructive" />
      <div className="absolute -left-1.5 -top-1 size-3 rounded-full bg-destructive" />
    </div>
  );
}
