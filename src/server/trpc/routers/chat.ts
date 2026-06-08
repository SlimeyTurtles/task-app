import { TRPCError } from "@trpc/server";
import { ChatRole } from "@prisma/client";
import { z } from "zod";

import { protectedProcedure, router } from "../init";

export const chatRouter = router({
  // ── Folders ──────────────────────────────────────────────────────────
  listFolders: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db.chatFolder.findMany({
      where: { userId: ctx.session.user.id },
      orderBy: { name: "asc" },
      include: { _count: { select: { sessions: true } } },
    });
  }),

  createFolder: protectedProcedure
    .input(z.object({ name: z.string().trim().min(1).max(80) }))
    .mutation(async ({ ctx, input }) => {
      return ctx.db.chatFolder.create({
        data: { userId: ctx.session.user.id, name: input.name },
      });
    }),

  deleteFolder: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const owned = await ctx.db.chatFolder.findFirst({
        where: { id: input.id, userId: ctx.session.user.id },
        select: { id: true },
      });
      if (!owned) throw new TRPCError({ code: "NOT_FOUND" });
      // Sessions inside the folder fall back to "no folder" (SetNull on the
      // relation) rather than being deleted — they're still useful data.
      await ctx.db.chatFolder.delete({ where: { id: input.id } });
      return { ok: true };
    }),

  // ── Sessions ─────────────────────────────────────────────────────────
  listSessions: protectedProcedure
    .input(z.object({ folderId: z.string().nullish() }).optional())
    .query(async ({ ctx, input }) => {
      return ctx.db.chatSession.findMany({
        where: {
          userId: ctx.session.user.id,
          ...(input?.folderId !== undefined ? { folderId: input.folderId } : {}),
        },
        orderBy: { updatedAt: "desc" },
        include: { _count: { select: { messages: true } } },
      });
    }),

  getSession: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const session = await ctx.db.chatSession.findFirst({
        where: { id: input.id, userId: ctx.session.user.id },
        include: {
          folder: { select: { id: true, name: true } },
          messages: { orderBy: { createdAt: "asc" } },
        },
      });
      if (!session) throw new TRPCError({ code: "NOT_FOUND" });
      return session;
    }),

  createSession: protectedProcedure
    .input(
      z.object({
        title: z.string().trim().min(1).max(200).optional(),
        folderId: z.string().nullish(),
        model: z.string().trim().max(80).nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.folderId) await assertFolderOwned(ctx, input.folderId);
      return ctx.db.chatSession.create({
        data: {
          userId: ctx.session.user.id,
          title: input.title ?? "Untitled",
          folderId: input.folderId ?? null,
          model: input.model ?? null,
        },
      });
    }),

  updateSession: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        title: z.string().trim().min(1).max(200).optional(),
        folderId: z.string().nullish().optional(),
        model: z.string().trim().max(80).nullish().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const owned = await ctx.db.chatSession.findFirst({
        where: { id: input.id, userId: ctx.session.user.id },
        select: { id: true },
      });
      if (!owned) throw new TRPCError({ code: "NOT_FOUND" });
      if (input.folderId) await assertFolderOwned(ctx, input.folderId);
      return ctx.db.chatSession.update({
        where: { id: input.id },
        data: {
          ...(input.title != null ? { title: input.title } : {}),
          ...(input.folderId !== undefined ? { folderId: input.folderId } : {}),
          ...(input.model !== undefined ? { model: input.model } : {}),
        },
      });
    }),

  deleteSession: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const owned = await ctx.db.chatSession.findFirst({
        where: { id: input.id, userId: ctx.session.user.id },
        select: { id: true },
      });
      if (!owned) throw new TRPCError({ code: "NOT_FOUND" });
      await ctx.db.chatSession.delete({ where: { id: input.id } });
      return { ok: true };
    }),

  // ── Messages ─────────────────────────────────────────────────────────
  appendMessage: protectedProcedure
    .input(
      z.object({
        sessionId: z.string(),
        role: z.nativeEnum(ChatRole),
        content: z.string().min(1).max(50_000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const owned = await ctx.db.chatSession.findFirst({
        where: { id: input.sessionId, userId: ctx.session.user.id },
        select: { id: true },
      });
      if (!owned) throw new TRPCError({ code: "NOT_FOUND" });
      const [msg] = await ctx.db.$transaction([
        ctx.db.chatMessage.create({
          data: {
            sessionId: input.sessionId,
            role: input.role,
            content: input.content,
          },
        }),
        // Bumping updatedAt makes the sidebar list sort sensibly.
        ctx.db.chatSession.update({
          where: { id: input.sessionId },
          data: { updatedAt: new Date() },
        }),
      ]);
      return msg;
    }),
});

async function assertFolderOwned(
  ctx: { db: import("@prisma/client").PrismaClient; session: { user: { id: string } } },
  folderId: string,
): Promise<void> {
  const owned = await ctx.db.chatFolder.findFirst({
    where: { id: folderId, userId: ctx.session.user.id },
    select: { id: true },
  });
  if (!owned) throw new TRPCError({ code: "BAD_REQUEST", message: "Folder not found." });
}
