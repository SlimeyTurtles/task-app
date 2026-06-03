import type { PrismaClient } from "@prisma/client";

import type { FactDelta } from "./ai-infer-task";

/**
 * Write the AI's proposed factDeltas back into the user's Memory log.
 *
 * - "new"    → insert a Memory with status PENDING and the source label.
 * - "update" → insert a new Memory whose `supersedesId` points at the old,
 *              and mark the old one SUPERSEDED. New one starts PENDING.
 * - "stale"  → bump the referenced memory to STALE so retrieval
 *              de-prioritises it.
 *
 * All writes happen in a single transaction so a partial failure doesn't
 * leave an orphaned supersede chain. Verifies that referenced memory ids
 * actually belong to the same user before touching anything.
 */
export async function applyFactDeltas(
  db: PrismaClient,
  userId: string,
  deltas: FactDelta[],
  source: string,
): Promise<void> {
  if (deltas.length === 0) return;

  // Collect ids the AI wants to touch, verify ownership in one query.
  const referencedIds = deltas
    .filter((d) => d.kind !== "new")
    .map((d) => (d as { supersedesMemoryId: string }).supersedesMemoryId);

  const ownedIds = referencedIds.length
    ? new Set(
        (
          await db.memory.findMany({
            where: { userId, id: { in: referencedIds } },
            select: { id: true },
          })
        ).map((m) => m.id),
      )
    : new Set<string>();

  await db.$transaction(async (tx) => {
    for (const d of deltas) {
      if (d.kind === "new") {
        await tx.memory.create({
          data: { userId, content: d.content, status: "PENDING", source },
        });
      } else if (d.kind === "update") {
        if (!ownedIds.has(d.supersedesMemoryId)) continue;
        await tx.memory.update({
          where: { id: d.supersedesMemoryId },
          data: { status: "SUPERSEDED" },
        });
        await tx.memory.create({
          data: {
            userId,
            content: d.content,
            status: "PENDING",
            source,
            supersedesId: d.supersedesMemoryId,
          },
        });
      } else if (d.kind === "stale") {
        if (!ownedIds.has(d.supersedesMemoryId)) continue;
        await tx.memory.update({
          where: { id: d.supersedesMemoryId },
          data: { status: "STALE" },
        });
      }
    }
  });
}
