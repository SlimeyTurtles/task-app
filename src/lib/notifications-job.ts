/**
 * Due-soon notification dispatcher — called by the BullMQ worker every
 * ~5 minutes and by the manual `notifications.dispatchNow` tRPC procedure.
 *
 * For each user, finds tasks whose dueDate is within `prefs.leadMinutes`
 * and writes a Notification per match. The compound unique key
 * (userId, type, taskId, dueAt) plus skipDuplicates makes the writer
 * idempotent — re-running yields zero new rows.
 *
 * Quiet hours: when "now" is inside the user's quiet window (interpreted
 * in their tz), the dispatcher defers — the next 5-minute tick picks the
 * notification up once quiet hours end.
 */

import { NotificationType, TaskStatus, type PrismaClient } from "@prisma/client";

export type EffectivePrefs = {
  leadMinutes: number;
  quietStartHour: number;
  quietEndHour: number;
  timezone: string;
  enabled: boolean;
};

export const DEFAULT_PREFS: EffectivePrefs = {
  leadMinutes: 1440,
  quietStartHour: 22,
  quietEndHour: 7,
  timezone: "UTC",
  enabled: true,
};

export async function dispatchAll(
  db: PrismaClient,
  now: Date = new Date(),
): Promise<{ users: number; created: number }> {
  const userIds = await db.user.findMany({ select: { id: true } });
  let total = 0;
  for (const { id } of userIds) {
    total += (await dispatchForUser(db, id, now)).created;
  }
  return { users: userIds.length, created: total };
}

export async function dispatchForUser(
  db: PrismaClient,
  userId: string,
  now: Date = new Date(),
): Promise<{ created: number }> {
  const prefs = await getEffectivePrefs(db, userId);
  if (!prefs.enabled) return { created: 0 };
  if (isInQuietHours(now, prefs)) return { created: 0 };

  const windowEnd = new Date(now.getTime() + prefs.leadMinutes * 60_000);
  const candidates = await db.task.findMany({
    where: {
      userId,
      status: { in: [TaskStatus.INBOX, TaskStatus.SCHEDULED, TaskStatus.IN_PROGRESS] },
      dueDate: { gt: now, lte: windowEnd },
    },
    select: { id: true, name: true, dueDate: true },
  });
  if (candidates.length === 0) return { created: 0 };

  const rows = candidates.map((t) => ({
    userId,
    type: NotificationType.DUE_SOON,
    taskId: t.id,
    dueAt: t.dueDate!,
    message: renderMessage(t.name, t.dueDate!, now),
  }));

  const { count } = await db.notification.createMany({ data: rows, skipDuplicates: true });
  return { created: count };
}

export async function getEffectivePrefs(db: PrismaClient, userId: string): Promise<EffectivePrefs> {
  const row = await db.notificationPreference.findUnique({ where: { userId } });
  if (!row) return { ...DEFAULT_PREFS };
  return {
    leadMinutes: row.leadMinutes,
    quietStartHour: row.quietStartHour,
    quietEndHour: row.quietEndHour,
    timezone: row.timezone,
    enabled: row.enabled,
  };
}

/**
 * The quiet window wraps midnight when quietStartHour > quietEndHour
 * (e.g. 22:00 → 07:00 spans the night).
 */
export function isInQuietHours(now: Date, prefs: Pick<EffectivePrefs, "quietStartHour" | "quietEndHour" | "timezone">): boolean {
  const hour = hourInTz(now, prefs.timezone);
  if (prefs.quietStartHour === prefs.quietEndHour) return false;
  if (prefs.quietStartHour < prefs.quietEndHour) {
    return hour >= prefs.quietStartHour && hour < prefs.quietEndHour;
  }
  return hour >= prefs.quietStartHour || hour < prefs.quietEndHour;
}

function hourInTz(d: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const h = parts.find((p) => p.type === "hour")?.value ?? "00";
  const n = parseInt(h, 10);
  return n === 24 ? 0 : n;
}

function renderMessage(name: string, dueAt: Date, now: Date): string {
  const mins = Math.max(0, Math.round((dueAt.getTime() - now.getTime()) / 60_000));
  if (mins < 60) return `${name} is due in ${mins} min`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${name} is due in ${hours}h`;
  const days = Math.round(hours / 24);
  return `${name} is due in ${days}d`;
}
