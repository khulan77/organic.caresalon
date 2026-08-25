"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { hashPassword, verifyPassword } from "@/lib/password";
import { getCurrentUser } from "@/lib/session";

export type ChangePasswordState = { error?: string };

/** Хамгийн богино зөвшөөрөх урт. */
const MIN_LENGTH = 8;

export async function changePassword(
  _prev: ChangePasswordState,
  formData: FormData,
): Promise<ChangePasswordState> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const current = String(formData.get("currentPassword") ?? "");
  const next = String(formData.get("newPassword") ?? "");
  const confirm = String(formData.get("confirmPassword") ?? "");

  if (!current || !next || !confirm) {
    return { error: "Бүх талбарыг бөглөнө үү." };
  }
  if (next.length < MIN_LENGTH) {
    return { error: `Шинэ нууц үг дор хаяж ${MIN_LENGTH} тэмдэгт байх ёстой.` };
  }
  if (next !== confirm) {
    return { error: "Шинэ нууц үг хоёр талбарт таарахгүй байна." };
  }
  if (next === current) {
    return { error: "Шинэ нууц үг хуучнаасаа өөр байх ёстой." };
  }

  // Хуучин нууц үгээ мэдэж байгаа эсэхийг заавал шалгана — эс бөгөөс
  // хэн нэгэн эзний компьютер дээр сууж байгаад нууц үгийг нь солиод авна.
  const record = await prisma.user.findUnique({
    where: { id: user.id },
    select: { passwordHash: true },
  });
  if (!record) redirect("/login");

  const ok = await verifyPassword(current, record.passwordHash);
  if (!ok) {
    return { error: "Одоогийн нууц үг буруу байна." };
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash: await hashPassword(next),
      mustChangePassword: false,
    },
  });

  redirect("/calendar");
}
