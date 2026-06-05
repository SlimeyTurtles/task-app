import { TRPCError } from "@trpc/server";
import { TimeBlockKind, type TimeBlock } from "@prisma/client";
import { z } from "zod";

import { protectedProcedure, router } from "../init";
import { addDays, startOfLocalDay } from "@/lib/scheduling";

const Range = z.object({ start: z.date(), end: z.date() });

// Minimal RRULE subset used by background blocks (full RRULE materializer is Phase 8).
const BYDAY_TO_DOW: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

function parseRule(rrule: string | null): { freq: "DAILY" | "WEEKLY"; byday?: number[] } | null {
  if (!rrule) return null;
  const parts = Object.fromEntries(
    rrule.split(";").map((p) => {
      const [k, v] = p.split("=");
      return [k.trim().toUpperCase(), (v ?? "").trim().toUpperCase()];
    }),
  );
  if (parts.FREQ === "DAILY") return { freq: "DAILY" };
  if (parts.FREQ === "WEEKLY") {
    const byday = parts.BYDAY
      ? parts.BYDAY.split(",").map((d) => BYDAY_TO_DOW[d]).filter((n) => n !== undefined)
      : undefined;
    return { freq: "WEEKLY", byday };
  }
  return null;
}

type Occurrence = Omit<TimeBlock, "createdAt" | "updatedAt"> & { baseId: string };

export function expandRecurring(block: TimeBlock, rangeStart: Date, rangeEnd: Date): Occurrence[] {
  const rule = parseRule(block.rrule);
  const durationMs = block.endsAt.getTime() - block.startsAt.getTime();
  const h = block.startsAt.getHours();
  const m = block.startsAt.getMinutes();
  const out: Occurrence[] = [];

  if (!rule) {
    if (block.startsAt <= rangeEnd && block.endsAt >= rangeStart) {
      out.push({ ...stripTimestamps(block), baseId: block.id });
    }
    return out;
  }

  const anchorDay = startOfLocalDay(block.startsAt);
  // Back the iteration up by the block's duration so an occurrence that STARTS
  // before the range but spills into it (e.g. sleep 10 PM Sun → 7 AM Mon) is
  // still generated when the range begins Monday.
  const DAY_MS = 86_400_000;
  const durationDays = Math.max(1, Math.ceil(durationMs / DAY_MS));
  let day = startOfLocalDay(
    new Date(
      Math.max(anchorDay.getTime(), startOfLocalDay(rangeStart).getTime() - durationDays * DAY_MS),
    ),
  );
  const lastDay = startOfLocalDay(rangeEnd);
  let guard = 0;
  while (day <= lastDay && guard++ < 800) {
    let match = false;
    if (rule.freq === "DAILY") match = true;
    else if (rule.byday?.length) match = rule.byday.includes(day.getDay());
    else match = day.getDay() === block.startsAt.getDay();

    if (match) {
      const occStart = new Date(day);
      occStart.setHours(h, m, 0, 0);
      const occEnd = new Date(occStart.getTime() + durationMs);
      if (occEnd >= rangeStart && occStart <= rangeEnd) {
        out.push({
          ...stripTimestamps(block),
          id: `${block.id}::${day.toISOString().slice(0, 10)}`,
          baseId: block.id,
          startsAt: occStart,
          endsAt: occEnd,
        });
      }
    }
    day = addDays(day, 1);
  }
  return out;
}

function stripTimestamps(b: TimeBlock): Omit<TimeBlock, "createdAt" | "updatedAt"> {
  const { createdAt: _c, updatedAt: _u, ...rest } = b;
  return rest;
}

const TimeBlockInput = z.object({
  startsAt: z.date(),
  endsAt: z.date(),
  kind: z.nativeEnum(TimeBlockKind).default(TimeBlockKind.CUSTOM),
  label: z.string().max(120).nullish(),
  rrule: z.string().max(2000).nullish(),
  schedulableOnTop: z.boolean().default(false),
});

export const timeBlocksRouter = router({
  /** Anchor rows only (used by Settings → Time blocks). Recurring blocks appear once. */
  list: protectedProcedure.input(Range).query(async ({ ctx, input }) => {
    return ctx.db.timeBlock.findMany({
      where: {
        userId: ctx.session.user.id,
        OR: [
          // one-off blocks intersecting the range
          {
            rrule: null,
            AND: [{ startsAt: { lte: input.end } }, { endsAt: { gte: input.start } }],
          },
          // recurring anchors that started on or before the range end
          { rrule: { not: null }, startsAt: { lte: input.end } },
        ],
      },
      orderBy: { startsAt: "asc" },
    });
  }),

  /** Expanded occurrences within the range (used by the calendar) — recurring blocks repeat. */
  occurrences: protectedProcedure.input(Range).query(async ({ ctx, input }) => {
    const blocks = await ctx.db.timeBlock.findMany({
      where: {
        userId: ctx.session.user.id,
        OR: [
          {
            rrule: null,
            AND: [{ startsAt: { lte: input.end } }, { endsAt: { gte: input.start } }],
          },
          { rrule: { not: null }, startsAt: { lte: input.end } },
        ],
      },
    });
    const out = blocks.flatMap((b) => expandRecurring(b, input.start, input.end));
    out.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
    return out;
  }),

  create: protectedProcedure.input(TimeBlockInput).mutation(async ({ ctx, input }) => {
    if (input.endsAt <= input.startsAt) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "End must be after start." });
    }
    return ctx.db.timeBlock.create({
      data: { ...input, userId: ctx.session.user.id },
    });
  }),

  update: protectedProcedure
    .input(TimeBlockInput.partial().extend({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      const owned = await ctx.db.timeBlock.findFirst({
        where: { id, userId: ctx.session.user.id },
        select: { id: true },
      });
      if (!owned) throw new TRPCError({ code: "NOT_FOUND" });
      return ctx.db.timeBlock.update({ where: { id }, data });
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const owned = await ctx.db.timeBlock.findFirst({
        where: { id: input.id, userId: ctx.session.user.id },
        select: { id: true },
      });
      if (!owned) throw new TRPCError({ code: "NOT_FOUND" });
      await ctx.db.timeBlock.delete({ where: { id: input.id } });
      return { ok: true };
    }),
});
