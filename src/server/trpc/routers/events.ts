import { TRPCError } from "@trpc/server";
import { EventKind, EventSource, TaskStatus, type Prisma } from "@prisma/client";
import { z } from "zod";

import { protectedProcedure, router } from "../init";
import { addDays, startOfLocalDay } from "@/lib/scheduling";
import { inferTaskMetadata } from "@/server/lib/ai-infer-task";
import { applyFactDeltas } from "@/server/lib/apply-fact-deltas";
import { gatherUserContext } from "@/server/lib/context";

const AttributionInput = z.object({
  taskId: z.string(),
  weight: z.number().min(0).max(1).default(1),
  ratioUnknown: z.boolean().default(false),
});

const EventInput = z.object({
  title: z.string().trim().max(300).nullish(),
  startsAt: z.date(),
  endsAt: z.date(),
  notes: z.string().max(5000).nullish(),
  kind: z.nativeEnum(EventKind).default(EventKind.ACTIVE),
  source: z.nativeEnum(EventSource).default(EventSource.MANUAL),
  /** When true (or wide-window heuristic kicks in), confidence drops to 0.3 — see design doc §4.1 "lazy log". */
  lazy: z.boolean().default(false),
  attributions: z.array(AttributionInput).default([]),
});

// Update uses explicit optionals with NO defaults: an omitted field must stay
// `undefined` (= "leave unchanged"). A `.default()` here would silently turn a
// move (which sends only times) into "clear attributions / reset kind" — that
// was the move-detaches-the-task bug.
const EventUpdateInput = z.object({
  id: z.string(),
  title: z.string().trim().max(300).nullish(),
  startsAt: z.date().optional(),
  endsAt: z.date().optional(),
  notes: z.string().max(5000).nullish(),
  kind: z.nativeEnum(EventKind).optional(),
  source: z.nativeEnum(EventSource).optional(),
  lazy: z.boolean().optional(),
  attributions: z.array(AttributionInput).optional(),
});

const Range = z.object({
  start: z.date(),
  end: z.date(),
});

