/**
 * Series edit engine: Google-Calendar-style scopes for editing/deleting one
 * occurrence of a recurring event series.
 *
 *  - "this":      edit/delete only the picked occurrence (detach it).
 *  - "following": split the series at the occurrence into a new rule.
 *  - "all":       propagate to the whole series (past rows stay untouched).
 *
 * Invariant maintained throughout: Event.originalStartsAt is the slot the
 * materializer expanded for a row. When a rule's dtstart shifts (series-wide
 * time change, or a split re-anchoring at a new time), every surviving row's
 * originalStartsAt shifts by the same delta — otherwise re-materialization
 * would see the old slots as free and duplicate them.
 */

import { EventKind, Prisma, TaskStatus, type PrismaClient } from "@prisma/client";
import { TRPCError } from "@trpc/server";

import { parseRrule, buildRrule, truncateRrule, remainderRrule, WEEKDAY_CODES } from "@/lib/recurrence";
import { materializeSeries } from "@/lib/recurrence-job";

export type EditScope = "this" | "following" | "all";

export type OccurrencePatch = {
  title?: string | null;
  notes?: string | null;
  startsAt?: Date;
  endsAt?: Date;
  kind?: EventKind;
};

type OccurrenceWithSeries = Prisma.EventGetPayload<{
  include: {
    series: { include: { task: true } };
    attributions: { include: { task: { select: { id: true; templateTaskId: true; status: true; _count: { select: { completions: true } } } } } };
  };
}>;

async function loadOccurrence(
  db: PrismaClient,
  userId: string,
  eventId: string,
): Promise<OccurrenceWithSeries> {
  const event = await db.event.findFirst({
    where: { id: eventId, userId },
    include: {
      series: { include: { task: true } },
      attributions: {
        include: {
          task: {
            select: { id: true, templateTaskId: true, status: true, _count: { select: { completions: true } } },
          },
        },
      },
    },
  });
  if (!event) throw new TRPCError({ code: "NOT_FOUND" });
  return event;
}

export async function applyOccurrenceEdit(
  db: PrismaClient,
  userId: string,
  eventId: string,
  scope: EditScope,
  patch: OccurrencePatch,
): Promise<{ newRuleId?: string }> {
  const event = await loadOccurrence(db, userId, eventId);
  const newStart = patch.startsAt ?? event.startsAt;
  const newEnd = patch.endsAt ?? event.endsAt;
  if (newEnd <= newStart) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "End must be after start." });
  }

  // Non-series rows (or already-detached ones) are plain edits.
  if (!event.series || event.detached || scope === "this") {
    await db.event.update({
      where: { id: event.id },
      data: { ...cleanPatch(patch), ...(event.seriesId ? { detached: true } : {}) },
    });
    return {};
  }

  const rule = event.series;
  const t0 = event.originalStartsAt ?? event.startsAt;

  if (scope === "following") {
    // Splitting at the first live occurrence is the same as editing all.
    if (t0.getTime() <= rule.dtstart.getTime()) {
      return applyToWholeSeries(db, event, patch);
    }
    if (t0 < new Date()) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Pick a future occurrence to split the series." });
    }
    return splitSeries(db, event, patch);
  }

  return applyToWholeSeries(db, event, patch);
}

// ---------------------------------------------------------------------------
// scope = "all"
// ---------------------------------------------------------------------------

