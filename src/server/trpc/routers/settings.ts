import { z } from "zod";

import { protectedProcedure, router } from "../init";

const CalendarViewSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("rolling"),
    before: z.number().int().min(0).max(365),
    after: z.number().int().min(0).max(365),
  }),
  z.object({
    mode: z.literal("static"),
    start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    span: z.number().int().min(1).max(366),
  }),
]);

const CalendarSettingsSchema = z.object({
  view: CalendarViewSchema.optional(),
  hourHeight: z.number().int().min(16).max(240).optional(),
});

// "Find a spot" knobs — how the auto-scheduler picks slots when you
// quick-add an event or run an AI schedule on an inbox task.
const SchedulingSettingsSchema = z.object({
  /** First hour of day eligible for auto-scheduling, in the user's timezone. */
  workStartHour: z.number().int().min(0).max(23).optional(),
  /** Last hour of day eligible for auto-scheduling. Inclusive: 22 means up to 22:00. */
  workEndHour: z.number().int().min(1).max(24).optional(),
  /** Slot resolution; the scheduler steps by this many minutes. */
  slotStepMin: z.union([z.literal(5), z.literal(10), z.literal(15), z.literal(30), z.literal(60)]).optional(),
  /** When true, non-schedulableOnTop time blocks (sleep, work, focus, …) count as busy. */
  respectTimeBlocks: z.boolean().optional(),
  /** How far ahead to look for a free slot, in days. */
  horizonDays: z.number().int().min(1).max(60).optional(),
});

export const SCHEDULING_DEFAULTS = {
  workStartHour: 8,
  workEndHour: 22,
  slotStepMin: 15,
  respectTimeBlocks: true,
  horizonDays: 21,
} as const;

export type SchedulingSettings = Required<z.infer<typeof SchedulingSettingsSchema>>;

const SettingsSchema = z.object({
  calendar: CalendarSettingsSchema.optional(),
  scheduling: SchedulingSettingsSchema.optional(),
});

export type Settings = z.infer<typeof SettingsSchema>;

function parseSettings(raw: unknown): Settings {
  const r = SettingsSchema.safeParse(raw);
  return r.success ? r.data : {};
}

/** Effective scheduling settings for a user (saved values merged with defaults). */
export async function getSchedulingSettings(
  db: import("@prisma/client").PrismaClient,
  userId: string,
): Promise<SchedulingSettings> {
  const u = await db.user.findUnique({ where: { id: userId }, select: { settings: true } });
  const parsed = parseSettings(u?.settings);
  return { ...SCHEDULING_DEFAULTS, ...parsed.scheduling };
}

export const settingsRouter = router({
  get: protectedProcedure.query(async ({ ctx }) => {
    const user = await ctx.db.user.findUnique({
      where: { id: ctx.session.user.id },
      select: { settings: true },
    });
    return parseSettings(user?.settings);
  }),

  update: protectedProcedure
    .input(SettingsSchema.partial())
    .mutation(async ({ ctx, input }) => {
      const user = await ctx.db.user.findUnique({
        where: { id: ctx.session.user.id },
        select: { settings: true },
      });
      const current = parseSettings(user?.settings);
      const merged: Settings = {
        ...current,
        ...input,
        calendar: { ...current.calendar, ...input.calendar },
      };
      await ctx.db.user.update({
        where: { id: ctx.session.user.id },
        data: { settings: merged },
      });
      return merged;
    }),
});
