import { TRPCError } from "@trpc/server";
import { TimeBlockKind } from "@prisma/client";
import { z } from "zod";

import { protectedProcedure, router } from "../init";

const Range = z.object({ start: z.date(), end: z.date() });

const TimeBlockInput = z.object({
  startsAt: z.date(),
  endsAt: z.date(),
  kind: z.nativeEnum(TimeBlockKind).default(TimeBlockKind.CUSTOM),
  label: z.string().max(120).nullish(),
  rrule: z.string().max(2000).nullish(),
  schedulableOnTop: z.boolean().default(false),
});

export const timeBlocksRouter = router({
  list: protectedProcedure.input(Range).query(async ({ ctx, input }) => {
    // Non-recurring blocks intersecting the range. RRULE expansion lands in a later phase.
    return ctx.db.timeBlock.findMany({
      where: {
        userId: ctx.session.user.id,
        AND: [{ startsAt: { lte: input.end } }, { endsAt: { gte: input.start } }],
      },
      orderBy: { startsAt: "asc" },
    });
  }),

  create: protectedProcedure.input(TimeBlockInput).mutation(async ({ ctx, input }) => {
    if (input.endsAt <= input.startsAt) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "End must be after start." });
    }
    return ctx.db.timeBlock.create({
      data: { ...input, userId: ctx.session.user.id },
    });
  }),

  update: protectedProcedure
    .input(TimeBlockInput.partial().extend({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      const owned = await ctx.db.timeBlock.findFirst({
        where: { id, userId: ctx.session.user.id },
        select: { id: true },
      });
      if (!owned) throw new TRPCError({ code: "NOT_FOUND" });
      return ctx.db.timeBlock.update({ where: { id }, data });
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const owned = await ctx.db.timeBlock.findFirst({
        where: { id: input.id, userId: ctx.session.user.id },
        select: { id: true },
      });
      if (!owned) throw new TRPCError({ code: "NOT_FOUND" });
      await ctx.db.timeBlock.delete({ where: { id: input.id } });
      return { ok: true };
    }),
});
