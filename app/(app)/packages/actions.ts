"use server";

import { refresh } from "next/cache";
import { getActionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { fail, readAmount, type ActionResult } from "@/lib/action-result";

async function requireAdminAction() {
  const user = await getActionUser();
  if (user.role !== "ADMIN") {
    throw new Error("Багц өөрчлөх эрх зөвхөн админд байна.");
  }
  return user;
}

const HEX = /^#[0-9a-fA-F]{6}$/;

export async function savePackage(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  await requireAdminAction();

  const id = String(formData.get("id") ?? "") || null;
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim() || null;
  const price = readAmount(formData.get("price"));
  const color = String(formData.get("color") ?? "").trim();
  const sortOrder = readAmount(formData.get("sortOrder")) ?? 0;
  const serviceIds = [
    ...new Set(formData.getAll("serviceIds").map(String).filter(Boolean)),
  ];

  const issues: string[] = [];
  if (!name) issues.push("Багцын нэрийг оруулна уу.");
  if (price == null) issues.push("Багцын үнийг оруулна уу.");
  if (serviceIds.length < 2)
    issues.push("Багцад хамгийн багадаа хоёр үйлчилгээ сонгоно уу.");
  if (color && !HEX.test(color)) issues.push("Өнгө нь #rrggbb хэлбэртэй байна.");

  if (issues.length > 0) return { ok: false, issues };

  // Сонгосон үйлчилгээнүүд бодитоор байгаа, идэвхтэй эсэхийг шалгана
  const found = await prisma.service.findMany({
    where: { id: { in: serviceIds }, isActive: true },
    select: { id: true, price: true },
  });
  if (found.length !== serviceIds.length) {
    return fail("Сонгосон үйлчилгээнүүдийн зарим нь олдсонгүй эсвэл идэвхгүй байна.");
  }

  const listTotal = found.reduce((sum, s) => sum + s.price, 0);
  if ((price as number) > listTotal) {
    return fail(
      `Багцын үнэ (${(price as number).toLocaleString("mn-MN")}₮) нь дотоод үйлчилгээнүүдийн нийлбэрээс (${listTotal.toLocaleString("mn-MN")}₮) их байна. Хямд байх ёстой.`,
    );
  }

  const data = {
    name,
    description,
    price: price as number,
    color: color || null,
    sortOrder,
  };

  try {
    if (id) {
      // Багцын бүрэлдэхүүнийг бүхэлд нь дахин бичнэ
      await prisma.$transaction([
        prisma.packageService.deleteMany({ where: { packageId: id } }),
        prisma.package.update({
          where: { id },
          data: {
            ...data,
            items: {
              create: serviceIds.map((serviceId, index) => ({
                serviceId,
                sortOrder: index,
              })),
            },
          },
        }),
      ]);
    } else {
      await prisma.package.create({
        data: {
          ...data,
          items: {
            create: serviceIds.map((serviceId, index) => ({
              serviceId,
              sortOrder: index,
            })),
          },
        },
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("Unique constraint") || message.includes("P2002")) {
      return fail(`«${name}» нэртэй багц аль хэдийн байна.`);
    }
    throw error;
  }

  refresh();
  return { ok: true };
}

export async function togglePackage(
  id: string,
  isActive: boolean,
): Promise<ActionResult> {
  await requireAdminAction();
  await prisma.package.update({ where: { id }, data: { isActive } });
  refresh();
  return { ok: true };
}

/** Устгах — ашиглагдсан багцыг идэвхгүй болгохыг зөвлөнө. */
export async function deletePackage(id: string): Promise<ActionResult> {
  await requireAdminAction();

  const pkg = await prisma.package.findUnique({
    where: { id },
    select: { name: true, _count: { select: { appointments: true } } },
  });
  if (!pkg) return fail("Багц олдсонгүй.");

  if (pkg._count.appointments > 0) {
    return fail(
      `«${pkg.name}» нь ${pkg._count.appointments} захиалгад ашиглагдсан тул устгах боломжгүй. Идэвхгүй болгоно уу.`,
    );
  }

  await prisma.package.delete({ where: { id } });
  refresh();
  return { ok: true };
}
