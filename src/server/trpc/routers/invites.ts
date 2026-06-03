import { randomBytes } from "crypto";

import { TRPCError } from "@trpc/server";
import { UserRole } from "@prisma/client";
import { z } from "zod";

import { protectedProcedure, router } from "../init";
import { sendInviteEmail } from "@/server/lib/email";

/**
 * Per-person invite tokens. Only admins can issue / revoke. Anyone can
 * validate a code at signup time (no login required for that — exposed
 * via `validatePublic` in the auth action, not through this router).
 */

// 10-char alphanumeric — short enough to type, big enough to not guess
// (62^10 ≈ 8e17 entropy, way past brute-force).
function generateCode(): string {
  const alphabet = "ABCDEFGHIJKLMNPQRSTUVWXYZ23456789"; // skip 0/O/1/I/L for readability
  const bytes = randomBytes(10);
  let out = "";
  for (let i = 0; i < 10; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

const adminProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  const me = await ctx.db.user.findUnique({
    where: { id: ctx.session.user.id },
    select: { role: true },
  });
  if (me?.role !== UserRole.ADMIN) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Admin only." });
  }
  return next();
});

export const invitesRouter = router({
  list: adminProcedure.query(async ({ ctx }) => {
    return ctx.db.invite.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        usedBy: { select: { id: true, email: true, name: true } },
      },
    });
  }),

  create: adminProcedure
    .input(
      z.object({
        email: z.email().trim().toLowerCase().nullish(),
        note: z.string().trim().max(200).nullish(),
        expiresInDays: z.number().int().min(1).max(365).nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const expiresAt = input.expiresInDays
        ? new Date(Date.now() + input.expiresInDays * 86_400_000)
        : null;
      return ctx.db.invite.create({
        data: {
          code: generateCode(),
          email: input.email ?? null,
          note: input.note ?? null,
          expiresAt,
          createdById: ctx.session.user.id,
        },
      });
    }),

  /**
   * Revoke an unused invite. Used invites can't be revoked — the account
   * they created is real now; revoke the account instead.
   */
  revoke: adminProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const invite = await ctx.db.invite.findUnique({ where: { id: input.id } });
      if (!invite) throw new TRPCError({ code: "NOT_FOUND" });
      if (invite.usedAt) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This invite has been claimed already.",
        });
      }
      await ctx.db.invite.delete({ where: { id: input.id } });
      return { ok: true };
    }),

  /**
   * Email the invite link to a recipient. Accepts an optional `to` to
   * override the address on the invite (e.g. when the invite isn't
   * email-locked and the admin wants to send it now).
   */
  sendEmail: adminProcedure
    .input(
      z.object({
        id: z.string(),
        to: z.email().trim().toLowerCase().nullish(),
        // Public origin to build the signup URL with. The router doesn't
        // know its own hostname (server-side fetches don't carry one),
        // so the client passes it.
        origin: z.string().url(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const invite = await ctx.db.invite.findUnique({
        where: { id: input.id },
        include: { createdBy: { select: { name: true } } },
      });
      if (!invite) throw new TRPCError({ code: "NOT_FOUND" });
      if (invite.usedAt) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Already claimed." });
      }
      if (invite.expiresAt && invite.expiresAt < new Date()) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Invite is expired." });
      }

      const to = input.to ?? invite.email;
      if (!to) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No recipient — set an email on the invite or pass one when sending.",
        });
      }
      // If the invite is locked to a specific email, can't send to anyone else.
      if (invite.email && input.to && invite.email !== input.to) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This invite is locked to a different email.",
        });
      }

      const url = `${input.origin.replace(/\/$/, "")}/register?invite=${invite.code}`;
      const result = await sendInviteEmail({
        to,
        invitedByName: invite.createdBy.name,
        code: invite.code,
        url,
        note: invite.note,
      });
      if (!result.ok) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: result.error });
      }
      return { ok: true as const, to };
    }),
});
