import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { protectedProcedure, router } from "../init";

const AreaInput = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).nullish(),
  color: z.string().trim().max(32).nullish(),
  icon: z.string().trim().max(64).nullish(),
});

export const areasRouter = router({
  list: protectedProcedure
    .input(z.object({ includeArchived: z.boolean().default(false) }).optional())
    .query(async ({ ctx, input }) => {
      return ctx.db.area.findMany({
        where: {
          userId: ctx.session.user.id,
          ...(input?.includeArchived ? {} : { archived: false }),
        },
        orderBy: [{ archived: "asc" }, { name: "asc" }],
        include: {
          _count: { select: { projects: true, tasks: true } },
        },
      });
    }),

  get: protectedProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    const area = await ctx.db.area.findFirst({
      where: { id: input.id, userId: ctx.session.user.id },
      include: { _count: { select: { projects: true, tasks: true } } },
    });
    if (!area) throw new TRPCError({ code: "NOT_FOUND" });
    return area;
  }),

  create: protectedProcedure.input(AreaInput).mutation(async ({ ctx, input }) => {
    return ctx.db.area.create({
      data: { ...input, userId: ctx.session.user.id },
    });
  }),

  update: protectedProcedure
    .input(AreaInput.partial().extend({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      const owned = await ctx.db.area.findFirst({
        where: { id, userId: ctx.session.user.id },
        select: { id: true },
      });
      if (!owned) throw new TRPCError({ code: "NOT_FOUND" });
      return ctx.db.area.update({ where: { id }, data });
    }),

  setArchived: protectedProcedure
    .input(z.object({ id: z.string(), archived: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const owned = await ctx.db.area.findFirst({
        where: { id: input.id, userId: ctx.session.user.id },
        select: { id: true },
      });
      if (!owned) throw new TRPCError({ code: "NOT_FOUND" });
      return ctx.db.area.update({
        where: { id: input.id },
        data: { archived: input.archived },
      });
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const owned = await ctx.db.area.findFirst({
        where: { id: input.id, userId: ctx.session.user.id },
        select: { id: true },
      });
      if (!owned) throw new TRPCError({ code: "NOT_FOUND" });
      await ctx.db.area.delete({ where: { id: input.id } });
      return { ok: true };
    }),
});
