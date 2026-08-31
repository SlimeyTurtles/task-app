/**
 * Side-effecting recurrence materializer — called by the BullMQ worker
 * nightly, by the manual `recurrence.materializeNow` tRPC procedure, and
 * inline by mutations that create/update a series (so occurrences appear on
 * the calendar immediately).
 *
 * For each RecurrenceRule whose nextMaterializeAt has passed (paused rules
 * have nextMaterializeAt = null and are skipped), expand the RRULE forward
 * HORIZON_DAYS (capped at MAX_OCCURRENCES_PER_SERIES) and create per
 * occurrence:
 *  - an Event cloned from the rule's templateEvent (seriesId +
 *    originalStartsAt set; originalStartsAt is the immutable dedup key, so
 *    detached/dragged occurrences keep their slot and are never recreated);
 *  - when materializeTasks, a Task cloned from the template task (dueDate =
 *    occurrence), attributed to the occurrence event.
 *
 * Task-only rules (no templateEvent — legacy or created from the tasks UI)
 * materialize just the task clones, deduped by the slot's dueDate instant.
 */

import { Prisma, TaskStatus, type PrismaClient } from "@prisma/client";

import { materializeOccurrences } from "@/lib/recurrence";

export const HORIZON_DAYS = 365;
export const MAX_OCCURRENCES_PER_SERIES = 100;

export type MaterializeResult = { rules: number; events: number; tasks: number };

export async function materializeForUser(
  db: PrismaClient,
  userId: string,
  now: Date = new Date(),
): Promise<MaterializeResult> {
  return materializeWhere(
    db,
    { nextMaterializeAt: { lte: now }, OR: [{ task: { userId } }, { templateEvent: { userId } }] },
    now,
  );
}

export async function materializeAll(
  db: PrismaClient,
  now: Date = new Date(),
): Promise<MaterializeResult> {
  return materializeWhere(db, { nextMaterializeAt: { lte: now } }, now);
}

async function materializeWhere(
  db: PrismaClient,
  where: Prisma.RecurrenceRuleWhereInput,
  now: Date,
): Promise<MaterializeResult> {
  const rules = await db.recurrenceRule.findMany({ where, select: { id: true } });
  const totals: MaterializeResult = { rules: rules.length, events: 0, tasks: 0 };
  for (const rule of rules) {
    const r = await materializeSeries(db, rule.id, now);
    totals.events += r.events;
    totals.tasks += r.tasks;
  }
  return totals;
}

/** Materialize one series now. Idempotent; safe to call inline from mutations. */
export async function materializeSeries(
  db: PrismaClient,
  ruleId: string,
  now: Date = new Date(),
): Promise<{ events: number; tasks: number }> {
  const rule = await db.recurrenceRule.findUnique({
    where: { id: ruleId },
    include: {
      task: { include: { tags: { select: { tagId: true } } } },
      templateEvent: { include: { tags: { select: { tagId: true } } } },
    },
  });
  if (!rule) return { events: 0, tasks: 0 };

  const horizonEnd = new Date(now.getTime() + HORIZON_DAYS * 86_400_000);
  const from = new Date(Math.max(now.getTime(), rule.dtstart.getTime()));
  const exdates = Array.isArray(rule.exdates)
    ? (rule.exdates as unknown[]).filter((x): x is string => typeof x === "string")
    : [];

  const occurrences = materializeOccurrences(
    rule.rrule,
    rule.dtstart,
    from,
    horizonEnd,
    rule.timezone,
    exdates,
    MAX_OCCURRENCES_PER_SERIES,
  );

  let events = 0;
  let tasks = 0;

  if (occurrences.length > 0) {
    if (rule.templateEvent) {
      const r = await materializeEvents(db, rule, rule.templateEvent, occurrences);
      events = r.events;
      tasks = r.tasks;
    } else if (rule.task) {
      tasks = await materializeTaskOnly(db, rule, rule.task, occurrences);
    }
  }

  // Nightly top-up keeps the rolling horizon full; dedup makes re-runs
  // idempotent. Finite, fully-materialized rules park past their last
  // occurrence so the nightly job stops touching them.
  const lastOccurrence = occurrences[occurrences.length - 1];
  const finiteAndDone =
    /COUNT=|UNTIL=/i.test(rule.rrule) && occurrences.length < MAX_OCCURRENCES_PER_SERIES;
  await db.recurrenceRule.update({
    where: { id: rule.id },
    data: {
      nextMaterializeAt: finiteAndDone
        ? new Date((lastOccurrence ?? now).getTime() + 86_400_000)
        : new Date(now.getTime() + 86_400_000),
    },
  });

  return { events, tasks };
}

