import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { protectedProcedure, router } from "../init";

const TagInput = z.object({
  name: z.string().trim().min(1).max(64),
  parentTagId: z.string().nullish(),
  color: z.string().trim().max(32).nullish(),
  description: z.string().trim().max(2000).nullish(),
});

export const tagsRouter = router({
  /** Flat list (callers can build the tree client-side from parentTagId). */
  list: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db.tag.findMany({
      where: { userId: ctx.session.user.id },
      orderBy: [{ name: "asc" }],
      include: {
        _count: { select: { tasks: true, projects: true } },
      },
    });
  }),

  create: protectedProcedure.input(TagInput).mutation(async ({ ctx, input }) => {
    if (input.parentTagId) await assertTagOwned(ctx, input.parentTagId);
    return ctx.db.tag.create({
      data: { ...input, userId: ctx.session.user.id },
    });
  }),

  update: protectedProcedure
    .input(TagInput.partial().extend({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      await assertTagOwned(ctx, id);

      if (data.parentTagId !== undefined && data.parentTagId !== null) {
        if (data.parentTagId === id) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "A tag cannot be its own parent." });
        }
        await assertTagOwned(ctx, data.parentTagId);
        // Reparenting cycle check: walk the prospective ancestor chain.
        let cursor: string | null = data.parentTagId;
        const seen = new Set<string>([id]);
        while (cursor) {
          if (seen.has(cursor)) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Reparenting would create a cycle in the tag tree.",
            });
          }
          seen.add(cursor);
          const parent: { parentTagId: string | null } | null = await ctx.db.tag.findUnique({
            where: { id: cursor },
            select: { parentTagId: true },
          });
          cursor = parent?.parentTagId ?? null;
        }
      }

      return ctx.db.tag.update({ where: { id }, data });
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await assertTagOwned(ctx, input.id);
      await ctx.db.tag.delete({ where: { id: input.id } });
      return { ok: true };
    }),
});

async function assertTagOwned(
  ctx: { db: import("@prisma/client").PrismaClient; session: { user: { id: string } } },
  tagId: string,
) {
  const tag = await ctx.db.tag.findFirst({
    where: { id: tagId, userId: ctx.session.user.id },
    select: { id: true },
  });
  if (!tag) throw new TRPCError({ code: "NOT_FOUND", message: "Tag not found." });
}
