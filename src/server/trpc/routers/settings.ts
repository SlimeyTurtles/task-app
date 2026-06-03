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

const SettingsSchema = z.object({
  calendar: CalendarSettingsSchema.optional(),
});

export type Settings = z.infer<typeof SettingsSchema>;

function parseSettings(raw: unknown): Settings {
  const r = SettingsSchema.safeParse(raw);
  return r.success ? r.data : {};
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