async function applyToWholeSeries(
  db: PrismaClient,
  event: OccurrenceWithSeries,
  patch: OccurrencePatch,
): Promise<{ newRuleId?: string }> {
  const rule = event.series!;
  const now = new Date();
  const startDelta = patch.startsAt ? patch.startsAt.getTime() - event.startsAt.getTime() : 0;
  const newDuration =
    (patch.endsAt ?? event.endsAt).getTime() - (patch.startsAt ?? event.startsAt).getTime();
  const oldDuration = event.endsAt.getTime() - event.startsAt.getTime();
  const durationChanged = newDuration !== oldDuration;

  const fieldPatch = cleanPatch({ title: patch.title, notes: patch.notes, kind: patch.kind });

  await db.$transaction(async (tx) => {
    if (Object.keys(fieldPatch).length > 0) {
      await tx.event.updateMany({
        where: { seriesId: rule.id, detached: false },
        data: fieldPatch,
      });
      if (rule.materializeTasks && rule.taskId && patch.title !== undefined) {
        await tx.task.update({
          where: { id: rule.taskId },
          data: { ...(patch.title != null ? { name: patch.title } : {}) },
        });
      }
    }

    if (startDelta !== 0 || durationChanged) {
      const rows = await tx.event.findMany({
        where: { seriesId: rule.id },
        select: { id: true, startsAt: true, detached: true, originalStartsAt: true },
      });
      for (const row of rows) {
        const isEdited = row.id === event.id;
        // Slot identity always shifts with the rule; displayed times shift
        // only for non-detached future rows (past rows are history).
        const slotShift =
          startDelta !== 0 && row.originalStartsAt
            ? { originalStartsAt: new Date(row.originalStartsAt.getTime() + startDelta) }
            : {};
        if (isEdited) {
          await tx.event.update({
            where: { id: row.id },
            data: {
              ...slotShift,
              startsAt: patch.startsAt ?? row.startsAt,
              endsAt: new Date((patch.startsAt ?? row.startsAt).getTime() + newDuration),
            },
          });
        } else if (!row.detached && row.startsAt >= now) {
          const shifted = new Date(row.startsAt.getTime() + startDelta);
          await tx.event.update({
            where: { id: row.id },
            data: { ...slotShift, startsAt: shifted, endsAt: new Date(shifted.getTime() + newDuration) },
          });
        } else if (slotShift.originalStartsAt) {
          await tx.event.update({ where: { id: row.id }, data: slotShift });
        }
      }

      if (startDelta !== 0) {
        const newDtstart = new Date(rule.dtstart.getTime() + startDelta);
        await tx.recurrenceRule.update({
          where: { id: rule.id },
          data: {
            dtstart: newDtstart,
            rrule: rebuildForDtstart(rule.rrule, rule.dtstart, newDtstart, rule.timezone),
            exdates: shiftExdates(rule.exdates, startDelta),
          },
        });
      }
    }
  });

  return {};
}

// ---------------------------------------------------------------------------
// scope = "following" (split)
// ---------------------------------------------------------------------------

async function splitSeries(
  db: PrismaClient,
  event: OccurrenceWithSeries,
  patch: OccurrencePatch,
): Promise<{ newRuleId?: string }> {
  const rule = event.series!;
  const t0 = event.originalStartsAt ?? event.startsAt;
  const newStart = patch.startsAt ?? event.startsAt;
  const startDelta = newStart.getTime() - t0.getTime();

  const truncated = truncateRrule(rule.rrule, rule.dtstart, t0);
  const remainder = remainderRrule(rule.rrule, rule.dtstart, t0);
  if (!truncated || !remainder) {
    // Degenerate split (shouldn't happen given the first-occurrence guard).
    return applyToWholeSeries(db, event, patch);
  }

  const { past: pastExdates, future: futureExdates } = partitionExdates(rule.exdates, t0);

  const newRuleId = await db.$transaction(async (tx) => {
    // 1. Truncate the original series before t0.
    await tx.recurrenceRule.update({
      where: { id: rule.id },
      data: { rrule: truncated, exdates: pastExdates },
    });

    // 2. New template task for the new series when the old one cloned tasks.
    let newTaskId: string | null = null;
    if (rule.materializeTasks && rule.task) {
      const t = rule.task;
      const clone = await tx.task.create({
        data: {
          userId: t.userId,
          name: patch.title ?? t.name,
          description: t.description,
          definitionOfDone: t.definitionOfDone,
          areaId: t.areaId,
          projectId: t.projectId,
          stress: t.stress,
          valence: t.valence,
          exhaustion: t.exhaustion,
          estimatedMinutes: t.estimatedMinutes,
          importance: t.importance,
          urgency: t.urgency,
          dueDate: newStart,
          status: t.status,
        },
      });
      newTaskId = clone.id;
    }

    // 3. The new rule, anchored at the edited occurrence.
    const newRule = await tx.recurrenceRule.create({
      data: {
        rrule: rebuildForDtstart(remainder, t0, newStart, rule.timezone),
        timezone: rule.timezone,
        dtstart: newStart,
        exdates: futureExdates.map((iso) =>
          new Date(new Date(iso).getTime() + startDelta).toISOString(),
        ),
        materializeTasks: rule.materializeTasks,
        taskId: newTaskId,
        templateEventId: event.id,
        nextMaterializeAt: new Date(),
      },
    });

    // 4. The edited occurrence becomes the new series' anchor.
    await tx.event.update({
      where: { id: event.id },
      data: {
        ...cleanPatch(patch),
        seriesId: newRule.id,
        originalStartsAt: newStart,
        detached: false,
      },
    });

    // 5. Re-home the rest of the old series' future rows.
    const futureRows = await tx.event.findMany({
      where: { seriesId: rule.id, originalStartsAt: { gt: t0 } },
      include: {
        attributions: {
          include: {
            task: {
              select: { id: true, templateTaskId: true, status: true, _count: { select: { completions: true } } },
            },
          },
        },
      },
    });
    for (const row of futureRows) {
      if (row.detached) {
        await tx.event.update({
          where: { id: row.id },
          data: {
            seriesId: newRule.id,
            originalStartsAt: row.originalStartsAt
              ? new Date(row.originalStartsAt.getTime() + startDelta)
              : null,
          },
        });
      } else if (hasProtectedWork(row)) {
        await tx.event.update({
          where: { id: row.id },
          data: { seriesId: null, detached: true },
        });
      } else {
        await deleteOccurrenceRow(tx, row);
      }
    }

    return newRule.id;
  });

  await materializeSeries(db, newRuleId);
  return { newRuleId };
}

