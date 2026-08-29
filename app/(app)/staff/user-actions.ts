"use server";

import { randomInt } from "node:crypto";
import { refresh } from "next/cache";
import { requireAdminAction } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/password";
import { fail } from "@/lib/action-result";

/**
 * Нэвтрэх эрх (User) удирдах үйлдлүүд.
 *
 * `Staff` (хуанли дээрх мастер) ба `User` (системд нэвтрэх эрх) нь ӨӨР зүйл.
 * Мастер бүр нэвтрэх эрхтэй байх шаардлагагүй, ресепшн хуанли дээр багана
 * эзэлдэггүй. Тиймээс хоёуланг нь тусад нь удирдана.
 */

/** Админаас өөр хүн энэ үйлдлийг оролдвол харагдах мессеж. */
const ADMIN_ONLY = "Нэвтрэх эрх өөрчлөх боломж зөвхөн админд байна.";

/** Түр нууц үг үүсгэсэн үед буцаах хариу — админ уншиж хэлнэ. */
export type UserActionResult =
  | { ok: true; tempPassword?: string }
  | { ok: false; issues: string[] };

/** Утасны дугаараас зөвхөн цифрийг үлдээнэ ("9910-4657" → "99104657"). */
function normalizePhone(value: string): string {
  return value.replace(/\D/g, "");
}

/**
 * Уншихад ойлгомжтой түр нууц үг.
 * Андуурч уншихаас сэргийлж 0/O, 1/l/I зэргийг ОРУУЛААГҮЙ — админ
 * ажилтандаа амаар хэлж өгдөг тул алдаа гарах боломжийг багасгана.
 */
const SAFE_CHARS = "abcdefghjkmnpqrstuvwxyz23456789";

function generateTempPassword(length = 10): string {
  let out = "";
  for (let i = 0; i < length; i++) {
    out += SAFE_CHARS[randomInt(SAFE_CHARS.length)];
  }
  return out;
}

/** Нэвтрэх эрхийг нь тасалж, идэвхтэй сессүүдийг устгана. */
async function revokeSessions(userId: string): Promise<void> {
  await prisma.session.deleteMany({ where: { userId } }).catch(() => undefined);
}

// ─────────────────────────── Нэмэх / засах ───────────────────────────

export async function saveUser(
  _prev: UserActionResult | null,
  formData: FormData,
): Promise<UserActionResult> {
  const guard = await requireAdminAction(ADMIN_ONLY);
  if (!guard.ok) return guard;
  const actor = guard.user;

  const id = String(formData.get("id") ?? "") || null;
  const name = String(formData.get("name") ?? "").trim();
  const phone = normalizePhone(String(formData.get("phone") ?? ""));
  const roleRaw = String(formData.get("role") ?? "RECEPTION");
  const branchId = String(formData.get("branchId") ?? "") || null;

  const issues: string[] = [];
  if (!name) issues.push("Нэрийг оруулна уу.");
  if (!phone) issues.push("Утасны дугаарыг оруулна уу.");
  else if (phone.length !== 8) {
    issues.push("Утасны дугаар 8 оронтой байх ёстой.");
  }
  if (roleRaw !== "ADMIN" && roleRaw !== "RECEPTION") {
    issues.push("Эрх буруу байна.");
  }

  if (issues.length > 0) return { ok: false, issues };
  const role = roleRaw as "ADMIN" | "RECEPTION";

  // Дугаар давхардаж байгаа эсэх — өөрийнхөө дугаарыг тооцохгүй
  const clash = await prisma.user.findUnique({
    where: { phone },
    select: { id: true, name: true },
  });
  if (clash && clash.id !== id) {
    return fail(
      `${phone} дугаар «${clash.name}»-д бүртгэлтэй байна. Өөр дугаар оруулна уу.`,
    );
  }

  if (id) {
    const current = await prisma.user.findUnique({
      where: { id },
      select: { role: true },
    });
    if (!current) return fail("Хэрэглэгч олдсонгүй.");

    // Сүүлчийн админыг ресепшн болговол хэн ч тохиргоо руу орж чадахгүй болно
    if (current.role === "ADMIN" && role !== "ADMIN") {
      const admins = await prisma.user.count({
        where: { role: "ADMIN", isActive: true, id: { not: id } },
      });
      if (admins === 0) {
        return fail(
          "Энэ бол цорын ганц админ. Эрхийг нь буулгавал тохиргоо руу хэн ч орж чадахгүй болно. Эхлээд өөр админ үүсгэнэ үү.",
        );
      }
    }

    await prisma.user.update({
      where: { id },
      data: { name, phone, role, branchId },
    });

    // Эрх нь өөрчлөгдсөн бол хуучин сесс хуучин эрхээ барьж үлдэхгүйн тулд
    // дахин нэвтрүүлнэ. Өөрийгөө засаж байгаа бол хөндөхгүй.
    if (current.role !== role && id !== actor.id) {
      await revokeSessions(id);
    }

    refresh();
    return { ok: true };
  }

  // Шинэ хэрэглэгч — түр нууц үгтэй, анх нэвтрэхэд заавал солино
  const tempPassword = generateTempPassword();
  await prisma.user.create({
    data: {
      name,
      phone,
      role,
      branchId,
      passwordHash: await hashPassword(tempPassword),
      mustChangePassword: true,
    },
  });

  refresh();
  return { ok: true, tempPassword };
}

