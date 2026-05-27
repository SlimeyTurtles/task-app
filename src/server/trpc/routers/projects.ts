import { TRPCError } from "@trpc/server";
import { ProjectStatus } from "@prisma/client";
import { z } from "zod";

import { protectedProcedure, router } from "../init";

const ProjectInput = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(5000).nullish(),
  definitionOfDone: z.string().trim().max(5000).nullish(),
  areaId: z.string().nullish(),
  dueDate: z.date().nullish(),
  status: z.nativeEnum(ProjectStatus).optional(),
});

export const projectsRouter = router({
  list: protectedProcedure
    .input(
      z
        .object({
          areaId: z.string().nullish(),
          status: z.array(z.nativeEnum(ProjectStatus)).optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      return ctx.db.project.findMany({
        where: {
          userId: ctx.session.user.id,
          ...(input?.areaId !== undefined ? { areaId: input.areaId } : {}),
          ...(input?.status?.length ? { status: { in: input.status } } : {}),
        },
        orderBy: [{ status: "asc" }, { dueDate: { sort: "asc", nulls: "last" } }, { name: "asc" }],
        include: {
          area: { select: { id: true, name: true, color: true } },
          _count: { select: { tasks: true } },
        },
      });
    }),

  get: protectedProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    const project = await ctx.db.project.findFirst({
      where: { id: input.id, userId: ctx.session.user.id },
      include: {
        area: { select: { id: true, name: true, color: true } },
        _count: { select: { tasks: true } },
      },
    });
    if (!project) throw new TRPCError({ code: "NOT_FOUND" });
    return project;
  }),

  create: protectedProcedure.input(ProjectInput).mutation(async ({ ctx, input }) => {
    if (input.areaId) await assertAreaOwned(ctx, input.areaId);
    return ctx.db.project.create({
      data: { ...input, userId: ctx.session.user.id },
    });
  }),

  update: protectedProcedure
    .input(ProjectInput.partial().extend({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      const owned = await ctx.db.project.findFirst({
        where: { id, userId: ctx.session.user.id },
        select: { id: true },
      });
      if (!owned) throw new TRPCError({ code: "NOT_FOUND" });
      if (data.areaId) await assertAreaOwned(ctx, data.areaId);
      return ctx.db.project.update({ where: { id }, data });
    }),

  setStatus: protectedProcedure
    .input(z.object({ id: z.string(), status: z.nativeEnum(ProjectStatus) }))
    .mutation(async ({ ctx, input }) => {
      const owned = await ctx.db.project.findFirst({
        where: { id: input.id, userId: ctx.session.user.id },
        select: { id: true },
      });
      if (!owned) throw new TRPCError({ code: "NOT_FOUND" });
      return ctx.db.project.update({
        where: { id: input.id },
        data: { status: input.status },
      });
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const owned = await ctx.db.project.findFirst({
        where: { id: input.id, userId: ctx.session.user.id },
        select: { id: true },
      });
      if (!owned) throw new TRPCError({ code: "NOT_FOUND" });
      await ctx.db.project.delete({ where: { id: input.id } });
      return { ok: true };
    }),
});

async function assertAreaOwned(
  ctx: { db: import("@prisma/client").PrismaClient; session: { user: { id: string } } },
  areaId: string,
) {
  const area = await ctx.db.area.findFirst({
    where: { id: areaId, userId: ctx.session.user.id },
    select: { id: true },
  });
  if (!area) throw new TRPCError({ code: "BAD_REQUEST", message: "Area not found." });
}
