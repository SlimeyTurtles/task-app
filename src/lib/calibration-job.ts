/**
 * Side-effecting calibration runner — called by the BullMQ worker (Phase 5)
 * and by the manual recalibrate tRPC procedure. Pulls every user's
 * completions, recomputes per-segment multipliers, and writes them back
 * to EstimateCalibration via upsert.
 */

import { CalibrationDimension, type PrismaClient } from "@prisma/client";

import { computeCalibrationRows, type CompletionSample } from "@/lib/calibration";

const DIMENSIONS: CalibrationDimension[] = [
  CalibrationDimension.TIME,
  CalibrationDimension.STRESS,
  CalibrationDimension.EXHAUSTION,
];

export async function recalibrateUser(db: PrismaClient, userId: string): Promise<{ rowsWritten: number }> {
  const completions = await db.taskCompletion.findMany({
    where: { userId },
    include: {
      task: {
        select: {
          areaId: true,
          estimatedMinutes: true,
          stress: true,
          exhaustion: true,
          tags: { select: { tagId: true } },
        },
      },
    },
  });

  let rowsWritten = 0;
  const now = new Date();

  for (const dimension of DIMENSIONS) {
    const samples: CompletionSample[] = completions.map((c) => {
      const estimate = pickEstimate(dimension, c.task);
      const actual = pickActual(dimension, c);
      return {
        taskId: c.taskId,
        areaId: c.task.areaId,
        tagIds: c.task.tags.map((t) => t.tagId),
        estimate,
        actual,
      };
    });

    const rows = computeCalibrationRows(samples, dimension);
    for (const row of rows) {
      await db.estimateCalibration.upsert({
        where: { userId_dimension_segment: { userId, dimension, segment: row.segment } },
        create: {
          userId,
          dimension,
          segment: row.segment,
          multiplier: row.multiplier,
          samples: row.samples,
          confidence: row.confidence,
          lastTrainedAt: now,
        },
        update: {
          multiplier: row.multiplier,
          samples: row.samples,
          confidence: row.confidence,
          lastTrainedAt: now,
        },
      });
      rowsWritten++;
    }
  }

  await db.userCapacityModel.update({
    where: { userId },
    data: { lastTrainedAt: now },
  }).catch(() => {
    // capacity row may not exist for a brand-new user — ignore.
  });

  return { rowsWritten };
}

export async function recalibrateAll(db: PrismaClient): Promise<{ users: number; rowsWritten: number }> {
  const userIds = await db.user.findMany({ select: { id: true } });
  let total = 0;
  for (const { id } of userIds) {
    const { rowsWritten } = await recalibrateUser(db, id);
    total += rowsWritten;
  }
  return { users: userIds.length, rowsWritten: total };
}

function pickEstimate(
  dim: CalibrationDimension,
  task: { estimatedMinutes: number | null; stress: number | null; exhaustion: number | null },
): number | null {
  switch (dim) {
    case CalibrationDimension.TIME:
      return task.estimatedMinutes ?? null;
    case CalibrationDimension.STRESS:
      return task.stress ?? null;
    case CalibrationDimension.EXHAUSTION:
      return task.exhaustion ?? null;
  }
}

function pickActual(
  dim: CalibrationDimension,
  completion: { actualMinutes: number | null; actualStress: number | null; actualExhaustion: number | null },
): number | null {
  switch (dim) {
    case CalibrationDimension.TIME:
      return completion.actualMinutes ?? null;
    case CalibrationDimension.STRESS:
      return completion.actualStress ?? null;
    case CalibrationDimension.EXHAUSTION:
      return completion.actualExhaustion ?? null;
  }
}
