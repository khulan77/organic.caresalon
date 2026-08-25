"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { verifyPassword } from "@/lib/password";
import { createSession, destroySession, pruneExpiredSessions } from "@/lib/session";

export type LoginState = { error?: string };

/** Утасны дугаараас зөвхөн цифрийг үлдээнэ ("9910-4657" → "99104657"). */
function normalizePhone(value: string): string {
  return value.replace(/\D/g, "");
}

export async function login(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const phone = normalizePhone(String(formData.get("phone") ?? ""));
  const password = String(formData.get("password") ?? "");

  if (!phone || !password) {
    return { error: "Утасны дугаар болон нууц үгээ оруулна уу." };
  }

  const user = await prisma.user.findUnique({
    where: { phone },
    select: { id: true, passwordHash: true, isActive: true },
  });

  // Дугаар олдоогүй ч нууц үг шалгаж байгаа мэт хугацаа зарцуулна —
  // ингэснээр аль дугаар бүртгэлтэйг цагаар нь таамаглах боломжгүй.
  const hash =
    user?.passwordHash ??
    "scrypt$00000000000000000000000000000000$0000000000000000000000000000000000000000000000000000000000000000";
  const ok = await verifyPassword(password, hash);

  if (!user || !ok) {
    return { error: "Утасны дугаар эсвэл нууц үг буруу байна." };
  }
  if (!user.isActive) {
    return { error: "Таны бүртгэл идэвхгүй болсон байна. Админд хандана уу." };
  }

  await pruneExpiredSessions();
  await createSession(user.id);
  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });

  redirect("/calendar");
}

export async function logout(): Promise<void> {
  await destroySession();
  redirect("/login");
}
