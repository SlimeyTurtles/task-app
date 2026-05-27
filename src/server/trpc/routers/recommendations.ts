import { TaskStatus, EventKind, CalibrationDimension } from "@prisma/client";
import { z } from "zod";

import { protectedProcedure, router } from "../init";
import {
  recommend,
  dayKey,
  type CapacityModel,
  type RecommendationTask,
  type RecoveryRule,
  type ScheduledLoad,
} from "@/lib/recommendation";
import { addDays, startOfLocalDay, endOfLocalDay } from "@/lib/scheduling";
import { resolveMultiplier, type CalibrationRow } from "@/lib/calibration";

const SUGGEST_HORIZON_DEFAULT = 14;

export const recommendationsRouter = router({
  /** Produce a suggested plan for the next `horizonDays`. Advisory; user accepts to commit. */
  suggest: protectedProcedure
    .input(
      z
        .object({
          horizonDays: z.number().int().min(1).max(60).default(SUGGEST_HORIZON_DEFAULT),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const horizonDays = input?.horizonDays ?? SUGGEST_HORIZON_DEFAULT;
      const now = startOfLocalDay(new Date());
      const rangeEnd = endOfLocalDay(addDays(now, horizonDays - 1));

      const [capacityRow, tasks, deps, events, calibrationRows] = await Promise.all([
        ctx.db.userCapacityModel.findUnique({ where: { userId } }),
        ctx.db.task.findMany({
          where: {
            userId,
            status: { in: [TaskStatus.INBOX, TaskStatus.SCHEDULED, TaskStatus.IN_PROGRESS, TaskStatus.DONE] },
          },
          select: {
            id: true,
            name: true,
            status: true,
            stress: true,
            exhaustion: true,
            urgency: true,
            importance: true,
            estimatedMinutes: true,
            dueDate: true,
            areaId: true,
            tags: { select: { tagId: true } },
          },
        }),
        ctx.db.taskDependency.findMany({
          where: { task: { userId } },
          select: { taskId: true, dependsOnTaskId: true },
        }),
        ctx.db.event.findMany({
          where: {
            userId,
            kind: EventKind.ACTIVE,
            AND: [{ startsAt: { lte: rangeEnd } }, { endsAt: { gte: now } }],
          },
          select: {
            startsAt: true,
            endsAt: true,
            confidence: true,
            attributions: {
              select: { weight: true, task: { select: { stress: true, exhaustion: true } } },
            },
          },
        }),
        ctx.db.estimateCalibration.findMany({ where: { userId } }),
      ]);

      const calibrations: CalibrationRow[] = calibrationRows.map((r) => ({
        dimension: r.dimension as CalibrationDimension,
        segment: r.segment,
        multiplier: r.multiplier,
        samples: r.samples,
        confidence: r.confidence,
      }));

      const capacity: CapacityModel = capacityRow
        ? {
            dailyStressBudget: capacityRow.dailyStressBudget,
            dailyExhaustionBudget: capacityRow.dailyExhaustionBudget,
            dailyFocusedHours: capacityRow.dailyFocusedHours,
            recoveryRules: parseRecoveryRules(capacityRow.recoveryRules),
          }
        : {
            dailyStressBudget: 50,
            dailyExhaustionBudget: 50,
            dailyFocusedHours: 5,
            recoveryRules: [],
          };

      // Build dep map.
      const depsByTask = new Map<string, string[]>();
      for (const d of deps) {
        const list = depsByTask.get(d.taskId) ?? [];
        list.push(d.dependsOnTaskId);
        depsByTask.set(d.taskId, list);
      }

      const taskById = new Map(tasks.map((t) => [t.id, t]));
      const recommendationBacklog: RecommendationTask[] = tasks.map((t) => {
        const ctxIds = { areaId: t.areaId, tagIds: t.tags.map((tg) => tg.tagId) };
        return {
          id: t.id,
          name: t.name,
          estimatedMinutes: t.estimatedMinutes,
          stress: t.stress,
          exhaustion: t.exhaustion,
          urgency: t.urgency,
          importance: t.importance,
          dueDate: t.dueDate,
          dependsOnTaskIds: depsByTask.get(t.id) ?? [],
          alreadyDone: t.status === TaskStatus.DONE,
          timeMultiplier: resolveMultiplier(calibrations, CalibrationDimension.TIME, ctxIds),
          stressMultiplier: resolveMultiplier(calibrations, CalibrationDimension.STRESS, ctxIds),
          exhaustionMultiplier: resolveMultiplier(calibrations, CalibrationDimension.EXHAUSTION, ctxIds),
        };
      });

      // Existing load per day, weighted by confidence.
      const existingLoad = new Map<string, ScheduledLoad>();
      for (const e of events) {
        const key = dayKey(e.startsAt);
        const cur =
          existingLoad.get(key) ??
          { dayKey: key, stress: 0, exhaustion: 0, minutes: 0, highExhaustionEnds: [] as Date[] };
        const lenMin = Math.max(0, (e.endsAt.getTime() - e.startsAt.getTime()) / 60_000) * e.confidence;
        cur.minutes += lenMin;
        for (const a of e.attributions) {
          const w = a.weight * e.confidence;
          cur.stress += (a.task.stress ?? 0) * w;
          cur.exhaustion += (a.task.exhaustion ?? 0) * w;
          if ((a.task.exhaustion ?? 0) >= 8) cur.highExhaustionEnds.push(e.endsAt);
        }
        existingLoad.set(key, cur);
      }

      const result = recommend({
        now,
        horizonDays,
        capacity,
        backlog: recommendationBacklog,
        existingLoad,
      });

      return {
        capacity,
        scheduled: result.scheduled.map((s) => ({
          ...s,
          task: taskById.get(s.taskId)!,
        })),
        skipped: result.skipped.map((s) => ({
          ...s,
          task: taskById.get(s.taskId)!,
        })),
      };
    }),

  /** Accept one or many suggestions — creates Events with single-task attribution. */
  accept: protectedProcedure
    .input(
      z.object({
        items: z.array(
          z.object({
            taskId: z.string(),
            startsAt: z.date(),
            endsAt: z.date(),
          }),
        ),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      if (input.items.length === 0) return { created: 0 };

      // Verify all tasks owned.
      const ids = [...new Set(input.items.map((i) => i.taskId))];
      const owned = await ctx.db.task.count({
        where: { id: { in: ids }, userId },
      });
      if (owned !== ids.length) {
        throw new Error("One or more tasks not found.");
      }

      const created = await ctx.db.$transaction(
        input.items.map((item) =>
          ctx.db.event.create({
            data: {
              userId,
              startsAt: item.startsAt,
              endsAt: item.endsAt,
              kind: EventKind.ACTIVE,
              source: "SUGGESTED",
              confidence: 1,
              attributions: { create: { taskId: item.taskId, weight: 1 } },
            },
          }),
        ),
      );

      // Mark accepted tasks as SCHEDULED if currently INBOX.
      await ctx.db.task.updateMany({
        where: { id: { in: ids }, userId, status: TaskStatus.INBOX },
        data: { status: TaskStatus.SCHEDULED },
      });

      return { created: created.length };
    }),
});

function parseRecoveryRules(raw: unknown): RecoveryRule[] {
  if (!Array.isArray(raw)) return [];
  const out: RecoveryRule[] = [];
  for (const r of raw) {
    if (
      r &&
      typeof r === "object" &&
      "kind" in r &&
      r.kind === "cooldown_after_exhaustion" &&
      "thresholdExhaustion" in r &&
      typeof r.thresholdExhaustion === "number" &&
      "cooldownHours" in r &&
      typeof r.cooldownHours === "number"
    ) {
      out.push({
        kind: "cooldown_after_exhaustion",
        thresholdExhaustion: r.thresholdExhaustion,
        cooldownHours: r.cooldownHours,
      });
    }
  }
  return out;
}
