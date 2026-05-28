/** Scheduling / calendar layout helpers. All datetimes operate in the viewer's local timezone. */

export const DAY_START_HOUR = 0;
export const DAY_END_HOUR = 24;
export const HOURS_VISIBLE = DAY_END_HOUR - DAY_START_HOUR;
export const PX_PER_HOUR = 56;
export const PX_PER_MINUTE = PX_PER_HOUR / 60;
export const GRID_HEIGHT = HOURS_VISIBLE * PX_PER_HOUR;
export const SNAP_MINUTES = 15;

export function startOfLocalDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

export function endOfLocalDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(23, 59, 59, 999);
  return out;
}

export function addDays(d: Date, days: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + days);
  return out;
}

export function startOfWeek(d: Date, weekStartsOn: 0 | 1 = 1): Date {
  const out = startOfLocalDay(d);
  const day = (out.getDay() - weekStartsOn + 7) % 7;
  out.setDate(out.getDate() - day);
  return out;
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function formatHour(h: number): string {
  if (h === 0 || h === 24) return "12 AM";
  if (h === 12) return "12 PM";
  if (h < 12) return `${h} AM`;
  return `${h - 12} PM`;
}

export function formatTime(d: Date): string {
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export function formatDayLabel(d: Date): string {
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

export function formatWeekLabel(d: Date): string {
  const end = addDays(d, 6);
  if (d.getMonth() === end.getMonth()) {
    return `${d.toLocaleDateString(undefined, { month: "short" })} ${d.getDate()}–${end.getDate()}, ${end.getFullYear()}`;
  }
  return `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${end.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`;
}

/** Clamp a Date range to the visible window of the given day, returning [topPx, heightPx]. */
export function dateRangeToPx(start: Date, end: Date, day: Date): { topPx: number; heightPx: number } | null {
  const dayStart = startOfLocalDay(day);
  const dayEnd = endOfLocalDay(day);
  if (end <= dayStart || start >= dayEnd) return null;

  const visibleStart = new Date(dayStart);
  visibleStart.setHours(DAY_START_HOUR, 0, 0, 0);
  const visibleEnd = new Date(dayStart);
  visibleEnd.setHours(DAY_END_HOUR, 0, 0, 0);

  const s = new Date(Math.max(start.getTime(), visibleStart.getTime()));
  const e = new Date(Math.min(end.getTime(), visibleEnd.getTime()));
  if (e <= s) return null;

  const topMinutes = (s.getTime() - visibleStart.getTime()) / 60_000;
  const lenMinutes = (e.getTime() - s.getTime()) / 60_000;
  return { topPx: topMinutes * PX_PER_MINUTE, heightPx: lenMinutes * PX_PER_MINUTE };
}

/** Y px within the day column → local Date in that day. Snaps to SNAP_MINUTES. */
export function pxToDate(y: number, day: Date): Date {
  const minutes = Math.max(0, Math.min(HOURS_VISIBLE * 60, y / PX_PER_MINUTE));
  const snapped = Math.round(minutes / SNAP_MINUTES) * SNAP_MINUTES;
  const out = startOfLocalDay(day);
  out.setHours(DAY_START_HOUR, 0, 0, 0);
  out.setMinutes(out.getMinutes() + snapped);
  return out;
}

/** Lane assignment: for a set of items with start/end, returns each item's lane and the total lane count for its overlap cluster. */
export type LanedItem<T extends { startsAt: Date; endsAt: Date }> = {
  item: T;
  lane: number;
  lanes: number;
};

export function assignLanes<T extends { startsAt: Date; endsAt: Date }>(items: T[]): LanedItem<T>[] {
  const sorted = [...items].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  const result: LanedItem<T>[] = [];

  // Group by overlap clusters first.
  type Cluster = { items: T[]; end: Date };
  const clusters: Cluster[] = [];
  for (const it of sorted) {
    const last = clusters[clusters.length - 1];
    if (last && it.startsAt < last.end) {
      last.items.push(it);
      if (it.endsAt > last.end) last.end = it.endsAt;
    } else {
      clusters.push({ items: [it], end: it.endsAt });
    }
  }

  for (const cluster of clusters) {
    const lanes: Date[] = []; // each lane's current "free after" timestamp
    const clusterAssignments: { item: T; lane: number }[] = [];
    for (const it of cluster.items) {
      let assigned = lanes.findIndex((free) => free <= it.startsAt);
      if (assigned === -1) {
        assigned = lanes.length;
        lanes.push(it.endsAt);
      } else {
        lanes[assigned] = it.endsAt;
      }
      clusterAssignments.push({ item: it, lane: assigned });
    }
    for (const { item, lane } of clusterAssignments) {
      result.push({ item, lane, lanes: lanes.length });
    }
  }

  return result;
}
