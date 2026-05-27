/**
 * Recommendation engine — given a user's capacity model, existing schedule,
 * and backlog, produce a suggested plan that honors:
 *   - dependencies (a task waits until its blockers are done or earlier-scheduled)
 *   - per-day stress / exhaustion / focused-hours budgets
 *   - recovery rules (e.g. cooldown after high-exhaustion tasks)
 *   - due dates (no proposal lands after the task's due date)
 *
 * Output is a list of proposals each with a human-readable `reason`. The
 * UI surfaces them as advisory — the user always gets the last word.
 */

import { addDays, startOfLocalDay } from "@/lib/scheduling";

export type RecoveryRule = {
  kind: "cooldown_after_exhaustion";
  thresholdExhaustion: number; // 0-10; tasks with exhaustion >= this trigger the cooldown
  cooldownHours: number; // hours of cool-down after such a task
};

export type CapacityModel = {
  dailyStressBudget: number;
  dailyExhaustionBudget: number;
  dailyFocusedHours: number;
  recoveryRules: RecoveryRule[];
};

export type RecommendationTask = {
  id: string;
  name: string;
  estimatedMinutes: number | null;
  stress: number | null;
  exhaustion: number | null;
  urgency: number | null;
  importance: number | null;
  dueDate: Date | null;
  /** IDs of tasks that block this one (must be done first). */
  dependsOnTaskIds: string[];
  /** If already scheduled (status = SCHEDULED), the proposed time is honored. */
  alreadyDone: boolean;
};

export type ScheduledLoad = {
  /** date as YYYY-MM-DD in local time */
  dayKey: string;
  stress: number;
  exhaustion: number;
  minutes: number;
  /** Earliest "high-exhaustion finish" timestamp on or near this day (for cooldown). */
  highExhaustionEnds: Date[];
};

export type Suggestion = {
  taskId: string;
  day: Date; // local midnight of the proposed day
  startsAt: Date;
  endsAt: Date;
  reason: string;
};

export type SkippedSuggestion = {
  taskId: string;
  reason: string;
};

export type RecommendationResult = {
  scheduled: Suggestion[];
  skipped: SkippedSuggestion[];
};

export function dayKey(d: Date): string {
  return startOfLocalDay(d).toISOString().slice(0, 10);
}

/** Score for ranking: higher = scheduled earlier. */
function score(t: RecommendationTask, now: Date): number {
  const urgency = t.urgency ?? 5;
  const importance = t.importance ?? 5;
  let dueBoost = 0;
  if (t.dueDate) {
    const daysOut = Math.max(
      0,
      (t.dueDate.getTime() - now.getTime()) / 86_400_000,
    );
    // Closer due date → bigger boost. At 0 days = +10, at 14 days = +0.
    dueBoost = Math.max(0, 10 - daysOut);
  }
  return urgency + importance * 0.8 + dueBoost;
}

