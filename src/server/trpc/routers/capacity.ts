import { z } from "zod";

import { protectedProcedure, router } from "../init";

const RecoveryRule = z.object({
  kind: z.literal("cooldown_after_exhaustion"),
  thresholdExhaustion: z.number().int().min(0).max(10),
  cooldownHours: z.number().int().min(1).max(72),
});

const CapacityInput = z.object({
  dailyStressBudget: z.number().min(0).max(500),
  dailyExhaustionBudget: z.number().min(0).max(500),
  dailyFocusedHours: z.number().min(0).max(24),
  recoveryRules: z.array(RecoveryRule),
});

export const capacityRouter = router({
  get: protectedProcedure.query(async ({ ctx }) => {
    const existing = await ctx.db.userCapacityModel.findUnique({
      where: { userId: ctx.session.user.id },
    });
    if (existing) return existing;
    // Defensive: seed defaults for legacy users.
    return ctx.db.userCapacityModel.create({
      data: { userId: ctx.session.user.id },
    });
  }),

  update: protectedProcedure.input(CapacityInput).mutation(async ({ ctx, input }) => {
    return ctx.db.userCapacityModel.upsert({
      where: { userId: ctx.session.user.id },
      create: { userId: ctx.session.user.id, ...input },
      update: input,
    });
  }),
});