// ─────────────────────────── Нууц үг сэргээх ──────────────────────────

/** Мартсан нууц үгийг шинэ түр нууц үгээр солино. */
export async function resetUserPassword(
  id: string,
): Promise<UserActionResult> {
  const guard = await requireAdminAction(ADMIN_ONLY);
  if (!guard.ok) return guard;

  const user = await prisma.user.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!user) return fail("Хэрэглэгч олдсонгүй.");

  const tempPassword = generateTempPassword();
  await prisma.user.update({
    where: { id },
    data: {
      passwordHash: await hashPassword(tempPassword),
      mustChangePassword: true,
    },
  });

  // Хуучин нууц үгээр нэвтэрсэн сессүүдийг таслана
  await revokeSessions(id);

  refresh();
  return { ok: true, tempPassword };
}

// ────────────────────────── Идэвхтэй / идэвхгүй ───────────────────────

export async function toggleUser(
  id: string,
  isActive: boolean,
): Promise<UserActionResult> {
  const guard = await requireAdminAction(ADMIN_ONLY);
  if (!guard.ok) return guard;
  const actor = guard.user;

  if (id === actor.id && !isActive) {
    return fail("Өөрийгөө идэвхгүй болгох боломжгүй.");
  }

  if (!isActive) {
    const admins = await prisma.user.count({
      where: { role: "ADMIN", isActive: true, id: { not: id } },
    });
    const target = await prisma.user.findUnique({
      where: { id },
      select: { role: true },
    });
    if (target?.role === "ADMIN" && admins === 0) {
      return fail("Цорын ганц админыг идэвхгүй болгох боломжгүй.");
    }
  }

  await prisma.user.update({ where: { id }, data: { isActive } });

  // Идэвхгүй болгоход нэвтэрсэн байсан бол шууд гаргана
  if (!isActive) await revokeSessions(id);

  refresh();
  return { ok: true };
}

// ──────────────────────────────── Устгах ──────────────────────────────

export async function deleteUser(id: string): Promise<UserActionResult> {
  const guard = await requireAdminAction(ADMIN_ONLY);
  if (!guard.ok) return guard;
  const actor = guard.user;

  if (id === actor.id) {
    return fail("Өөрийгөө устгах боломжгүй.");
  }

  const user = await prisma.user.findUnique({
    where: { id },
    select: {
      name: true,
      role: true,
      _count: { select: { createdAppts: true } },
    },
  });
  if (!user) return fail("Хэрэглэгч олдсонгүй.");

  if (user.role === "ADMIN") {
    const admins = await prisma.user.count({
      where: { role: "ADMIN", isActive: true, id: { not: id } },
    });
    if (admins === 0) return fail("Цорын ганц админыг устгах боломжгүй.");
  }

  // Захиалга үүсгэсэн түүхтэй бол устгахгүй — «хэн үүсгэсэн» нь алдагдана.
  // Схем дээр SetNull боловч түүхийг зориудаар хамгаална.
  if (user._count.createdAppts > 0) {
    return fail(
      `«${user.name}» нь ${user._count.createdAppts} захиалга үүсгэсэн түүхтэй тул устгах боломжгүй. Идэвхгүй болгоно уу — ингэснээр нэвтэрч чадахгүй болох ч түүх хэвээр үлдэнэ.`,
    );
  }

  await prisma.user.delete({ where: { id } });
  refresh();
  return { ok: true };
}
