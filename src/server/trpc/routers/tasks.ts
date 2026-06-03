import { TRPCError } from "@trpc/server";
import { DependencyKind, EventKind, EventSource, TaskStatus, type Prisma } from "@prisma/client";
import { z } from "zod";

import { protectedProcedure, router } from "../init";
import { getTaskAccess, canRead, canWrite } from "@/server/lib/access";
import { inferTaskMetadata } from "@/server/lib/ai-infer-task";
import { applyFactDeltas } from "@/server/lib/apply-fact-deltas";
import { gatherUserContext } from "@/server/lib/context";
import { findFreeSlot } from "./events";

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
    // Readable by the owner or anyone the task (or one of its tags) is shared with.
    const access = await getTaskAccess(ctx.db, ctx.session.user.id, input.id);
    if (!canRead(access)) throw new TRPCError({ code: "NOT_FOUND" });
    const task = await ctx.db.task.findUnique({
      where: { id: input.id },
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
      const access = await getTaskAccess(ctx.db, ctx.session.user.id, id);
      if (!canWrite(access)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "No write access to this task." });
      }
      const isOwner = access === "owner";

      let effectiveTagIds = tagIds;
      if (isOwner) {
        await assertReferencedOwned(ctx, data);
      } else {
        // Collaborators may edit metrics / status / text, but not the owner's
        // org structure (area / project / parent) or tag set.
        delete (data as { areaId?: unknown }).areaId;
        delete (data as { projectId?: unknown }).projectId;
        delete (data as { parentTaskId?: unknown }).parentTaskId;
        effectiveTagIds = undefined;
      }

      // Treat status transitions to DONE/DROPPED as setting the corresponding timestamps.
      if (data.status === TaskStatus.DONE) (data as Prisma.TaskUpdateInput).completedAt = new Date();
      if (data.status === TaskStatus.DROPPED) (data as Prisma.TaskUpdateInput).droppedAt = new Date();

      return ctx.db.$transaction(async (tx) => {
        const updated = await tx.task.update({ where: { id }, data });
        if (effectiveTagIds) {
          await tx.taskTag.deleteMany({ where: { taskId: id } });
          if (effectiveTagIds.length) {
            await tx.taskTag.createMany({
              data: effectiveTagIds.map((tagId) => ({ taskId: id, tagId })),
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
      const access = await getTaskAccess(ctx.db, ctx.session.user.id, input.id);
      if (!canWrite(access)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "No write access to this task." });
      }
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

  /**
   * Take a rough inbox task ("notes-on-a-napkin"), have Claude rewrite its
   * title + description, fill in any blank metadata, suggest tags, and drop
   * it onto the next free slot. One-button "turn this into a real, scheduled
   * task." Only fields the user left blank get overwritten — explicit values
   * are preserved.
   */
  aiSchedule: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const task = await ctx.db.task.findFirst({
        where: { id: input.id, userId },
        include: { tags: { select: { tagId: true } } },
      });
      if (!task) throw new TRPCError({ code: "NOT_FOUND", message: "Task not found." });

      // Load the user's tag library so the AI can suggest tags from it.
      // Skip if the task already has tags — respect the user's curation.
      const availableTags = task.tags.length
        ? undefined
        : await ctx.db.tag.findMany({
            where: { userId },
            select: { id: true, name: true, description: true },
          });

      // Second-brain context: profile + relevant wiki pages + recent
      // memories that overlap with the input. The AI is allowed to
      // propose factDeltas against the memories we hand it.
      const context = await gatherUserContext(
        ctx.db,
        userId,
        `${task.name}\n${task.description ?? ""}`,
      );

      const inferred = await inferTaskMetadata({
        title: task.name,
        description: task.description,
        provided: {
          estimatedMinutes: task.estimatedMinutes,
          stress: task.stress,
          exhaustion: task.exhaustion,
          importance: task.importance,
          urgency: task.urgency,
          tagIds: task.tags.length ? task.tags.map((t) => t.tagId) : undefined,
        },
        availableTags,
        enhanceText: true,
        userContext: context.promptText,
        contextMemories: context.memories.map((m) => ({
          id: m.id,
          content: m.content,
          status: m.status,
        })),
      });

      // Apply only what came back — leave user-set values alone.
      const newName = inferred.improvedTitle ?? task.name;
      const newDescription = inferred.improvedDescription ?? task.description;
      const estimatedMinutes = task.estimatedMinutes ?? inferred.estimatedMinutes ?? null;
      const stress = task.stress ?? inferred.stress ?? null;
      const exhaustion = task.exhaustion ?? inferred.exhaustion ?? null;
      const importance = task.importance ?? inferred.importance ?? null;
      const urgency = task.urgency ?? inferred.urgency ?? null;
      const newTagIds = inferred.tagIds ?? [];

      const durationMin = Math.min(12 * 60, Math.max(15, estimatedMinutes ?? 60));

      // Find a free slot now so we have a place to put it.
      const now = new Date();
      const horizonEnd = new Date(now.getTime() + 21 * 86_400_000);
      const busy = await ctx.db.event.findMany({
        where: {
          userId,
          kind: EventKind.ACTIVE,
          AND: [{ startsAt: { lt: horizonEnd } }, { endsAt: { gt: now } }],
        },
        select: { startsAt: true, endsAt: true },
      });
      const slot = findFreeSlot(now, durationMin, busy);

      // One transaction: update the task, attach any new tags, mark it
      // SCHEDULED, and create the event linked to it.
      const result = await ctx.db.$transaction(async (tx) => {
        const updatedTask = await tx.task.update({
          where: { id: task.id },
          data: {
            name: newName,
            description: newDescription,
            estimatedMinutes,
            stress,
            exhaustion,
            importance,
            urgency,
            status: TaskStatus.SCHEDULED,
          },
        });

        if (newTagIds.length && task.tags.length === 0) {
          await tx.taskTag.createMany({
            data: newTagIds.map((tagId) => ({ taskId: task.id, tagId })),
            skipDuplicates: true,
          });
        }

        const event = await tx.event.create({
          data: {
            userId,
            title: newName,
            startsAt: slot.start,
            endsAt: slot.end,
            kind: EventKind.ACTIVE,
            source: EventSource.SUGGESTED,
            confidence: 1,
            attributions: { create: { taskId: task.id, weight: 1, ratioUnknown: false } },
          },
        });

        return { task: updatedTask, event };
      });

      // Apply any second-brain updates the AI proposed. Best-effort: if
      // this throws, we still want the task scheduled.
      if (inferred.factDeltas?.length) {
        try {
          await applyFactDeltas(ctx.db, userId, inferred.factDeltas, "ai-aiSchedule");
        } catch (err) {
          console.error("[aiSchedule] applyFactDeltas failed:", err);
        }
      }

      return { ...result, inferred };
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
