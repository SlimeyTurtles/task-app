import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { protectedProcedure, router } from "../init";
import { DEFAULT_PREFS, dispatchForUser } from "@/lib/notifications-job";

const UpdatePrefsInput = z.object({
  leadMinutes: z.number().int().min(5).max(7 * 24 * 60).optional(),
  quietStartHour: z.number().int().min(0).max(23).optional(),
  quietEndHour: z.number().int().min(0).max(23).optional(),
  timezone: z.string().min(1).max(80).optional(),
  enabled: z.boolean().optional(),
});

export const notificationsRouter = router({
  unread: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;
    const [count, items] = await Promise.all([
      ctx.db.notification.count({ where: { userId, readAt: null } }),
      ctx.db.notification.findMany({
        where: { userId, readAt: null },
        orderBy: { dueAt: "asc" },
        take: 20,
        include: { task: { select: { id: true, name: true } } },
      }),
    ]);
    return { count, items };
  }),

  recent: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db.notification.findMany({
      where: { userId: ctx.session.user.id },
      orderBy: { dispatchedAt: "desc" },
      take: 50,
      include: { task: { select: { id: true, name: true } } },
    });
  }),

  markRead: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const owned = await ctx.db.notification.findFirst({
        where: { id: input.id, userId: ctx.session.user.id },
        select: { id: true },
      });
      if (!owned) throw new TRPCError({ code: "NOT_FOUND" });
      return ctx.db.notification.update({ where: { id: input.id }, data: { readAt: new Date() } });
    }),

  markAllRead: protectedProcedure.mutation(async ({ ctx }) => {
    await ctx.db.notification.updateMany({
      where: { userId: ctx.session.user.id, readAt: null },
      data: { readAt: new Date() },
    });
    return { ok: true };
  }),

  getPreferences: protectedProcedure.query(async ({ ctx }) => {
    const row = await ctx.db.notificationPreference.findUnique({
      where: { userId: ctx.session.user.id },
    });
    return row ?? { userId: ctx.session.user.id, ...DEFAULT_PREFS };
  }),

  updatePreferences: protectedProcedure
    .input(UpdatePrefsInput)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      return ctx.db.notificationPreference.upsert({
        where: { userId },
        create: { userId, ...DEFAULT_PREFS, ...input },
        update: input,
      });
    }),

  /** Manual trigger — same path the worker runs every 5 minutes. */
  dispatchNow: protectedProcedure.mutation(async ({ ctx }) => {
    return dispatchForUser(ctx.db, ctx.session.user.id);
  }),
});
