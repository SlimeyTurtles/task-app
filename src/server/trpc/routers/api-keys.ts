import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { protectedProcedure, router } from "../init";
import { generateApiKey } from "@/server/lib/api-keys";

export const apiKeysRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db.apiKey.findMany({
      where: { userId: ctx.session.user.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        keyPrefix: true,
        scopes: true,
        expiresAt: true,
        lastUsedAt: true,
        createdAt: true,
      },
    });
  }),

  /**
   * Issues a new key. The plaintext is returned ONLY here — store it now or
   * lose it. Subsequent queries only get the prefix.
   */
  create: protectedProcedure
    .input(
      z.object({
        name: z.string().trim().min(1).max(80),
        expiresInDays: z.number().int().min(1).max(3650).nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { key, prefix, hashedKey } = generateApiKey();
      const expiresAt = input.expiresInDays
        ? new Date(Date.now() + input.expiresInDays * 86_400_000)
        : null;
      const row = await ctx.db.apiKey.create({
        data: {
          userId: ctx.session.user.id,
          name: input.name,
          keyPrefix: prefix,
          hashedKey,
          expiresAt,
        },
      });
      return { id: row.id, name: row.name, keyPrefix: prefix, key, expiresAt };
    }),

  revoke: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const owned = await ctx.db.apiKey.findFirst({
        where: { id: input.id, userId: ctx.session.user.id },
        select: { id: true },
      });
      if (!owned) throw new TRPCError({ code: "NOT_FOUND" });
      await ctx.db.apiKey.delete({ where: { id: input.id } });
      return { ok: true };
    }),
});
