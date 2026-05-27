import { TRPCError } from "@trpc/server";
import { DependencyKind, TaskStatus, type Prisma } from "@prisma/client";
import { z } from "zod";

import { protectedProcedure, router } from "../init";

const StressInt = z.number().int().min(0).max(10);
const ValenceInt = z.number().int().min(-5).max(5);

const TaskInput = z.object({
  name: z.string().trim().min(1).max(300),
  description: z.string().trim().max(10_000).nullish(),
  definitionOfDone: z.string().trim().max(5000).nullish(),
  status: z.nativeEnum(TaskStatus).optional(),
  areaId: z.string().nullish(),
  projectId: z.string().nullish(),
  parentTaskId: z.string().nullish(),
  stress: StressInt.nullish(),
  valence: ValenceInt.nullish(),
  exhaustion: StressInt.nullish(),
  estimatedMinutes: z.number().int().min(0).max(60 * 24 * 30).nullish(),
  dueDate: z.date().nullish(),
  urgency: StressInt.nullish(),
  importance: StressInt.nullish(),
  expiresAt: z.date().nullish(),
  tagIds: z.array(z.string()).optional(),
});

const Filters = z
  .object({
    status: z.array(z.nativeEnum(TaskStatus)).optional(),
    areaId: z.string().nullish(),
    projectId: z.string().nullish(),
    parentTaskId: z.string().nullish(),
    tagId: z.string().optional(),
    dueBefore: z.date().optional(),
    dueAfter: z.date().optional(),
    search: z.string().trim().min(1).max(200).optional(),
    missing: z.array(z.enum(["dueDate", "estimatedMinutes", "stress", "exhaustion"])).optional(),
    limit: z.number().int().min(1).max(500).default(200),
  })
  .optional();

