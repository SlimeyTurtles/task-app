"use server";

import bcrypt from "bcryptjs";
import { z } from "zod";

import { db } from "@/lib/db";

const RegisterSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  email: z.email().trim().toLowerCase(),
  password: z.string().min(8).max(200),
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
  });

  if (!parsed.success) {
    return { error: "Please enter a valid email and a password of at least 8 characters." };
  }

  const { name, email, password } = parsed.data;

  const existing = await db.user.findUnique({ where: { email } });
  if (existing) return { error: "An account with that email already exists." };

  const passwordHash = await bcrypt.hash(password, 12);
  await db.user.create({
    data: {
      email,
      name,
      passwordHash,
      capacityModel: {
        create: {}, // seed with defaults from schema
      },
    },
  });

  return { ok: true };
}
