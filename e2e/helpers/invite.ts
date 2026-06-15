import { randomBytes } from "crypto";
import { readFileSync } from "fs";
import { join } from "path";
import { PrismaClient } from "@prisma/client";

if (!process.env.DATABASE_URL) {
  const text = readFileSync(join(process.cwd(), ".env.local"), "utf-8");
  for (const line of text.split("\n")) {
    const m = line.match(/^([A-Z_]+)=(?:"([^"]*)"|(.*))$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2] ?? m[3];
  }
}

const db = new PrismaClient();

function generateCode(): string {
  const alphabet = "ABCDEFGHIJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(10);
  let out = "";
  for (let i = 0; i < 10; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

/**
 * Create a one-use invite without going through the (admin-gated) UI. The
 * createdBy user is bootstrapped on first call so tests can run on an empty
 * database.
 */
export async function makeInviteCode(): Promise<string> {
  const admin = await db.user.upsert({
    where: { email: "e2e-admin@example.com" },
    create: {
      email: "e2e-admin@example.com",
      name: "E2E Admin",
      role: "ADMIN",
    },
    update: {},
    select: { id: true },
  });
  const code = generateCode();
  await db.invite.create({
    data: {
      code,
      createdById: admin.id,
    },
  });
  return code;
}

/** Set a task's due date by name + user email. Used by tests that need
 *  minute-level dueDate precision (the UI's date input is day-only). */
export async function setTaskDueDate(email: string, taskName: string, dueAt: Date): Promise<void> {
  const user = await db.user.findUniqueOrThrow({ where: { email }, select: { id: true } });
  await db.task.updateMany({
    where: { userId: user.id, name: taskName },
    data: { dueDate: dueAt },
  });
}
