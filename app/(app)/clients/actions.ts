"use server";

import { refresh } from "next/cache";
import { getActionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { fail, type ActionResult } from "@/lib/action-result";
import { trimOldClients } from "@/lib/clients";

/** Утасны дугаараас зөвхөн цифр. */
function normalizePhone(value: string): string {
  return value.replace(/\D/g, "");
}

/**
 * Үйлчлүүлэгчийг гараар бүртгэх.
 *
 * Цаг захиалахгүйгээр урьдчилж бүртгэх зам — жишээ нь утсаар холбогдсон
 * шинэ хүнийг жагсаалтдаа оруулах. Дугаар нь ДАВХАРДАХГҮЙ түлхүүр учир
 * бүртгэлтэй дугаар ирвэл шинээр үүсгэхгүй, алдаа буцаана.
 */
export async function createClient(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  await getActionUser();

  const name = String(formData.get("name") ?? "").trim();
  const phone = normalizePhone(String(formData.get("phone") ?? ""));
  const note = String(formData.get("note") ?? "").trim() || null;

  const issues: string[] = [];
  if (!name) issues.push("Нэрийг оруулна уу.");
  if (phone.length < 6) issues.push("Утасны дугаар буруу байна.");
  if (issues.length > 0) return { ok: false, issues };

  const existing = await prisma.client.findUnique({
    where: { phone },
    select: { name: true },
  });
  if (existing) {
    return fail(`Энэ дугаар «${existing.name}» нэрээр бүртгэлтэй байна.`);
  }

  const created = await prisma.client.create({
    data: { name, phone, note },
    select: { id: true },
  });

  // Жагсаалт 30-д багтаж, хуучин нь доороосоо гарч явна
  await trimOldClients(created.id);

  refresh();
  return { ok: true };
}

/** Бүртгэлийн мэдээллийг засах. */
export async function updateClient(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  await getActionUser();

  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const phone = normalizePhone(String(formData.get("phone") ?? ""));
  const note = String(formData.get("note") ?? "").trim() || null;

  const issues: string[] = [];
  if (!id) issues.push("Үйлчлүүлэгч сонгогдоогүй байна.");
  if (!name) issues.push("Нэрийг оруулна уу.");
  if (phone.length < 6) issues.push("Утасны дугаар буруу байна.");
  if (issues.length > 0) return { ok: false, issues };

  // Дугаараа солиход өөр хүний дугаартай мөргөлдөж болзошгүй
  const clash = await prisma.client.findUnique({
    where: { phone },
    select: { id: true, name: true },
  });
  if (clash && clash.id !== id) {
    return fail(`Энэ дугаар «${clash.name}» нэрээр бүртгэлтэй байна.`);
  }

  await prisma.client.update({
    where: { id },
    data: { name, phone, note },
  });

  refresh();
  return { ok: true };
}