type RuleWithIncludes = Prisma.RecurrenceRuleGetPayload<{
  include: {
    task: { include: { tags: { select: { tagId: true } } } };
    templateEvent: { include: { tags: { select: { tagId: true } } } };
  };
}>;

async function materializeEvents(
  db: PrismaClient,
  rule: RuleWithIncludes,
  template: NonNullable<RuleWithIncludes["templateEvent"]>,
  occurrences: Date[],
): Promise<{ events: number; tasks: number }> {
  const existing = await db.event.findMany({
    where: { seriesId: rule.id, originalStartsAt: { in: occurrences } },
    select: { originalStartsAt: true },
  });
  const occupied = new Set(
    existing.map((e) => e.originalStartsAt?.getTime()).filter((t): t is number => t != null),
  );
  const durationMs = template.endsAt.getTime() - template.startsAt.getTime();
  const templateTagIds = template.tags.map((t) => t.tagId);

  let events = 0;
  let tasks = 0;
  for (const occ of occurrences) {
    if (occupied.has(occ.getTime())) continue;
    try {
      const event = await db.event.create({
        data: {
          userId: template.userId,
          title: template.title,
          notes: template.notes,
          kind: template.kind,
          source: template.source,
          confidence: 1,
          startsAt: occ,
          endsAt: new Date(occ.getTime() + durationMs),
          seriesId: rule.id,
          originalStartsAt: occ,
          ...(templateTagIds.length
            ? { tags: { create: templateTagIds.map((tagId) => ({ tagId })) } }
            : {}),
        },
      });
      events++;
      if (rule.materializeTasks && rule.task) {
        const task = await cloneTask(db, rule.task, occ);
        await db.eventTaskAttribution.create({
          data: { eventId: event.id, taskId: task.id, weight: 1 },
        });
        tasks++;
      }
    } catch (err) {
      // P2002 = another materialization (inline + nightly) won the slot race.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") continue;
      throw err;
    }
  }
  return { events, tasks };
}

/** Legacy/task-only rules: clone tasks per occurrence, dedup by dueDate instant. */
async function materializeTaskOnly(
  db: PrismaClient,
  rule: RuleWithIncludes,
  template: NonNullable<RuleWithIncludes["task"]>,
  occurrences: Date[],
): Promise<number> {
  const existing = await db.task.findMany({
    where: {
      templateTaskId: template.id,
      dueDate: { gte: occurrences[0], lte: occurrences[occurrences.length - 1] },
    },
    select: { dueDate: true },
  });
  const occupied = new Set(
    existing.map((t) => t.dueDate?.getTime()).filter((t): t is number => t != null),
  );

  let created = 0;
  for (const occ of occurrences) {
    // The template task itself covers the first occurrence for legacy rules.
    if (occ.getTime() === rule.dtstart.getTime()) continue;
    if (occupied.has(occ.getTime())) continue;
    await cloneTask(db, template, occ);
    created++;
  }
  return created;
}

async function cloneTask(
  db: PrismaClient,
  template: NonNullable<RuleWithIncludes["task"]>,
  dueDate: Date,
) {
  const tagIds = template.tags.map((t) => t.tagId);
  return db.task.create({
    data: {
      userId: template.userId,
      templateTaskId: template.id,
      name: template.name,
      description: template.description,
      definitionOfDone: template.definitionOfDone,
      areaId: template.areaId,
      projectId: template.projectId,
      stress: template.stress,
      valence: template.valence,
      exhaustion: template.exhaustion,
      estimatedMinutes: template.estimatedMinutes,
      importance: template.importance,
      urgency: template.urgency,
      dueDate,
      status: TaskStatus.INBOX,
      ...(tagIds.length ? { tags: { create: tagIds.map((tagId) => ({ tagId })) } } : {}),
    },
  });
}
