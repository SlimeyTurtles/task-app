import { TRPCError } from "@trpc/server";
import { EventKind, EventSource, type Prisma } from "@prisma/client";
import { z } from "zod";

import { protectedProcedure, router } from "../init";

const AttributionInput = z.object({
  taskId: z.string(),
  weight: z.number().min(0).max(1).default(1),
  ratioUnknown: z.boolean().default(false),
});

const EventInput = z.object({
  startsAt: z.date(),
  endsAt: z.date(),
  notes: z.string().max(5000).nullish(),
  kind: z.nativeEnum(EventKind).default(EventKind.ACTIVE),
  source: z.nativeEnum(EventSource).default(EventSource.MANUAL),
  /** When true (or wide-window heuristic kicks in), confidence drops to 0.3 — see design doc §4.1 "lazy log". */
  lazy: z.boolean().default(false),
  attributions: z.array(AttributionInput).default([]),
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
        attributions: { include: { task: true } },
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
    .input(EventInput.partial().extend({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { id, attributions, lazy, ...rest } = input;
      const owned = await ctx.db.event.findFirst({
        where: { id, userId: ctx.session.user.id },
        select: { id: true, startsAt: true, endsAt: true },
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
      if (lazy !== undefined || rest.startsAt || rest.endsAt) {
        data.confidence = computeConfidence(lazy ?? false, startsAt, endsAt);
      }

      return ctx.db.$transaction(async (tx) => {
        const updated = await tx.event.update({ where: { id }, data });
        if (attributions) {
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
});

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