export const tasksRouter = router({
  list: protectedProcedure.input(Filters).query(async ({ ctx, input }) => {
    const where: Prisma.TaskWhereInput = {
      userId: ctx.session.user.id,
      ...(input?.status?.length ? { status: { in: input.status } } : {}),
      ...(input?.areaId !== undefined ? { areaId: input.areaId } : {}),
      ...(input?.projectId !== undefined ? { projectId: input.projectId } : {}),
      ...(input?.parentTaskId !== undefined ? { parentTaskId: input.parentTaskId } : {}),
      ...(input?.tagId ? { tags: { some: { tagId: input.tagId } } } : {}),
      ...(input?.dueBefore || input?.dueAfter
        ? {
            dueDate: {
              ...(input.dueAfter ? { gte: input.dueAfter } : {}),
              ...(input.dueBefore ? { lte: input.dueBefore } : {}),
            },
          }
        : {}),
      ...(input?.search
        ? {
            OR: [
              { name: { contains: input.search, mode: "insensitive" } },
              { description: { contains: input.search, mode: "insensitive" } },
            ],
          }
        : {}),
      ...(input?.missing?.length
        ? Object.fromEntries(input.missing.map((field) => [field, null]))
        : {}),
    };

    return ctx.db.task.findMany({
      where,
      orderBy: [
        { status: "asc" },
        { dueDate: { sort: "asc", nulls: "last" } },
        { createdAt: "desc" },
      ],
      take: input?.limit ?? 200,
      include: {
        area: { select: { id: true, name: true, color: true } },
        project: { select: { id: true, name: true } },
        tags: { include: { tag: { select: { id: true, name: true, color: true } } } },
        _count: { select: { subtasks: true, outgoingDeps: true } },
      },
    });
  }),

  get: protectedProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    const task = await ctx.db.task.findFirst({
      where: { id: input.id, userId: ctx.session.user.id },
      include: {
        area: true,
        project: true,
        parent: { select: { id: true, name: true } },
        subtasks: {
          orderBy: { createdAt: "asc" },
          select: { id: true, name: true, status: true, dueDate: true },
        },
        tags: { include: { tag: true } },
        outgoingDeps: {
          include: { dependsOn: { select: { id: true, name: true, status: true } } },
        },
        incomingDeps: {
          include: { task: { select: { id: true, name: true, status: true } } },
        },
      },
    });
    if (!task) throw new TRPCError({ code: "NOT_FOUND" });
    return task;
  }),

  create: protectedProcedure.input(TaskInput).mutation(async ({ ctx, input }) => {
    await assertReferencedOwned(ctx, input);
    const { tagIds, ...data } = input;
    return ctx.db.task.create({
      data: {
        ...data,
        userId: ctx.session.user.id,
        ...(tagIds?.length
          ? { tags: { create: tagIds.map((tagId) => ({ tagId })) } }
          : {}),
      },
    });
  }),

  update: protectedProcedure
    .input(TaskInput.partial().extend({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { id, tagIds, ...data } = input;
      await assertTaskOwned(ctx, id);
      await assertReferencedOwned(ctx, data);

      // Treat status transitions to DONE/DROPPED as setting the corresponding timestamps.
      if (data.status === TaskStatus.DONE) (data as Prisma.TaskUpdateInput).completedAt = new Date();
      if (data.status === TaskStatus.DROPPED) (data as Prisma.TaskUpdateInput).droppedAt = new Date();

      return ctx.db.$transaction(async (tx) => {
        const updated = await tx.task.update({ where: { id }, data });
        if (tagIds) {
          await tx.taskTag.deleteMany({ where: { taskId: id } });
          if (tagIds.length) {
            await tx.taskTag.createMany({
              data: tagIds.map((tagId) => ({ taskId: id, tagId })),
              skipDuplicates: true,
            });
          }
        }
        return updated;
      });
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await assertTaskOwned(ctx, input.id);
      await ctx.db.task.delete({ where: { id: input.id } });
      return { ok: true };
    }),

  /** Quick-capture shortcut: create a task in the inbox with just a name. */
  quickCapture: protectedProcedure
    .input(z.object({ name: z.string().trim().min(1).max(300) }))
    .mutation(async ({ ctx, input }) => {
      return ctx.db.task.create({
        data: {
          userId: ctx.session.user.id,
          name: input.name,
          status: TaskStatus.INBOX,
        },
      });
    }),

  addDependency: protectedProcedure
    .input(
      z.object({
        taskId: z.string(),
        dependsOnTaskId: z.string(),
        kind: z.nativeEnum(DependencyKind).default(DependencyKind.FINISH_TO_START),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.taskId === input.dependsOnTaskId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "A task cannot depend on itself." });
      }
      await assertTaskOwned(ctx, input.taskId);
      await assertTaskOwned(ctx, input.dependsOnTaskId);

      // Cycle check: walk the dep chain from `dependsOnTaskId`; if we reach `taskId`, reject.
      const visited = new Set<string>();
      const stack: string[] = [input.dependsOnTaskId];
      while (stack.length) {
        const next = stack.pop()!;
        if (next === input.taskId) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Adding this dependency would create a cycle.",
          });
        }
        if (visited.has(next)) continue;
        visited.add(next);
        const downstream = await ctx.db.taskDependency.findMany({
          where: { taskId: next },
          select: { dependsOnTaskId: true },
        });
        for (const d of downstream) stack.push(d.dependsOnTaskId);
      }

      return ctx.db.taskDependency.create({ data: input });
    }),

  removeDependency: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const dep = await ctx.db.taskDependency.findUnique({
        where: { id: input.id },
        include: { task: { select: { userId: true } } },
      });
      if (!dep || dep.task.userId !== ctx.session.user.id) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      await ctx.db.taskDependency.delete({ where: { id: input.id } });
      return { ok: true };
    }),

  /** Mark a task DONE and (optionally) record retrospective metrics for calibration. */
  markComplete: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        actualMinutes: z.number().int().min(0).max(60 * 24 * 30).nullish(),
        actualStress: StressInt.nullish(),
        actualExhaustion: StressInt.nullish(),
        actualValence: z.number().int().min(-5).max(5).nullish(),
        retroNotes: z.string().trim().max(5000).nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertTaskOwned(ctx, input.id);
      const now = new Date();

      return ctx.db.$transaction(async (tx) => {
        await tx.task.update({
          where: { id: input.id },
          data: { status: TaskStatus.DONE, completedAt: now },
        });
        return tx.taskCompletion.create({
          data: {
            taskId: input.id,
            userId: ctx.session.user.id,
            completedAt: now,
            actualMinutes: input.actualMinutes ?? null,
            actualStress: input.actualStress ?? null,
            actualExhaustion: input.actualExhaustion ?? null,
            actualValence: input.actualValence ?? null,
            retroNotes: input.retroNotes ?? null,
          },
        });
      });
    }),
});

// ---- helpers ----

type Ctx = { db: import("@prisma/client").PrismaClient; session: { user: { id: string } } };

async function assertTaskOwned(ctx: Ctx, taskId: string) {
  const t = await ctx.db.task.findFirst({
    where: { id: taskId, userId: ctx.session.user.id },
    select: { id: true },
  });
  if (!t) throw new TRPCError({ code: "NOT_FOUND", message: "Task not found." });
}

async function assertReferencedOwned(
  ctx: Ctx,
  data: { areaId?: string | null; projectId?: string | null; parentTaskId?: string | null; tagIds?: string[] },
) {
  if (data.areaId) {
    const area = await ctx.db.area.findFirst({
      where: { id: data.areaId, userId: ctx.session.user.id },
      select: { id: true },
    });
    if (!area) throw new TRPCError({ code: "BAD_REQUEST", message: "Area not found." });
  }
  if (data.projectId) {
    const project = await ctx.db.project.findFirst({
      where: { id: data.projectId, userId: ctx.session.user.id },
      select: { id: true },
    });
    if (!project) throw new TRPCError({ code: "BAD_REQUEST", message: "Project not found." });
  }
  if (data.parentTaskId) {
    await assertTaskOwned(ctx, data.parentTaskId);
  }
  if (data.tagIds?.length) {
    const count = await ctx.db.tag.count({
      where: { id: { in: data.tagIds }, userId: ctx.session.user.id },
    });
    if (count !== data.tagIds.length) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "One or more tags not found." });
    }
  }
}
