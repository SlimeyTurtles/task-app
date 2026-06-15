import { TRPCError } from "@trpc/server";
import { TaskStatus } from "@prisma/client";
import { z } from "zod";

import { protectedProcedure, router } from "../init";
import { materializeForUser } from "@/lib/recurrence-job";
import { materializeOccurrences } from "@/lib/recurrence";

const RruleInput = z.object({
  taskId: z.string(),
  rrule: z.string().min(1).max(500),
  timezone: z.string().default("UTC"),
  exdates: z.array(z.string()).optional(),
});

const DeleteScope = z.enum(["rule_only", "future", "all"]);

export const recurrenceRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db.recurrenceRule.findMany({
      where: { task: { userId: ctx.session.user.id } },
      include: {
        task: {
          select: {
            id: true,
            name: true,
            dueDate: true,
            area: { select: { id: true, name: true, color: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });
  }),

  upsert: protectedProcedure.input(RruleInput).mutation(async ({ ctx, input }) => {
    const task = await ctx.db.task.findFirst({
      where: { id: input.taskId, userId: ctx.session.user.id },
      select: { id: true },
    });
    if (!task) throw new TRPCError({ code: "NOT_FOUND" });

    return ctx.db.recurrenceRule.upsert({
      where: { taskId: input.taskId },
      create: {
        taskId: input.taskId,
        rrule: input.rrule,
        timezone: input.timezone,
        exdates: input.exdates ?? [],
        nextMaterializeAt: new Date(),
      },
      update: {
        rrule: input.rrule,
        timezone: input.timezone,
        exdates: input.exdates ?? [],
        nextMaterializeAt: new Date(),
      },
    });
  }),

  /** Pause = nextMaterializeAt cleared. Resume sets it to now. */
  pause: protectedProcedure
    .input(z.object({ taskId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const owned = await assertOwned(ctx, input.taskId);
      return ctx.db.recurrenceRule.update({
        where: { taskId: owned.id },
        data: { nextMaterializeAt: null },
      });
    }),
  resume: protectedProcedure
    .input(z.object({ taskId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const owned = await assertOwned(ctx, input.taskId);
      return ctx.db.recurrenceRule.update({
        where: { taskId: owned.id },
        data: { nextMaterializeAt: new Date() },
      });
    }),

  /**
   * Delete the rule, optionally cleaning up materialized children.
   *  - rule_only: keep all materialized children as-is (becomes plain tasks).
   *  - future:    delete untouched INBOX/SCHEDULED children with dueDate >= now.
   *  - all:       delete every untouched (no completions/attributions) child.
   */
  delete: protectedProcedure
    .input(z.object({ taskId: z.string(), scope: DeleteScope.default("future") }))
    .mutation(async ({ ctx, input }) => {
      const owned = await assertOwned(ctx, input.taskId);

      if (input.scope !== "rule_only") {
        const now = new Date();
        const where: import("@prisma/client").Prisma.TaskWhereInput = {
          templateTaskId: owned.id,
          status: { in: [TaskStatus.INBOX, TaskStatus.SCHEDULED] },
          completions: { none: {} },
          attributions: { none: {} },
        };
        if (input.scope === "future") where.dueDate = { gte: now };
        await ctx.db.task.deleteMany({ where });
      }

      await ctx.db.recurrenceRule.delete({ where: { taskId: owned.id } });
      return { ok: true };
    }),

  /** Preview the next N occurrences from now. */
  preview: protectedProcedure
    .input(z.object({ taskId: z.string(), count: z.number().int().min(1).max(60).default(14) }))
    .query(async ({ ctx, input }) => {
      const rule = await ctx.db.recurrenceRule.findFirst({
        where: { taskId: input.taskId, task: { userId: ctx.session.user.id } },
        include: { task: { select: { dueDate: true, createdAt: true } } },
      });
      if (!rule) throw new TRPCError({ code: "NOT_FOUND" });
      const now = new Date();
      const farFuture = new Date(now.getTime() + 365 * 86_400_000);
      const dtstart = rule.task.dueDate ?? rule.task.createdAt;
      const exdates = Array.isArray(rule.exdates)
        ? (rule.exdates as unknown[]).filter((x): x is string => typeof x === "string")
        : [];
      const all = materializeOccurrences(rule.rrule, dtstart, now, farFuture, rule.timezone, exdates);
      return all.slice(0, input.count);
    }),

  /** Manual trigger — same path the worker runs nightly. */
  materializeNow: protectedProcedure.mutation(async ({ ctx }) => {
    return materializeForUser(ctx.db, ctx.session.user.id);
  }),
});

type Ctx = { db: import("@prisma/client").PrismaClient; session: { user: { id: string } } };

async function assertOwned(ctx: Ctx, taskId: string) {
  const task = await ctx.db.task.findFirst({
    where: { id: taskId, userId: ctx.session.user.id },
    select: { id: true },
  });
  if (!task) throw new TRPCError({ code: "NOT_FOUND" });
  return task;
}
