import { TRPCError } from "@trpc/server";
import { SharePermission } from "@prisma/client";
import { z } from "zod";

import { protectedProcedure, router } from "../init";
import { getTaskAccess, getTagAccess } from "@/server/lib/access";

const PermissionInput = z.nativeEnum(SharePermission).default(SharePermission.READ);

export const sharingRouter = router({
  shareTask: protectedProcedure
    .input(
      z.object({
        taskId: z.string(),
        email: z.email().trim().toLowerCase(),
        permission: PermissionInput,
        expiresAt: z.date().nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const owned = await ctx.db.task.findFirst({
        where: { id: input.taskId, userId: ctx.session.user.id },
        select: { id: true },
      });
      if (!owned) throw new TRPCError({ code: "NOT_FOUND", message: "Task not found." });

      const target = await resolveGrantee(ctx, input.email);

      return ctx.db.taskShare.upsert({
        where: { taskId_sharedWithUserId: { taskId: input.taskId, sharedWithUserId: target.id } },
        create: {
          taskId: input.taskId,
          ownerUserId: ctx.session.user.id,
          sharedWithUserId: target.id,
          permission: input.permission,
          expiresAt: input.expiresAt ?? null,
        },
        update: { permission: input.permission, expiresAt: input.expiresAt ?? null },
      });
    }),

  shareTag: protectedProcedure
    .input(
      z.object({
        tagId: z.string(),
        email: z.email().trim().toLowerCase(),
        permission: PermissionInput,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const owned = await ctx.db.tag.findFirst({
        where: { id: input.tagId, userId: ctx.session.user.id },
        select: { id: true },
      });
      if (!owned) throw new TRPCError({ code: "NOT_FOUND", message: "Tag not found." });

      const target = await resolveGrantee(ctx, input.email);

      return ctx.db.tagShare.upsert({
        where: { tagId_sharedWithUserId: { tagId: input.tagId, sharedWithUserId: target.id } },
        create: {
          tagId: input.tagId,
          ownerUserId: ctx.session.user.id,
          sharedWithUserId: target.id,
          permission: input.permission,
        },
        update: { permission: input.permission },
      });
    }),

  revokeTaskShare: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const share = await ctx.db.taskShare.findUnique({
        where: { id: input.id },
        select: { ownerUserId: true },
      });
      if (!share || share.ownerUserId !== ctx.session.user.id) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      await ctx.db.taskShare.delete({ where: { id: input.id } });
      return { ok: true };
    }),

  revokeTagShare: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const share = await ctx.db.tagShare.findUnique({
        where: { id: input.id },
        select: { ownerUserId: true },
      });
      if (!share || share.ownerUserId !== ctx.session.user.id) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      await ctx.db.tagShare.delete({ where: { id: input.id } });
      return { ok: true };
    }),

  /** Outbound: shares I've granted to others (Settings → Sharing). */
  listOutbound: protectedProcedure.query(async ({ ctx }) => {
    const [taskShares, tagShares] = await Promise.all([
      ctx.db.taskShare.findMany({
        where: { ownerUserId: ctx.session.user.id },
        include: {
          task: { select: { id: true, name: true } },
          sharedWith: { select: { id: true, email: true, name: true } },
        },
        orderBy: { createdAt: "desc" },
      }),
      ctx.db.tagShare.findMany({
        where: { ownerUserId: ctx.session.user.id },
        include: {
          tag: { select: { id: true, name: true } },
          sharedWith: { select: { id: true, email: true, name: true } },
        },
        orderBy: { createdAt: "desc" },
      }),
    ]);
    return { taskShares, tagShares };
  }),

  /** Inbound: who shared what with me, with owner info (Shared with me). */
  listInbound: protectedProcedure.query(async ({ ctx }) => {
    const [taskShares, tagShares] = await Promise.all([
      ctx.db.taskShare.findMany({
        where: { sharedWithUserId: ctx.session.user.id },
        include: {
          task: { select: { id: true, name: true } },
          owner: { select: { id: true, email: true, name: true } },
        },
        orderBy: { createdAt: "desc" },
      }),
      ctx.db.tagShare.findMany({
        where: { sharedWithUserId: ctx.session.user.id },
        include: {
          tag: { select: { id: true, name: true } },
          owner: { select: { id: true, email: true, name: true } },
        },
        orderBy: { createdAt: "desc" },
      }),
    ]);
    return { taskShares, tagShares };
  }),

  /**
   * The actual tasks accessible to me via shares (direct + via tag), each
   * annotated with the resolved permission and owner. This is what the
   * "Shared with me" task list renders.
   */
  sharedTasks: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    const [directShares, tagShares] = await Promise.all([
      ctx.db.taskShare.findMany({
        where: { sharedWithUserId: userId },
        select: { taskId: true, permission: true, expiresAt: true },
      }),
      ctx.db.tagShare.findMany({
        where: { sharedWithUserId: userId },
        select: { tagId: true, permission: true },
      }),
    ]);

    const now = Date.now();
    // taskId → best permission
    const perm = new Map<string, SharePermission>();
    const upgrade = (taskId: string, p: SharePermission) => {
      const cur = perm.get(taskId);
      if (cur === SharePermission.WRITE) return;
      if (!cur || p === SharePermission.WRITE) perm.set(taskId, p);
    };

    for (const s of directShares) {
      if (s.expiresAt && s.expiresAt.getTime() <= now) continue;
      upgrade(s.taskId, s.permission);
    }

    if (tagShares.length > 0) {
      const tagged = await ctx.db.taskTag.findMany({
        where: { tagId: { in: tagShares.map((t) => t.tagId) } },
        select: { taskId: true, tagId: true },
      });
      const tagPerm = new Map(tagShares.map((t) => [t.tagId, t.permission]));
      for (const tt of tagged) {
        const p = tagPerm.get(tt.tagId);
        if (p) upgrade(tt.taskId, p);
      }
    }

    const taskIds = [...perm.keys()];
    if (taskIds.length === 0) return [];

    const tasks = await ctx.db.task.findMany({
      where: { id: { in: taskIds } },
      include: {
        user: { select: { id: true, email: true, name: true } },
        area: { select: { id: true, name: true, color: true } },
        project: { select: { id: true, name: true } },
        tags: { include: { tag: { select: { id: true, name: true, color: true } } } },
        _count: { select: { subtasks: true, outgoingDeps: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    return tasks.map((t) => ({
      ...t,
      sharePermission: perm.get(t.id)!,
    }));
  }),
});

async function resolveGrantee(
  ctx: { db: import("@prisma/client").PrismaClient; session: { user: { id: string } } },
  email: string,
) {
  const target = await ctx.db.user.findUnique({
    where: { email },
    select: { id: true, email: true },
  });
  if (!target) {
    throw new TRPCError({ code: "NOT_FOUND", message: "No user with that email." });
  }
  if (target.id === ctx.session.user.id) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "You can't share with yourself." });
  }
  return target;
}
