/**
 * Per-user estimate calibration.
 *
 * The Task App's task metrics (stress, exhaustion, estimated_minutes) are
 * self-reported and biased. After every completion, we observe the *actual*
 * vs the *estimated* and learn a multiplier that scales future estimates
 * up or down — globally, by area, and by tag.
 *
 * Algorithm (Phase 5 v1): weighted average around a unit prior, so a few
 * extreme samples don't yank the multiplier off the rails.
 *
 *     multiplier = (prior_weight + Σ ratio_i) / (prior_weight + n)
 *     confidence = n / (n + prior_weight)
 *
 * `prior_weight` defaults to 5 (≈ "after 5 samples the prior has half-faded").
 * Multipliers are clamped to [0.25, 4.0] so a malformed estimate can't
 * destabilise the planner.
 */

import { CalibrationDimension } from "@prisma/client";

export const PRIOR_WEIGHT = 5;
export const MULTIPLIER_MIN = 0.25;
export const MULTIPLIER_MAX = 4.0;

export type CompletionSample = {
  taskId: string;
  /** Foreign keys on the completion's task — used to assign segments. */
  areaId: string | null;
  tagIds: string[];
  estimate: number | null;
  actual: number | null;
};

export type CalibrationRow = {
  dimension: CalibrationDimension;
  segment: string; // "global" | `by_area:${id}` | `by_tag:${id}`
  multiplier: number;
  samples: number;
  confidence: number;
};

export function computeMultiplier(ratios: number[]): { multiplier: number; samples: number; confidence: number } {
  const samples = ratios.length;
  if (samples === 0) {
    return { multiplier: 1, samples: 0, confidence: 0 };
  }
  const sum = ratios.reduce((a, r) => a + r, 0);
  const raw = (PRIOR_WEIGHT + sum) / (PRIOR_WEIGHT + samples);
  const multiplier = Math.min(MULTIPLIER_MAX, Math.max(MULTIPLIER_MIN, raw));
  const confidence = samples / (samples + PRIOR_WEIGHT);
  return { multiplier, samples, confidence };
}

export function computeCalibrationRows(
  samples: CompletionSample[],
  dimension: CalibrationDimension,
): CalibrationRow[] {
  const validRatios = samples
    .filter((s) => s.estimate != null && s.estimate > 0 && s.actual != null && s.actual >= 0)
    .map((s) => ({ ratio: s.actual! / s.estimate!, sample: s }));

  const rows: CalibrationRow[] = [];

  // Global.
  const globalStat = computeMultiplier(validRatios.map((v) => v.ratio));
  rows.push({ dimension, segment: "global", ...globalStat });

  // Per area.
  const byArea = new Map<string, number[]>();
  for (const { ratio, sample } of validRatios) {
    if (!sample.areaId) continue;
    const list = byArea.get(sample.areaId) ?? [];
    list.push(ratio);
    byArea.set(sample.areaId, list);
  }
  for (const [areaId, ratios] of byArea) {
    const stat = computeMultiplier(ratios);
    if (stat.samples === 0) continue;
    rows.push({ dimension, segment: `by_area:${areaId}`, ...stat });
  }

  // Per tag.
  const byTag = new Map<string, number[]>();
  for (const { ratio, sample } of validRatios) {
    for (const tagId of sample.tagIds) {
      const list = byTag.get(tagId) ?? [];
      list.push(ratio);
      byTag.set(tagId, list);
    }
  }
  for (const [tagId, ratios] of byTag) {
    const stat = computeMultiplier(ratios);
    if (stat.samples === 0) continue;
    rows.push({ dimension, segment: `by_tag:${tagId}`, ...stat });
  }

  return rows;
}

/**
 * Resolve the most specific (highest-confidence) multiplier for a given task.
 * Used by the recommendation engine to scale raw estimates.
 *
 * Lookup order:
 *  1. by_tag (most specific) — if multiple tags, pick the highest-confidence one
 *  2. by_area
 *  3. global
 */
export function resolveMultiplier(
  calibrations: CalibrationRow[],
  dimension: CalibrationDimension,
  ctx: { areaId: string | null; tagIds: string[] },
): number {
  // Tag-segment best (most specific).
  let tagMult = 1;
  let tagConf = 0;
  for (const tagId of ctx.tagIds) {
    const row = calibrations.find(
      (r) => r.dimension === dimension && r.segment === `by_tag:${tagId}`,
    );
    if (row && row.confidence > tagConf) {
      tagConf = row.confidence;
      tagMult = row.multiplier;
    }
  }
  if (tagConf >= 0.5) return tagMult;

  if (ctx.areaId) {
    const row = calibrations.find(
      (r) => r.dimension === dimension && r.segment === `by_area:${ctx.areaId}`,
    );
    if (row && row.confidence >= 0.3) return row.multiplier;
  }

  const global = calibrations.find((r) => r.dimension === dimension && r.segment === "global");
  if (global) return global.multiplier;

  // Fall back to whatever tag info we collected, even if low-confidence.
  return tagConf > 0 ? tagMult : 1;
}
