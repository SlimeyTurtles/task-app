"use server";

import bcrypt from "bcryptjs";
import { z } from "zod";

import { db } from "@/lib/db";

const RegisterSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  email: z.email().trim().toLowerCase(),
  password: z.string().min(8).max(200),
  // Invite is required — signup is gated to people the admin has explicitly
  // shared a code with. Empty / wrong code → "Invalid invite" error.
  invite: z.string().trim().min(1).max(64),
});

export type RegisterState = { error?: string; ok?: boolean };

export async function registerAction(
  _prev: RegisterState,
  formData: FormData,
): Promise<RegisterState> {
  const parsed = RegisterSchema.safeParse({
    name: formData.get("name") || undefined,
    email: formData.get("email"),
    password: formData.get("password"),
    invite: formData.get("invite"),
  });

  if (!parsed.success) {
    const issues = parsed.error.issues;
    const first = issues[0];
    if (first?.path[0] === "invite") return { error: "Invite code is required." };
    return { error: "Please enter a valid email and a password of at least 8 characters." };
  }

  const { name, email, password, invite } = parsed.data;

  // Validate the invite before doing any DB writes. Codes are stored verbatim
  // (alphanumeric, uppercase) — normalise input to match.
  const code = invite.toUpperCase();
  const inv = await db.invite.findUnique({ where: { code } });
  if (!inv) return { error: "Invite code not found." };
  if (inv.usedAt) return { error: "This invite has already been used." };
  if (inv.expiresAt && inv.expiresAt < new Date()) {
    return { error: "This invite has expired." };
  }
  // If the invite was issued for a specific email, that email is the only
  // one that can claim it. Prevents passing tokens around.
  if (inv.email && inv.email !== email) {
    return { error: "This invite is tied to a different email address." };
  }

  const existing = await db.user.findUnique({ where: { email } });
  if (existing) return { error: "An account with that email already exists." };

  const passwordHash = await bcrypt.hash(password, 12);
  // User creation + invite claim happen in one transaction so a partial
  // failure can't leave a claimed invite without an account, or vice versa.
  await db.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email,
        name,
        passwordHash,
        capacityModel: {
          create: {}, // seed with defaults from schema
        },
      },
    });
    await tx.invite.update({
      where: { id: inv.id },
      data: { usedAt: new Date(), usedById: user.id },
    });
  });

  return { ok: true };
}
