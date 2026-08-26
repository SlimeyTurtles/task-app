/**
 * Side-effecting recurrence materializer — called by the BullMQ worker
 * nightly and by the manual `recurrence.materializeNow` tRPC procedure.
 *
 * For each RecurrenceRule whose nextMaterializeAt has passed (paused rules
 * have nextMaterializeAt = null and are skipped), expand the RRULE forward
 * HORIZON_DAYS and clone the template Task into an INBOX row per occurrence,
 * with templateTaskId set + dueDate = occurrence start. Idempotent: existing
 * children with the same (templateTaskId, dueDate calendar day) are skipped.
 */

import { TaskStatus, type PrismaClient } from "@prisma/client";

import { materializeOccurrences } from "@/lib/recurrence";

export const HORIZON_DAYS = 14;

export async function materializeForUser(
  db: PrismaClient,
  userId: string,
  now: Date = new Date(),
): Promise<{ rules: number; created: number }> {
  const rules = await db.recurrenceRule.findMany({
    where: {
      nextMaterializeAt: { lte: now },
      task: { userId },
    },
    include: {
      task: {
        include: { tags: { select: { tagId: true } } },
      },
    },
  });

  let created = 0;
  for (const rule of rules) {
    created += await materializeRule(db, rule, now);
  }
  return { rules: rules.length, created };
}

export async function materializeAll(
  db: PrismaClient,
  now: Date = new Date(),
): Promise<{ rules: number; created: number }> {
  const rules = await db.recurrenceRule.findMany({
    where: { nextMaterializeAt: { lte: now } },
    include: {
      task: {
        include: { tags: { select: { tagId: true } } },
      },
    },
  });

  let created = 0;
  for (const rule of rules) {
    created += await materializeRule(db, rule, now);
  }
  return { rules: rules.length, created };
}

type RuleWithTemplate = Awaited<ReturnType<typeof loadRule>>;

async function loadRule(db: PrismaClient, ruleId: string) {
  return db.recurrenceRule.findUniqueOrThrow({
    where: { id: ruleId },
    include: {
      task: {
        include: { tags: { select: { tagId: true } } },
      },
    },
  });
}

async function materializeRule(
  db: PrismaClient,
  rule: NonNullable<RuleWithTemplate>,
  now: Date,
): Promise<number> {
  const template = rule.task;
  if (!template) {
    // Event-only series (no template task) — task materialization does not
    // apply; the event materializer (commit 3 of the series upgrade) owns it.
    await db.recurrenceRule.update({
      where: { id: rule.id },
      data: { nextMaterializeAt: new Date(now.getTime() + HORIZON_DAYS * 86_400_000) },
    });
    return 0;
  }
  const horizonEnd = new Date(now.getTime() + HORIZON_DAYS * 86_400_000);
  const dtstart = rule.dtstart;
  const exdates = Array.isArray(rule.exdates) ? (rule.exdates as unknown[]).filter((x): x is string => typeof x === "string") : [];

  // Start expansion one day after dtstart — the template task already
  // accounts for the first occurrence (the event the user created), so we
  // don't want to materialize a sibling child for the same day.
  const expandFrom = new Date(Math.max(now.getTime(), dtstart.getTime() + 86_400_000));
  const occurrences = materializeOccurrences(
    rule.rrule,
    dtstart,
    expandFrom,
    horizonEnd,
    rule.timezone,
    exdates,
  );

  if (occurrences.length === 0) {
    await db.recurrenceRule.update({
      where: { id: rule.id },
      data: { nextMaterializeAt: horizonEnd },
    });
    return 0;
  }

  const existing = await db.task.findMany({
    where: {
      templateTaskId: rule.taskId,
      dueDate: { gte: occurrences[0], lte: occurrences[occurrences.length - 1] },
    },
    select: { dueDate: true },
  });
  const occupied = new Set(
    existing
      .map((t) => t.dueDate?.toISOString().slice(0, 10))
      .filter((s): s is string => Boolean(s)),
  );

  const tagIds = template.tags.map((t) => t.tagId);
  let created = 0;
  for (const occ of occurrences) {
    const dayKey = occ.toISOString().slice(0, 10);
    if (occupied.has(dayKey)) continue;
    await db.task.create({
      data: {
        userId: template.userId,
        templateTaskId: rule.taskId,
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
        dueDate: occ,
        status: TaskStatus.INBOX,
        ...(tagIds.length
          ? { tags: { create: tagIds.map((tagId) => ({ tagId })) } }
          : {}),
      },
    });
    created++;
  }

  await db.recurrenceRule.update({
    where: { id: rule.id },
    data: { nextMaterializeAt: new Date(occurrences[occurrences.length - 1].getTime() + 1) },
  });

  return created;
}