// ---------------------------------------------------------------------------
// Deletion
// ---------------------------------------------------------------------------

export async function deleteOccurrenceWithScope(
  db: PrismaClient,
  userId: string,
  eventId: string,
  scope: EditScope,
): Promise<void> {
  const event = await loadOccurrence(db, userId, eventId);

  if (!event.series || scope === "this") {
    await db.$transaction(async (tx) => {
      if (event.series && event.originalStartsAt) {
        // Exdate the slot (even for detached rows) so re-materialization
        // doesn't resurrect it.
        const exdates = exdateList(event.series.exdates);
        exdates.push(event.originalStartsAt.toISOString());
        await tx.recurrenceRule.update({
          where: { id: event.series.id },
          data: { exdates },
        });
      }
      await deleteOccurrenceRow(tx, event);
    });
    return;
  }

  const rule = event.series;
  const t0 = event.originalStartsAt ?? event.startsAt;

  if (scope === "following") {
    if (t0 < new Date() && t0.getTime() > rule.dtstart.getTime()) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Pick a future occurrence to end the series." });
    }
    const truncated =
      t0.getTime() <= rule.dtstart.getTime() ? null : truncateRrule(rule.rrule, rule.dtstart, t0);
    await db.$transaction(async (tx) => {
      const rows = await tx.event.findMany({
        where: { seriesId: rule.id, originalStartsAt: { gte: t0 } },
        include: {
          attributions: {
            include: {
              task: {
                select: { id: true, templateTaskId: true, status: true, _count: { select: { completions: true } } },
              },
            },
          },
        },
      });
      for (const row of rows) {
        if (row.id !== event.id && hasProtectedWork(row)) {
          await tx.event.update({ where: { id: row.id }, data: { seriesId: null, detached: true } });
        } else {
          await deleteOccurrenceRow(tx, row);
        }
      }
      if (truncated) {
        await tx.recurrenceRule.update({ where: { id: rule.id }, data: { rrule: truncated } });
      } else {
        await tx.recurrenceRule.delete({ where: { id: rule.id } });
      }
    });
    return;
  }

  // scope === "all"
  await db.$transaction(async (tx) => {
    const rows = await tx.event.findMany({
      where: { seriesId: rule.id },
      include: {
        attributions: {
          include: {
            task: {
              select: { id: true, templateTaskId: true, status: true, _count: { select: { completions: true } } },
            },
          },
        },
      },
    });
    for (const row of rows) {
      if (hasProtectedWork(row)) {
        await tx.event.update({ where: { id: row.id }, data: { seriesId: null, detached: true } });
      } else {
        await deleteOccurrenceRow(tx, row);
      }
    }
    await tx.recurrenceRule.delete({ where: { id: rule.id } });
  });
}

/**
 * Bulk-remove a series' occurrence events (+ their untouched task clones),
 * orphaning rows with completed/attributed work. Used by recurrence.delete
 * and by cadence changes that invalidate already-materialized future rows.
 */
