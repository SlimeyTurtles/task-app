import { TRPCError } from "@trpc/server";
import { TaskStatus, type Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";

import { protectedProcedure, router } from "../init";
import { materializeForUser, materializeSeries } from "@/lib/recurrence-job";
import { buildRrule, materializeOccurrences, RecurrencePatternSchema } from "@/lib/recurrence";
import { teardownSeriesOccurrences } from "@/lib/series-edit";

/** Handle for locating a rule: any one of the three ids. */
const RuleRef = z.object({
  ruleId: z.string().optional(),
  taskId: z.string().optional(),
  templateEventId: z.string().optional(),
});

const UpsertInput = RuleRef.extend({
  pattern: RecurrencePatternSchema.optional(),
  /** Raw escape hatch for the /recurring power editor. */
  rrule: z.string().min(1).max(500).optional(),
  timezone: z.string().max(64).optional(),
  exdates: z.array(z.string()).optional(),
  materializeTasks: z.boolean().optional(),
}).refine((i) => (i.pattern != null) !== (i.rrule != null), {
  message: "Provide either pattern or rrule.",
});

const DeleteScope = z.enum(["rule_only", "future", "all"]);

export const recurrenceRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db.recurrenceRule.findMany({
      where: {
        OR: [
          { task: { userId: ctx.session.user.id } },
          { templateEvent: { userId: ctx.session.user.id } },
        ],
      },
      include: {
        task: {
          select: {
            id: true,
            name: true,
            dueDate: true,
            area: { select: { id: true, name: true, color: true } },
          },
        },
        templateEvent: { select: { id: true, title: true, startsAt: true, kind: true } },
      },
      orderBy: { createdAt: "desc" },
    });
  }),

  upsert: protectedProcedure.input(UpsertInput).mutation(async ({ ctx, input }) => {
    const existing = await findRule(ctx, input);

    if (existing) {
      const rrule =
        input.rrule ?? buildRrule(input.pattern!, existing.dtstart, input.timezone ?? existing.timezone);
      const cadenceChanged = rrule !== existing.rrule;
      const updated = await ctx.db.recurrenceRule.update({
        where: { id: existing.id },
        data: {
          rrule,
          ...(input.timezone ? { timezone: input.timezone } : {}),
          ...(input.exdates ? { exdates: input.exdates } : {}),
          ...(input.materializeTasks !== undefined
            ? { materializeTasks: input.materializeTasks && existing.taskId != null }
            : {}),
          nextMaterializeAt: new Date(),
        },
      });
      if (cadenceChanged && existing.templateEventId) {
        // Future non-detached rows no longer match the cadence; rebuild them.
        await teardownSeriesOccurrences(ctx.db, existing.id, {
          from: new Date(),
          keepDetached: true,
          exceptEventId: existing.templateEventId,
        });
      }
      await materializeSeries(ctx.db, updated.id);
      return updated;
    }

    // Create: anchor on a template event or a task.
    if (input.templateEventId) {
      const event = await ctx.db.event.findFirst({
        where: { id: input.templateEventId, userId: ctx.session.user.id },
        include: { attributions: { select: { taskId: true } } },
      });
      if (!event) throw new TRPCError({ code: "NOT_FOUND" });
      const taskId = event.attributions[0]?.taskId ?? null;
      const materializeTasks = (input.materializeTasks ?? taskId != null) && taskId != null;
      const rrule = input.rrule ?? buildRrule(input.pattern!, event.startsAt, input.timezone ?? "UTC");
      // The task-unique constraint: only claim the task if it's rule-free.
      const taskClaim =
        materializeTasks && taskId
          ? (await ctx.db.recurrenceRule.findUnique({ where: { taskId } })) == null
          : false;
      const rule = await ctx.db.recurrenceRule.create({
        data: {
          templateEventId: event.id,
          taskId: taskClaim ? taskId : null,
          rrule,
          timezone: input.timezone ?? "UTC",
          dtstart: event.startsAt,
          exdates: input.exdates ?? [],
          materializeTasks: taskClaim,
          nextMaterializeAt: new Date(),
        },
      });
      await ctx.db.event.update({
        where: { id: event.id },
        data: { seriesId: rule.id, originalStartsAt: event.startsAt, detached: false },
      });
      await materializeSeries(ctx.db, rule.id);
      return rule;
    }

    if (input.taskId) {
      const task = await ctx.db.task.findFirst({
        where: { id: input.taskId, userId: ctx.session.user.id },
        select: { id: true, dueDate: true, createdAt: true },
      });
      if (!task) throw new TRPCError({ code: "NOT_FOUND" });
      const dtstart = task.dueDate ?? task.createdAt;
      const rule = await ctx.db.recurrenceRule.create({
        data: {
          taskId: task.id,
          rrule: input.rrule ?? buildRrule(input.pattern!, dtstart, input.timezone ?? "UTC"),
          timezone: input.timezone ?? "UTC",
          dtstart,
          exdates: input.exdates ?? [],
          materializeTasks: true,
          nextMaterializeAt: new Date(),
        },
      });
      await materializeSeries(ctx.db, rule.id);
      return rule;
    }

    throw new TRPCError({ code: "BAD_REQUEST", message: "No rule reference provided." });
  }),

  /** Pause = nextMaterializeAt cleared. Resume sets it to now. */
  pause: protectedProcedure.input(RuleRef).mutation(async ({ ctx, input }) => {
    const rule = await requireRule(ctx, input);
    return ctx.db.recurrenceRule.update({
      where: { id: rule.id },
      data: { nextMaterializeAt: null },
    });
  }),
  resume: protectedProcedure.input(RuleRef).mutation(async ({ ctx, input }) => {
    const rule = await requireRule(ctx, input);
    await ctx.db.recurrenceRule.update({
      where: { id: rule.id },
      data: { nextMaterializeAt: new Date() },
    });
    return materializeSeries(ctx.db, rule.id);
  }),

  /**
   * Delete the rule, optionally cleaning up materialized children.
   *  - rule_only: keep every materialized event/task (occurrences detach).
   *  - future:    remove untouched future occurrence events + task clones.
   *  - all:       remove every untouched occurrence event + task clone.
   */
  delete: protectedProcedure
    .input(RuleRef.extend({ scope: DeleteScope.default("future") }))
    .mutation(async ({ ctx, input }) => {
      const rule = await requireRule(ctx, input);

      if (input.scope !== "rule_only") {
        const from = input.scope === "future" ? new Date() : undefined;
        await teardownSeriesOccurrences(ctx.db, rule.id, { from });
        if (rule.taskId) {
          const where: Prisma.TaskWhereInput = {
            templateTaskId: rule.taskId,
            status: { in: [TaskStatus.INBOX, TaskStatus.SCHEDULED] },
            completions: { none: {} },
            attributions: { none: {} },
          };
          if (from) where.dueDate = { gte: from };
          await ctx.db.task.deleteMany({ where });
        }
      }

      // Event.seriesId FK is SetNull: surviving occurrences detach cleanly.
      await ctx.db.recurrenceRule.delete({ where: { id: rule.id } });
      return { ok: true };
    }),

  /** Preview the next N occurrences from now. */
  preview: protectedProcedure
    .input(RuleRef.extend({ count: z.number().int().min(1).max(60).default(14) }))
    .query(async ({ ctx, input }) => {
      const rule = await requireRule(ctx, input);
      const now = new Date();
      const farFuture = new Date(now.getTime() + 365 * 86_400_000);
      const exdates = Array.isArray(rule.exdates)
        ? (rule.exdates as unknown[]).filter((x): x is string => typeof x === "string")
        : [];
      const all = materializeOccurrences(
        rule.rrule,
        rule.dtstart,
        now,
        farFuture,
        rule.timezone,
        exdates,
        input.count,
      );
      return all.slice(0, input.count);
    }),

  /** Manual trigger — same path the worker runs nightly. */
  materializeNow: protectedProcedure.mutation(async ({ ctx }) => {
    return materializeForUser(ctx.db, ctx.session.user.id);
  }),
});

type Ctx = { db: PrismaClient; session: { user: { id: string } } };
type Ref = z.infer<typeof RuleRef>;

async function findRule(ctx: Ctx, ref: Ref) {
  if (!ref.ruleId && !ref.taskId && !ref.templateEventId) return null;
  return ctx.db.recurrenceRule.findFirst({
    where: {
      OR: [
        ...(ref.ruleId ? [{ id: ref.ruleId }] : []),
        ...(ref.taskId ? [{ taskId: ref.taskId }] : []),
        ...(ref.templateEventId ? [{ templateEventId: ref.templateEventId }] : []),
      ],
      AND: {
        OR: [
          { task: { userId: ctx.session.user.id } },
          { templateEvent: { userId: ctx.session.user.id } },
        ],
      },
    },
  });
}

async function requireRule(ctx: Ctx, ref: Ref) {
  const rule = await findRule(ctx, ref);
  if (!rule) throw new TRPCError({ code: "NOT_FOUND" });
  return rule;
}
