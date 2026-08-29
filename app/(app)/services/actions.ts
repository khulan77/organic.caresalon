"use server";

import { refresh } from "next/cache";
import { requireAdminAction } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { fail, readAmount, type ActionResult } from "@/lib/action-result";
import { isDateKey, localToUtc } from "@/lib/time";

/** Админаас өөр хүн энэ үйлдлийг оролдвол харагдах мессеж. */
const ADMIN_ONLY = "Үйлчилгээ өөрчлөх эрх зөвхөн админд байна.";

const HEX = /^#[0-9a-fA-F]{6}$/;

// ───────────────────────────── Ангилал ─────────────────────────────

export async function saveCategory(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const guard = await requireAdminAction(ADMIN_ONLY);
  if (!guard.ok) return guard;

  const id = String(formData.get("id") ?? "") || null;
  const name = String(formData.get("name") ?? "").trim();
  const color = String(formData.get("color") ?? "").trim();
  const sortOrder = readAmount(formData.get("sortOrder")) ?? 0;

  if (!name) return fail("Ангиллын нэрийг оруулна уу.");
  if (color && !HEX.test(color)) return fail("Өнгө нь #rrggbb хэлбэртэй байна.");

  const data = { name, color: color || "#a39887", sortOrder };

  try {
    if (id) await prisma.serviceCategory.update({ where: { id }, data });
    else await prisma.serviceCategory.create({ data });
  } catch (error) {
    if (isUniqueError(error)) return fail(`«${name}» нэртэй ангилал аль хэдийн байна.`);
    throw error;
  }

  refresh();
  return { ok: true };
}

export async function deleteCategory(id: string): Promise<ActionResult> {
  const guard = await requireAdminAction(ADMIN_ONLY);
  if (!guard.ok) return guard;

  const count = await prisma.service.count({ where: { categoryId: id } });
  if (count > 0) {
    return fail(
      `Энэ ангилалд ${count} үйлчилгээ байна. Эхлээд тэдгээрийг зөөх эсвэл устгана уу.`,
    );
  }

  await prisma.serviceCategory.delete({ where: { id } });
  refresh();
  return { ok: true };
}

// ──────────────────────────── Үйлчилгээ ────────────────────────────

export async function saveService(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const guard = await requireAdminAction(ADMIN_ONLY);
  if (!guard.ok) return guard;

  const id = String(formData.get("id") ?? "") || null;
  const categoryId = String(formData.get("categoryId") ?? "");
  // Хоосон бол бүх салбарт нийтлэг үйлчилгээ
  const branchId = String(formData.get("branchId") ?? "").trim() || null;
  const name = String(formData.get("name") ?? "").trim();
  const durationMin = readAmount(formData.get("durationMin"));
  const price = readAmount(formData.get("price"));
  const salePriceRaw = String(formData.get("salePrice") ?? "").trim();
  const salePrice = salePriceRaw ? readAmount(formData.get("salePrice")) : null;
  const saleEnds = String(formData.get("saleEndsAt") ?? "").trim();
  const color = String(formData.get("color") ?? "").trim();

  const issues: string[] = [];
  if (!categoryId) issues.push("Ангилал сонгоно уу.");
  if (!name) issues.push("Үйлчилгээний нэрийг оруулна уу.");
  if (durationMin == null || durationMin <= 0)
    issues.push("Хугацааг минутаар, 0-ээс их оруулна уу.");
  if (price == null) issues.push("Үнийг оруулна уу.");
  if (salePriceRaw && salePrice == null) issues.push("Хямдралтай үнэ буруу байна.");
  if (salePrice != null && price != null && salePrice >= price)
    issues.push("Хямдралтай үнэ үндсэн үнээс бага байх ёстой.");
  if (saleEnds && !isDateKey(saleEnds)) issues.push("Хямдрал дуусах огноо буруу.");
  if (color && !HEX.test(color)) issues.push("Өнгө нь #rrggbb хэлбэртэй байна.");

  if (issues.length > 0) return { ok: false, issues };

  const data = {
    categoryId,
    branchId,
    name,
    durationMin: durationMin as number,
    price: price as number,
    salePrice,
    // Хямдрал заасан өдрийн ажлын төгсгөлд дуусна (локал 23:59 → UTC)
    saleEndsAt: saleEnds && salePrice != null ? localToUtc(saleEnds, 24 * 60) : null,
    color: color || null,
  };

  try {
    if (id) await prisma.service.update({ where: { id }, data });
    else await prisma.service.create({ data });
  } catch (error) {
    if (isUniqueError(error))
      return fail(
        `Энэ ангилалд «${name}» нэртэй үйлчилгээ тухайн салбарт аль хэдийн байна.`,
      );
    throw error;
  }

  refresh();
  return { ok: true };
}

/** Идэвхтэй / идэвхгүй болгох. Идэвхгүй үйлчилгээ шинэ захиалгад гарахгүй. */
export async function toggleService(
  id: string,
  isActive: boolean,
): Promise<ActionResult> {
  const guard = await requireAdminAction(ADMIN_ONLY);
  if (!guard.ok) return guard;
  await prisma.service.update({ where: { id }, data: { isActive } });
  refresh();
  return { ok: true };
}

/**
 * Бүрмөсөн устгах — зөвхөн ямар ч захиалгад ороогүй үйлчилгээг.
 * Ашиглагдсан бол түүх алдагдахгүйн тулд идэвхгүй болгохыг зөвлөнө.
 */
export async function deleteService(id: string): Promise<ActionResult> {
  const guard = await requireAdminAction(ADMIN_ONLY);
  if (!guard.ok) return guard;

  const service = await prisma.service.findUnique({
    where: { id },
    select: { name: true, _count: { select: { items: true } } },
  });
  if (!service) return fail("Үйлчилгээ олдсонгүй.");

  if (service._count.items > 0) {
    return fail(
      `«${service.name}» нь ${service._count.items} захиалгад бүртгэгдсэн тул устгах боломжгүй. Идэвхгүй болгоно уу.`,
    );
  }

  await prisma.service.delete({ where: { id } });
  refresh();
  return { ok: true };
}

function isUniqueError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("Unique constraint") || message.includes("P2002");
}
