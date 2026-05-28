/**
 * The single cross-user permission boundary for the Task App.
 *
 * Design doc §13 ("Sharing leakage") mandates: every query that could touch
 * another user's data funnels through this helper, and we never join across
 * users without an explicit share row. Keep all share-resolution logic here
 * so it can be reviewed and tested in one place.
 *
 * Access levels, most → least privileged: owner > write > read > (null = no access).
 *
 * Tag sharing is EXACT-match in v1: sharing tag "Pets" grants access to tasks
 * tagged exactly "Pets", not its descendant tags. Descendant expansion is a
 * deliberate later-phase decision — keeping the boundary literal makes leakage
 * auditable.
 */

import { SharePermission, type PrismaClient, type Prisma } from "@prisma/client";

export type AccessLevel = "owner" | "write" | "read";

const RANK: Record<AccessLevel, number> = { read: 1, write: 2, owner: 3 };

function higher(a: AccessLevel | null, b: AccessLevel | null): AccessLevel | null {
  if (a === null) return b;
  if (b === null) return a;
  return RANK[a] >= RANK[b] ? a : b;
}

function permissionToLevel(p: SharePermission): AccessLevel {
  return p === SharePermission.WRITE ? "write" : "read";
}

function isExpired(expiresAt: Date | null): boolean {
  return expiresAt != null && expiresAt.getTime() <= Date.now();
}

type DbLike = PrismaClient | Prisma.TransactionClient;

/** Resolve the caller's access level to a single task, or null if none. */
export async function getTaskAccess(
  db: DbLike,
  userId: string,
  taskId: string,
): Promise<AccessLevel | null> {
  const task = await db.task.findUnique({
    where: { id: taskId },
    select: { userId: true, tags: { select: { tagId: true } } },
  });
  if (!task) return null;
  if (task.userId === userId) return "owner";

  let level: AccessLevel | null = null;

  const taskShare = await db.taskShare.findUnique({
    where: { taskId_sharedWithUserId: { taskId, sharedWithUserId: userId } },
    select: { permission: true, expiresAt: true },
  });
  if (taskShare && !isExpired(taskShare.expiresAt)) {
    level = higher(level, permissionToLevel(taskShare.permission));
  }

  // Tag share grants access to tasks carrying that exact tag.
  if (level !== "write" && task.tags.length > 0) {
    const tagShare = await db.tagShare.findFirst({
      where: {
        tagId: { in: task.tags.map((t) => t.tagId) },
        sharedWithUserId: userId,
      },
      select: { permission: true },
    });
    if (tagShare) level = higher(level, permissionToLevel(tagShare.permission));
  }

  return level;
}

/** Resolve the caller's access level to a tag, or null if none. */
export async function getTagAccess(
  db: DbLike,
  userId: string,
  tagId: string,
): Promise<AccessLevel | null> {
  const tag = await db.tag.findUnique({
    where: { id: tagId },
    select: { userId: true },
  });
  if (!tag) return null;
  if (tag.userId === userId) return "owner";

  const tagShare = await db.tagShare.findUnique({
    where: { tagId_sharedWithUserId: { tagId, sharedWithUserId: userId } },
    select: { permission: true },
  });
  if (tagShare) return permissionToLevel(tagShare.permission);
  return null;
}

export function canRead(level: AccessLevel | null): boolean {
  return level !== null;
}
export function canWrite(level: AccessLevel | null): boolean {
  return level === "owner" || level === "write";
}
