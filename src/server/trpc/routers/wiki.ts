import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { protectedProcedure, router } from "../init";

const SlugInput = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, "Slug must be lowercase letters/digits/dashes.");

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip accents
    .replace(/[^a-z0-9\s-]+/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 120) || "untitled";
}

export const wikiRouter = router({
  // ── Profile ──────────────────────────────────────────────────────────
  getProfile: protectedProcedure.query(async ({ ctx }) => {
    const p = await ctx.db.userProfile.findUnique({
      where: { userId: ctx.session.user.id },
    });
    return p?.content ?? "";
  }),

  updateProfile: protectedProcedure
    .input(z.object({ content: z.string().max(20_000) }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.userProfile.upsert({
        where: { userId: ctx.session.user.id },
        create: { userId: ctx.session.user.id, content: input.content },
        update: { content: input.content },
      });
      return { ok: true };
    }),

  // ── Pages ────────────────────────────────────────────────────────────
  listPages: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db.wikiPage.findMany({
      where: { userId: ctx.session.user.id },
      orderBy: { updatedAt: "desc" },
      select: { id: true, slug: true, title: true, aliases: true, updatedAt: true },
    });
  }),

  getPage: protectedProcedure
    .input(z.object({ slug: SlugInput }))
    .query(async ({ ctx, input }) => {
      return ctx.db.wikiPage.findUnique({
        where: { userId_slug: { userId: ctx.session.user.id, slug: input.slug } },
      });
    }),

  // Find-or-create by title. Used by [[wikilink]] navigation: click a link
  // to a page that doesn't exist yet → create it with empty content and
  // open it. Returns the slug for routing.
  upsertPage: protectedProcedure
    .input(
      z.object({
        title: z.string().trim().min(1).max(200),
        aliases: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
        content: z.string().max(50_000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const slug = slugify(input.title);
      const userId = ctx.session.user.id;

      // If a page with this slug exists, update; else create.
      const existing = await ctx.db.wikiPage.findUnique({
        where: { userId_slug: { userId, slug } },
      });
      if (existing) {
        return ctx.db.wikiPage.update({
          where: { id: existing.id },
          data: {
            title: input.title,
            aliases: input.aliases ?? existing.aliases,
            content: input.content ?? existing.content,
          },
        });
      }
      return ctx.db.wikiPage.create({
        data: {
          userId,
          slug,
          title: input.title,
          aliases: input.aliases ?? [],
          content: input.content ?? "",
        },
      });
    }),

  deletePage: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const owned = await ctx.db.wikiPage.findFirst({
        where: { id: input.id, userId: ctx.session.user.id },
        select: { id: true },
      });
      if (!owned) throw new TRPCError({ code: "NOT_FOUND" });
      await ctx.db.wikiPage.delete({ where: { id: input.id } });
      return { ok: true };
    }),

  // ── Memories ─────────────────────────────────────────────────────────
  listMemories: protectedProcedure
    .input(
      z
        .object({
          status: z
            .array(z.enum(["PENDING", "CONFIRMED", "REJECTED", "STALE", "SUPERSEDED"]))
            .optional(),
          limit: z.number().int().min(1).max(500).default(200),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      return ctx.db.memory.findMany({
        where: {
          userId: ctx.session.user.id,
          ...(input?.status?.length ? { status: { in: input.status } } : {}),
        },
        orderBy: { createdAt: "desc" },
        take: input?.limit ?? 200,
        include: {
          supersedes: { select: { id: true, content: true } },
        },
      });
    }),

  createMemory: protectedProcedure
    .input(z.object({ content: z.string().trim().min(1).max(800) }))
    .mutation(async ({ ctx, input }) => {
      return ctx.db.memory.create({
        data: {
          userId: ctx.session.user.id,
          content: input.content,
          status: "CONFIRMED", // manually created memories trust the user
          source: "manual",
          confirmedAt: new Date(),
        },
      });
    }),

  updateMemory: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        content: z.string().trim().min(1).max(800).optional(),
        status: z
          .enum(["PENDING", "CONFIRMED", "REJECTED", "STALE", "SUPERSEDED"])
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const owned = await ctx.db.memory.findFirst({
        where: { id: input.id, userId: ctx.session.user.id },
        select: { id: true },
      });
      if (!owned) throw new TRPCError({ code: "NOT_FOUND" });
      return ctx.db.memory.update({
        where: { id: input.id },
        data: {
          ...(input.content != null ? { content: input.content } : {}),
          ...(input.status != null
            ? {
                status: input.status,
                confirmedAt:
                  input.status === "CONFIRMED" ? new Date() : undefined,
              }
            : {}),
        },
      });
    }),

  deleteMemory: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const owned = await ctx.db.memory.findFirst({
        where: { id: input.id, userId: ctx.session.user.id },
        select: { id: true },
      });
      if (!owned) throw new TRPCError({ code: "NOT_FOUND" });
      await ctx.db.memory.delete({ where: { id: input.id } });
      return { ok: true };
    }),
});