export const eventsRouter = router({
  list: protectedProcedure.input(Range).query(async ({ ctx, input }) => {
    return ctx.db.event.findMany({
      where: {
        userId: ctx.session.user.id,
        AND: [{ startsAt: { lte: input.end } }, { endsAt: { gte: input.start } }],
      },
      orderBy: { startsAt: "asc" },
      include: {
        attributions: {
          include: {
            task: {
              select: {
                id: true,
                name: true,
                status: true,
                stress: true,
                exhaustion: true,
                estimatedMinutes: true,
                area: { select: { id: true, name: true, color: true } },
                project: { select: { id: true, name: true } },
                tags: { include: { tag: { select: { id: true, name: true, color: true } } } },
              },
            },
          },
        },
      },
    });
  }),

  get: protectedProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    const event = await ctx.db.event.findFirst({
      where: { id: input.id, userId: ctx.session.user.id },
      include: {
        attributions: {
          include: {
            task: {
              select: {
                id: true,
                name: true,
                status: true,
                stress: true,
                exhaustion: true,
                estimatedMinutes: true,
                importance: true,
                urgency: true,
                dueDate: true,
                area: { select: { id: true, name: true, color: true } },
                project: { select: { id: true, name: true } },
                tags: { include: { tag: { select: { id: true, name: true, color: true } } } },
              },
            },
          },
        },
      },
    });
    if (!event) throw new TRPCError({ code: "NOT_FOUND" });
    return event;
  }),

  create: protectedProcedure.input(EventInput).mutation(async ({ ctx, input }) => {
    if (input.endsAt <= input.startsAt) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "End must be after start." });
    }
    await assertTasksOwned(ctx, input.attributions.map((a) => a.taskId));

    const confidence = computeConfidence(input.lazy, input.startsAt, input.endsAt);
    const ratioUnknownDefault = input.attributions.length > 1;

    return ctx.db.event.create({
      data: {
        userId: ctx.session.user.id,
        title: input.title ?? null,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        notes: input.notes ?? null,
        kind: input.kind,
        source: input.source,
        confidence,
        attributions: input.attributions.length
          ? {
              create: input.attributions.map((a) => ({
                taskId: a.taskId,
                weight: a.weight,
                ratioUnknown: a.ratioUnknown || ratioUnknownDefault,
              })),
            }
          : undefined,
      },
    });
  }),

  update: protectedProcedure
    .input(EventUpdateInput)
    .mutation(async ({ ctx, input }) => {
      const { id, attributions, lazy, ...rest } = input;
      const owned = await ctx.db.event.findFirst({
        where: { id, userId: ctx.session.user.id },
        select: { id: true, startsAt: true, endsAt: true, confidence: true },
      });
      if (!owned) throw new TRPCError({ code: "NOT_FOUND" });

      if (attributions) {
        await assertTasksOwned(ctx, attributions.map((a) => a.taskId));
      }

      const startsAt = rest.startsAt ?? owned.startsAt;
      const endsAt = rest.endsAt ?? owned.endsAt;
      if (endsAt <= startsAt) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "End must be after start." });
      }

      const data: Prisma.EventUpdateInput = { ...rest };
      // Recompute confidence only when lazy or the times changed; preserve the
      // event's existing laziness across a plain move/resize.
      if (lazy !== undefined || rest.startsAt || rest.endsAt) {
        const effectiveLazy = lazy ?? owned.confidence < 1;
        data.confidence = computeConfidence(effectiveLazy, startsAt, endsAt);
      }

      return ctx.db.$transaction(async (tx) => {
        const updated = await tx.event.update({ where: { id }, data });
        // Only touch attributions when the caller explicitly passed them.
        if (attributions !== undefined) {
          await tx.eventTaskAttribution.deleteMany({ where: { eventId: id } });
          if (attributions.length) {
            const ratioUnknownDefault = attributions.length > 1;
            await tx.eventTaskAttribution.createMany({
              data: attributions.map((a) => ({
                eventId: id,
                taskId: a.taskId,
                weight: a.weight,
                ratioUnknown: a.ratioUnknown || ratioUnknownDefault,
              })),
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
      const owned = await ctx.db.event.findFirst({
        where: { id: input.id, userId: ctx.session.user.id },
        select: { id: true },
      });
      if (!owned) throw new TRPCError({ code: "NOT_FOUND" });
      await ctx.db.event.delete({ where: { id: input.id } });
      return { ok: true };
    }),

  /**
   * Quick log: drop a single task into a time window. Used by drag-from-inbox.
   * If `lazy` is true (or window >4h), confidence will be 0.3.
   */
  logTask: protectedProcedure
    .input(
      z.object({
        taskId: z.string(),
        startsAt: z.date(),
        endsAt: z.date(),
        lazy: z.boolean().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.endsAt <= input.startsAt) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "End must be after start." });
      }
      await assertTasksOwned(ctx, [input.taskId]);
      const confidence = computeConfidence(input.lazy, input.startsAt, input.endsAt);
      return ctx.db.event.create({
        data: {
          userId: ctx.session.user.id,
          startsAt: input.startsAt,
          endsAt: input.endsAt,
          kind: EventKind.ACTIVE,
          source: EventSource.QUICK_LOG,
          confidence,
          attributions: { create: { taskId: input.taskId, weight: 1, ratioUnknown: false } },
        },
      });
    }),

  /**
   * "Drop on calendar": place a 1-hour block for a task at the next free-ish
   * slot today (rounded to the next half hour), so the user can drag it to
   * the right spot. Falls back to tomorrow morning if it's late.
   */
  dropOnCalendar: protectedProcedure
    .input(z.object({ taskId: z.string(), estimatedMinutes: z.number().int().min(1).max(24 * 60).optional() }))
    .mutation(async ({ ctx, input }) => {
      await assertTasksOwned(ctx, [input.taskId]);

      const now = new Date();
      const start = new Date(now);
      // round up to the next half hour
      start.setSeconds(0, 0);
      const mins = start.getMinutes();
      start.setMinutes(mins <= 0 ? 0 : mins <= 30 ? 30 : 60);
      // if past 21:00, drop tomorrow at 9am
      if (start.getHours() >= 21) {
        start.setDate(start.getDate() + 1);
        start.setHours(9, 0, 0, 0);
      } else if (start.getHours() < 6) {
        start.setHours(9, 0, 0, 0);
      }
      const dur = input.estimatedMinutes ?? 60;
      const endsAt = new Date(start.getTime() + dur * 60_000);

      return ctx.db.event.create({
        data: {
          userId: ctx.session.user.id,
          startsAt: start,
          endsAt,
          kind: EventKind.ACTIVE,
          source: EventSource.QUICK_LOG,
          confidence: 1,
          attributions: { create: { taskId: input.taskId, weight: 1, ratioUnknown: false } },
        },
      });
    }),

  /**
   * Quick capture → auto-schedule. Creates a task from the supplied
   * name / about / estimate / difficulty (or uses an existing task), finds
   * the next free slot in working hours, and drops a scheduled event there.
   * No time needs to be chosen by the user — they can drag it afterwards.
   */
  quickAdd: protectedProcedure
    .input(
      z.object({
        title: z.string().trim().min(1).max(300),
        description: z.string().trim().max(10_000).nullish(),
        estimatedMinutes: z.number().int().min(5).max(12 * 60).nullish(),
        stress: z.number().int().min(0).max(10).nullish(),
        exhaustion: z.number().int().min(0).max(10).nullish(),
        importance: z.number().int().min(0).max(10).nullish(),
        urgency: z.number().int().min(0).max(10).nullish(),
        dueDate: z.date().nullish(),
        attachTaskId: z.string().nullish(),
        createTask: z.boolean().default(true),
        tagIds: z.array(z.string()).optional(),
        // Optional manual schedule. If both provided, use them verbatim
        // instead of finding a free slot. Lets "Pick a time" reuse this path
        // (and benefit from AI inference) without a second mutation.
        startsAt: z.date().nullish(),
        endsAt: z.date().nullish(),
        lazy: z.boolean().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Validate any tag ids belong to this user.
      if (input.tagIds?.length) {
        const count = await ctx.db.tag.count({
          where: { id: { in: input.tagIds }, userId },
        });
        if (count !== input.tagIds.length) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "One or more tags not found." });
        }
      }

      // Load the user's tag library so Claude can suggest tags too — only when
      // the user didn't already pick any.
      const availableTags = input.tagIds?.length
        ? undefined
        : await ctx.db.tag.findMany({
            where: { userId },
            select: { id: true, name: true, description: true },
          });

      // Pull the user's second-brain context relevant to this title/desc so
      // the AI has people/projects/preferences to lean on.
      const context = await gatherUserContext(
        ctx.db,
        userId,
        `${input.title}\n${input.description ?? ""}`,
      );

      // Let Claude fill in any of {estimatedMinutes, stress, exhaustion,
      // importance, urgency, tagIds} the user left blank — using the title +
      // description + tag catalog + second-brain context. Skips fields the
      // user explicitly set; no-ops if no CLAUDE_API_KEY is configured.
      const inferred = await inferTaskMetadata({
        title: input.title,
        description: input.description ?? null,
        provided: {
          estimatedMinutes: input.estimatedMinutes ?? null,
          stress: input.stress ?? null,
          exhaustion: input.exhaustion ?? null,
          importance: input.importance ?? null,
          urgency: input.urgency ?? null,
          tagIds: input.tagIds,
        },
        availableTags,
        userContext: context.promptText,
        contextMemories: context.memories.map((m) => ({
          id: m.id,
          content: m.content,
          status: m.status,
        })),
      });

      const estimatedMinutes = input.estimatedMinutes ?? inferred.estimatedMinutes ?? null;
      const stress = input.stress ?? inferred.stress ?? null;
      const exhaustion = input.exhaustion ?? inferred.exhaustion ?? null;
      const importance = input.importance ?? inferred.importance ?? null;
      const urgency = input.urgency ?? inferred.urgency ?? null;
      // Caller's explicit tagIds win; otherwise use Claude's suggestion (may be empty).
      const tagIds = input.tagIds ?? inferred.tagIds ?? [];

      const durationMin = Math.min(12 * 60, Math.max(15, estimatedMinutes ?? 60));

      let taskId = input.attachTaskId ?? null;
      if (taskId) {
        await assertTasksOwned(ctx, [taskId]);
        if (tagIds.length) {
          await ctx.db.taskTag.createMany({
            data: tagIds.map((tagId) => ({ taskId: taskId!, tagId })),
            skipDuplicates: true,
          });
        }
      } else if (input.createTask) {
        const task = await ctx.db.task.create({
          data: {
            userId,
            name: input.title,
            description: input.description ?? null,
            estimatedMinutes,
            stress,
            exhaustion,
            importance,
            urgency,
            dueDate: input.dueDate ?? null,
            status: TaskStatus.SCHEDULED,
            ...(tagIds.length
              ? { tags: { create: tagIds.map((tagId) => ({ tagId })) } }
              : {}),
          },
        });
        taskId = task.id;
      }

      let start: Date;
      let end: Date;
      let source: EventSource;
      if (input.startsAt && input.endsAt) {
        if (input.endsAt <= input.startsAt) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "End must be after start." });
        }
        start = input.startsAt;
        end = input.endsAt;
        source = EventSource.MANUAL;
      } else {
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
        start = slot.start;
        end = slot.end;
        source = EventSource.SUGGESTED;
      }

      const event = await ctx.db.event.create({
        data: {
          userId,
          title: input.title,
          startsAt: start,
          endsAt: end,
          kind: EventKind.ACTIVE,
          source,
          confidence: input.lazy ? 0.3 : 1,
          ...(taskId
            ? { attributions: { create: { taskId, weight: 1, ratioUnknown: false } } }
            : {}),
        },
      });

      // Best-effort: write any second-brain updates the AI proposed.
      if (inferred.factDeltas?.length) {
        try {
          await applyFactDeltas(ctx.db, userId, inferred.factDeltas, "ai-quickAdd");
        } catch (err) {
          console.error("[quickAdd] applyFactDeltas failed:", err);
        }
      }

      return { event, inferred, taskId };
    }),
});