export async function teardownSeriesOccurrences(
  db: PrismaClient | Prisma.TransactionClient,
  ruleId: string,
  opts: { from?: Date; keepDetached?: boolean; exceptEventId?: string } = {},
): Promise<void> {
  const rows = await db.event.findMany({
    where: {
      seriesId: ruleId,
      ...(opts.from ? { startsAt: { gte: opts.from } } : {}),
      ...(opts.keepDetached ? { detached: false } : {}),
      ...(opts.exceptEventId ? { id: { not: opts.exceptEventId } } : {}),
    },
    include: {
      attributions: {
        include: {
          task: {
            select: { id: true, templateTaskId: true, status: true, _count: { select: { completions: true } } },
          },
        },
      },
    },
  });
  for (const row of rows) {
    if (hasProtectedWork(row)) {
      await db.event.update({ where: { id: row.id }, data: { seriesId: null, detached: true } });
    } else {
      await deleteOccurrenceRow(db, row);
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Tx = PrismaClient | Prisma.TransactionClient;

type RowWithAttributions = {
  id: string;
  attributions: {
    task: { id: string; templateTaskId: string | null; status: TaskStatus; _count: { completions: number } };
  }[];
};

/** Completed or otherwise touched work must never be bulk-deleted. */
function hasProtectedWork(row: RowWithAttributions): boolean {
  return row.attributions.some(
    (a) =>
      a.task._count.completions > 0 ||
      (a.task.status !== TaskStatus.INBOX && a.task.status !== TaskStatus.SCHEDULED),
  );
}

/** Delete an occurrence event plus its untouched materialized task clones. */
async function deleteOccurrenceRow(tx: Tx, row: RowWithAttributions): Promise<void> {
  const removableTaskIds = row.attributions
    .filter(
      (a) =>
        a.task.templateTaskId != null &&
        a.task._count.completions === 0 &&
        (a.task.status === TaskStatus.INBOX || a.task.status === TaskStatus.SCHEDULED),
    )
    .map((a) => a.task.id);
  await tx.event.delete({ where: { id: row.id } });
  if (removableTaskIds.length) {
    await tx.task.deleteMany({ where: { id: { in: removableTaskIds } } });
  }
}

function cleanPatch(patch: OccurrencePatch): Prisma.EventUncheckedUpdateInput {
  const data: Prisma.EventUncheckedUpdateInput = {};
  if (patch.title !== undefined) data.title = patch.title;
  if (patch.notes !== undefined) data.notes = patch.notes;
  if (patch.kind !== undefined) data.kind = patch.kind;
  if (patch.startsAt !== undefined) data.startsAt = patch.startsAt;
  if (patch.endsAt !== undefined) data.endsAt = patch.endsAt;
  return data;
}

function exdateList(exdates: Prisma.JsonValue): string[] {
  return Array.isArray(exdates) ? exdates.filter((x): x is string => typeof x === "string") : [];
}

function partitionExdates(exdates: Prisma.JsonValue, t0: Date): { past: string[]; future: string[] } {
  const past: string[] = [];
  const future: string[] = [];
  for (const iso of exdateList(exdates)) {
    // Legacy calendar-day entries stay with the original rule.
    if (iso.length === 10) past.push(iso);
    else (new Date(iso) >= t0 ? future : past).push(iso);
  }
  return { past, future };
}

function shiftExdates(exdates: Prisma.JsonValue, deltaMs: number): string[] {
  return exdateList(exdates).map((iso) =>
    iso.length === 10 ? iso : new Date(new Date(iso).getTime() + deltaMs).toISOString(),
  );
}

/**
 * When a rule's anchor moves, dtstart-derived parts (monthly BYMONTHDAY /
 * nth-weekday, single-weekday weekly BYDAY) must track the new anchor.
 * Raw/power-editor rules that don't parse into a pattern are left alone.
 */
function rebuildForDtstart(rrule: string, oldDtstart: Date, newDtstart: Date, timezone: string): string {
  const pattern = parseRrule(rrule, timezone);
  if (!pattern) return rrule;
  if (pattern.freq === "WEEKLY" && pattern.byday?.length === 1) {
    const oldDay = WEEKDAY_CODES[(oldDtstart.getUTCDay() + 6) % 7];
    const newDay = WEEKDAY_CODES[(newDtstart.getUTCDay() + 6) % 7];
    if (pattern.byday[0] === oldDay && oldDay !== newDay) pattern.byday = [newDay];
  }
  return buildRrule(pattern, newDtstart, timezone);
}