export function recommend(input: {
  now: Date;
  horizonDays: number;
  capacity: CapacityModel;
  backlog: RecommendationTask[];
  /** Existing load per day from events the user already scheduled. */
  existingLoad: Map<string, ScheduledLoad>;
  /** Working window per day in 24h local time, default 9..17. */
  workingHours?: { startHour: number; endHour: number };
}): RecommendationResult {
  const workingHours = input.workingHours ?? { startHour: 9, endHour: 17 };
  const horizonDays = Math.max(1, Math.min(60, input.horizonDays));

  // Build a per-day load map for the horizon, seeded with existingLoad.
  const load = new Map<string, ScheduledLoad>();
  for (let i = 0; i < horizonDays; i++) {
    const d = addDays(startOfLocalDay(input.now), i);
    const key = dayKey(d);
    const existing = input.existingLoad.get(key);
    load.set(key, {
      dayKey: key,
      stress: existing?.stress ?? 0,
      exhaustion: existing?.exhaustion ?? 0,
      minutes: existing?.minutes ?? 0,
      highExhaustionEnds: existing?.highExhaustionEnds?.slice() ?? [],
    });
  }
  // Capture the rolling "next free time" per day so consecutive proposals
  // on the same day get back-to-back start times.
  const dayCursor = new Map<string, Date>();
  function cursorFor(d: Date): Date {
    const key = dayKey(d);
    const existing = dayCursor.get(key);
    if (existing) return existing;
    const start = startOfLocalDay(d);
    start.setHours(workingHours.startHour, 0, 0, 0);
    return start;
  }

  const doneIds = new Set(input.backlog.filter((t) => t.alreadyDone).map((t) => t.id));
  // Track the day each task is proposed on (for dep-ordering check).
  const proposedDay = new Map<string, Date>();

  const candidates = input.backlog
    .filter((t) => !t.alreadyDone)
    .sort((a, b) => score(b, input.now) - score(a, input.now));

  const scheduled: Suggestion[] = [];
  const skipped: SkippedSuggestion[] = [];

  for (const t of candidates) {
    if (!t.estimatedMinutes || t.estimatedMinutes <= 0) {
      skipped.push({ taskId: t.id, reason: "No time estimate." });
      continue;
    }

    let placed: Suggestion | null = null;
    let lastReason = "No slot fits within the horizon.";

    for (let i = 0; i < horizonDays; i++) {
      const d = addDays(startOfLocalDay(input.now), i);
      const key = dayKey(d);
      const dayLoad = load.get(key)!;

      // Due date check.
      if (t.dueDate && startOfLocalDay(t.dueDate) < d) {
        lastReason = `Due ${t.dueDate.toLocaleDateString()} is in the past for the horizon.`;
        break;
      }

      // Dependency check.
      const depsOk = t.dependsOnTaskIds.every((dep) => {
        if (doneIds.has(dep)) return true;
        const depDay = proposedDay.get(dep);
        return depDay !== undefined && depDay <= d;
      });
      if (!depsOk) {
        lastReason = "Blocked by an unscheduled dependency.";
        continue;
      }

      // Budget check.
      const stressNeeded = t.stress ?? 0;
      const exhaustionNeeded = t.exhaustion ?? 0;
      if (dayLoad.stress + stressNeeded > input.capacity.dailyStressBudget) {
        lastReason = `Day exceeds stress budget (${input.capacity.dailyStressBudget}).`;
        continue;
      }
      if (dayLoad.exhaustion + exhaustionNeeded > input.capacity.dailyExhaustionBudget) {
        lastReason = `Day exceeds exhaustion budget (${input.capacity.dailyExhaustionBudget}).`;
        continue;
      }
      const focusedMinutesBudget = input.capacity.dailyFocusedHours * 60;
      if (dayLoad.minutes + t.estimatedMinutes > focusedMinutesBudget) {
        lastReason = `Day exceeds focused-hours budget (${input.capacity.dailyFocusedHours}h).`;
        continue;
      }

      // Recovery rules: if there's a recent high-exhaustion finish whose
      // cooldown overlaps the start cursor for this day, push it forward.
      let candidateStart = new Date(cursorFor(d));
      for (const rule of input.capacity.recoveryRules) {
        if (rule.kind !== "cooldown_after_exhaustion") continue;
        for (const finish of dayLoad.highExhaustionEnds) {
          const cooldownEnd = new Date(finish.getTime() + rule.cooldownHours * 3_600_000);
          if (candidateStart < cooldownEnd) candidateStart = cooldownEnd;
        }
      }
      const dayEnd = startOfLocalDay(d);
      dayEnd.setHours(workingHours.endHour, 0, 0, 0);
      const candidateEnd = new Date(candidateStart.getTime() + t.estimatedMinutes * 60_000);
      if (candidateEnd > dayEnd) {
        lastReason = "No work-hours slot left after cooldown / existing load.";
        continue;
      }

      // Place.
      dayLoad.stress += stressNeeded;
      dayLoad.exhaustion += exhaustionNeeded;
      dayLoad.minutes += t.estimatedMinutes;
      if (exhaustionNeeded >= 8) dayLoad.highExhaustionEnds.push(candidateEnd);
      dayCursor.set(key, candidateEnd);
      proposedDay.set(t.id, d);

      const reasonBits: string[] = [];
      reasonBits.push(`urgency ${t.urgency ?? "—"}/imp ${t.importance ?? "—"}`);
      if (t.dueDate) reasonBits.push(`due ${t.dueDate.toLocaleDateString()}`);
      reasonBits.push(`${t.estimatedMinutes}m, stress ${t.stress ?? 0}, exh ${t.exhaustion ?? 0}`);
      reasonBits.push(`fits day stress ${dayLoad.stress}/${input.capacity.dailyStressBudget}, exh ${dayLoad.exhaustion}/${input.capacity.dailyExhaustionBudget}`);

      placed = {
        taskId: t.id,
        day: d,
        startsAt: candidateStart,
        endsAt: candidateEnd,
        reason: reasonBits.join(" · "),
      };
      break;
    }

    if (placed) {
      scheduled.push(placed);
    } else {
      skipped.push({ taskId: t.id, reason: lastReason });
    }
  }

  return { scheduled, skipped };
}