const WORK_START_HOUR = 8;
const WORK_END_HOUR = 22;
const SLOT_STEP_MIN = 15;

/** First gap of `durationMin` in working hours (8 AM–10 PM) over the next 3 weeks that no ACTIVE event occupies. */
export function findFreeSlot(
  now: Date,
  durationMin: number,
  busy: { startsAt: Date; endsAt: Date }[],
): { start: Date; end: Date } {
  const durMs = durationMin * 60_000;
  const stepMs = SLOT_STEP_MIN * 60_000;
  const earliest = new Date(now);
  earliest.setSeconds(0, 0);
  earliest.setMinutes(Math.ceil(earliest.getMinutes() / SLOT_STEP_MIN) * SLOT_STEP_MIN);

  for (let day = 0; day < 21; day++) {
    const base = startOfLocalDay(addDays(now, day));
    const winEnd = new Date(base);
    winEnd.setHours(WORK_END_HOUR, 0, 0, 0);
    let t = new Date(base);
    t.setHours(WORK_START_HOUR, 0, 0, 0);
    if (t < earliest) t = new Date(earliest);
    // align to step
    t.setMinutes(Math.ceil(t.getMinutes() / SLOT_STEP_MIN) * SLOT_STEP_MIN, 0, 0);

    while (t.getTime() + durMs <= winEnd.getTime()) {
      const end = new Date(t.getTime() + durMs);
      const overlaps = busy.some((b) => b.startsAt.getTime() < end.getTime() && b.endsAt.getTime() > t.getTime());
      if (!overlaps) return { start: new Date(t), end };
      t = new Date(t.getTime() + stepMs);
    }
  }
  // Fallback: the earliest aligned slot regardless of collisions.
  return { start: earliest, end: new Date(earliest.getTime() + durMs) };
}

function computeConfidence(lazy: boolean, startsAt: Date, endsAt: Date): number {
  const hours = (endsAt.getTime() - startsAt.getTime()) / 3_600_000;
  if (lazy) return 0.3;
  if (hours > 4) return Math.max(0.3, 1 / Math.sqrt(hours)); // soft penalty for wide windows
  return 1;
}

type Ctx = { db: import("@prisma/client").PrismaClient; session: { user: { id: string } } };

async function assertTasksOwned(ctx: Ctx, taskIds: string[]) {
  if (taskIds.length === 0) return;
  const count = await ctx.db.task.count({
    where: { id: { in: taskIds }, userId: ctx.session.user.id },
  });
  if (count !== taskIds.length) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "One or more tasks not found." });
  }
}
