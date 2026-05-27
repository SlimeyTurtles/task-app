import { CalibrationDimension, EventKind } from "@prisma/client";
import { z } from "zod";

import { protectedProcedure, router } from "../init";
import { startOfLocalDay, endOfLocalDay, addDays } from "@/lib/scheduling";

export const metricsRouter = router({
  /**
   * Time spent (in minutes, confidence-weighted) per area / project / tag
   * across the given date range. Background events are excluded.
   */
  breakdown: protectedProcedure
    .input(
      z.object({
        start: z.date(),
        end: z.date(),
        groupBy: z.enum(["area", "project", "tag"]).default("area"),
      }),
    )
    .query(async ({ ctx, input }) => {
      const events = await ctx.db.event.findMany({
        where: {
          userId: ctx.session.user.id,
          kind: EventKind.ACTIVE,
          AND: [{ startsAt: { lte: input.end } }, { endsAt: { gte: input.start } }],
        },
        select: {
          startsAt: true,
          endsAt: true,
          confidence: true,
          attributions: {
            select: {
              weight: true,
              task: {
                select: {
                  area: { select: { id: true, name: true, color: true } },
                  project: { select: { id: true, name: true } },
                  tags: { select: { tag: { select: { id: true, name: true, color: true } } } },
                },
              },
            },
          },
        },
      });

      type Bucket = { id: string; name: string; color: string | null; minutes: number };
      const buckets = new Map<string, Bucket>();
      const NO_GROUP_ID = "__none__";

      for (const e of events) {
        const lenMin = Math.max(
          0,
          (Math.min(e.endsAt.getTime(), input.end.getTime()) -
            Math.max(e.startsAt.getTime(), input.start.getTime())) /
            60_000,
        ) * e.confidence;
        if (lenMin <= 0) continue;
        const attrCount = Math.max(1, e.attributions.length);

        for (const a of e.attributions) {
          const portion = (lenMin * a.weight) / attrCount;
          if (input.groupBy === "tag") {
            if (a.task.tags.length === 0) bump(buckets, NO_GROUP_ID, "untagged", null, portion);
            for (const t of a.task.tags) {
              bump(buckets, t.tag.id, t.tag.name, t.tag.color, portion / a.task.tags.length);
            }
          } else if (input.groupBy === "project") {
            if (!a.task.project) bump(buckets, NO_GROUP_ID, "no project", null, portion);
            else bump(buckets, a.task.project.id, a.task.project.name, null, portion);
          } else {
            if (!a.task.area) bump(buckets, NO_GROUP_ID, "no area", null, portion);
            else bump(buckets, a.task.area.id, a.task.area.name, a.task.area.color, portion);
          }
        }
      }

      return Array.from(buckets.values()).sort((a, b) => b.minutes - a.minutes);
    }),

  /**
   * Daily totals for capacity trend: confidence-weighted stress, exhaustion,
   * and active minutes per day across the range.
   */
  capacityTrend: protectedProcedure
    .input(z.object({ start: z.date(), end: z.date() }))
    .query(async ({ ctx, input }) => {
      const events = await ctx.db.event.findMany({
        where: {
          userId: ctx.session.user.id,
          kind: EventKind.ACTIVE,
          AND: [{ startsAt: { lte: input.end } }, { endsAt: { gte: input.start } }],
        },
        select: {
          startsAt: true,
          endsAt: true,
          confidence: true,
          attributions: {
            select: {
              weight: true,
              task: { select: { stress: true, exhaustion: true } },
            },
          },
        },
      });

      const start = startOfLocalDay(input.start);
      const end = endOfLocalDay(input.end);
      const days = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / 86_400_000));

      const byDay = new Map<string, { dayKey: string; stress: number; exhaustion: number; minutes: number }>();
      for (let i = 0; i < days; i++) {
        const d = addDays(start, i);
        const key = d.toISOString().slice(0, 10);
        byDay.set(key, { dayKey: key, stress: 0, exhaustion: 0, minutes: 0 });
      }

      for (const e of events) {
        const dayStart = startOfLocalDay(e.startsAt);
        const key = dayStart.toISOString().slice(0, 10);
        const bucket = byDay.get(key);
        if (!bucket) continue;
        const lenMin =
          Math.max(0, (e.endsAt.getTime() - e.startsAt.getTime()) / 60_000) * e.confidence;
        bucket.minutes += lenMin;
        for (const a of e.attributions) {
          const w = a.weight * e.confidence;
          bucket.stress += (a.task.stress ?? 0) * w;
          bucket.exhaustion += (a.task.exhaustion ?? 0) * w;
        }
      }

      return Array.from(byDay.values());
    }),

  /**
   * Estimate-accuracy report. Reuses EstimateCalibration rows produced by the
   * nightly worker; doesn't recompute on read. Returns a friendly shape with
   * resolved segment names.
   */
  accuracy: protectedProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db.estimateCalibration.findMany({
      where: { userId: ctx.session.user.id },
      orderBy: [{ dimension: "asc" }, { confidence: "desc" }],
    });

    // Resolve segment labels (area / tag names) for display.
    const areaIds = new Set<string>();
    const tagIds = new Set<string>();
    for (const r of rows) {
      if (r.segment.startsWith("by_area:")) areaIds.add(r.segment.slice("by_area:".length));
      if (r.segment.startsWith("by_tag:")) tagIds.add(r.segment.slice("by_tag:".length));
    }
    const [areas, tags] = await Promise.all([
      ctx.db.area.findMany({ where: { id: { in: [...areaIds] } }, select: { id: true, name: true } }),
      ctx.db.tag.findMany({ where: { id: { in: [...tagIds] } }, select: { id: true, name: true } }),
    ]);
    const areaName = new Map(areas.map((a) => [a.id, a.name]));
    const tagName = new Map(tags.map((t) => [t.id, t.name]));

    return rows.map((r) => ({
      dimension: r.dimension as CalibrationDimension,
      segment: r.segment,
      segmentLabel: labelForSegment(r.segment, areaName, tagName),
      multiplier: r.multiplier,
      samples: r.samples,
      confidence: r.confidence,
      lastTrainedAt: r.lastTrainedAt,
    }));
  }),
});

function bump(
  map: Map<string, { id: string; name: string; color: string | null; minutes: number }>,
  id: string,
  name: string,
  color: string | null,
  minutes: number,
) {
  const cur = map.get(id);
  if (cur) cur.minutes += minutes;
  else map.set(id, { id, name, color, minutes });
}

function labelForSegment(
  segment: string,
  areaName: Map<string, string>,
  tagName: Map<string, string>,
): string {
  if (segment === "global") return "All tasks";
  if (segment.startsWith("by_area:")) {
    const id = segment.slice("by_area:".length);
    return `Area · ${areaName.get(id) ?? id.slice(0, 8)}`;
  }
  if (segment.startsWith("by_tag:")) {
    const id = segment.slice("by_tag:".length);
    return `Tag · ${tagName.get(id) ?? id.slice(0, 8)}`;
  }
  return segment;
}
