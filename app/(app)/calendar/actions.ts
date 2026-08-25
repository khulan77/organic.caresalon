"use server";

import { refresh } from "next/cache";
import { getActionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resolveBooking, validateSlot } from "@/lib/appointments";
import { searchClients } from "@/lib/queries";
import { isDateKey, localToUtc } from "@/lib/time";
import type { ActionResult } from "@/lib/action-result";
import type { AppointmentStatus } from "@/lib/generated/prisma/enums";

/** Утасны дугаараас зөвхөн цифр. */
function normalizePhone(value: string): string {
  return value.replace(/\D/g, "");
}

/**
 * Өгөгдлийн сангийн давхцлын хязгаарлалт зөрчигдсөн эсэхийг таних.
 * Хоёр ресепшн яг нэг зэрэг захиалбал програмын шалгалт өнгөрөөд энд баригдана.
 */
function isOverlapConstraintError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("appointments_no_staff_overlap");
}

const OVERLAP_MESSAGE =
  "Тухайн ажилтны цаг дөнгөж сая өөр захиалгаар дүүрлээ. Хуанлиа сэргээгээд өөр цаг сонгоно уу.";

/** Формоос ирсэн ерөнхий талбаруудыг уншиж шалгах. */
async function readSlotForm(formData: FormData) {
  const issues: string[] = [];

  const branchId = String(formData.get("branchId") ?? "");
  const staffId = String(formData.get("staffId") ?? "");
  const dateKey = String(formData.get("dateKey") ?? "");
  const startTime = String(formData.get("startTime") ?? "");
  const note = String(formData.get("note") ?? "").trim() || null;
  const serviceIds = formData.getAll("serviceIds").map(String).filter(Boolean);
  const packageId = String(formData.get("packageId") ?? "") || null;
  const discountRaw = String(formData.get("discount") ?? "").replace(/\D/g, "");
  const manualDiscount = discountRaw ? Number(discountRaw) : 0;

  if (!branchId) issues.push("Салбар сонгогдоогүй байна.");
  if (!staffId) issues.push("Ажилтан сонгоно уу.");
  if (!isDateKey(dateKey)) issues.push("Огноо буруу байна.");
  if (!/^\d{2}:\d{2}$/.test(startTime)) issues.push("Эхлэх цаг буруу байна.");
  if (serviceIds.length === 0 && !packageId)
    issues.push("Хамгийн багадаа нэг үйлчилгээ эсвэл багц сонгоно уу.");

  if (issues.length > 0) return { ok: false as const, issues };

  const [hour, minute] = startTime.split(":").map(Number);
  return {
    ok: true as const,
    branchId,
    staffId,
    dateKey,
    startMin: hour * 60 + minute,
    note,
    serviceIds,
    packageId,
    manualDiscount,
  };
}

/** Үйлчлүүлэгчийг олох эсвэл шинээр үүсгэх. */
async function resolveClient(formData: FormData) {
  const existingId = String(formData.get("clientId") ?? "");
  if (existingId) {
    const client = await prisma.client.findUnique({ where: { id: existingId } });
    if (!client) throw new Error("Сонгосон үйлчлүүлэгч олдсонгүй.");
    return client;
  }

  const name = String(formData.get("clientName") ?? "").trim();
  const phone = normalizePhone(String(formData.get("clientPhone") ?? ""));
  const note = String(formData.get("clientNote") ?? "").trim() || null;

  if (!name) throw new Error("Үйлчлүүлэгчийн нэрийг оруулна уу.");
  if (phone.length < 6) throw new Error("Утасны дугаар буруу байна.");

  // Ижил дугаартай хүн бүртгэлтэй бол давхардуулахгүй, байгааг нь ашиглана
  return prisma.client.upsert({
    where: { phone },
    update: { name, ...(note ? { note } : {}) },
    create: { name, phone, note },
  });
}

/** Шинэ цаг захиалга үүсгэх. */
export async function createAppointment(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const user = await getActionUser();
  const form = await readSlotForm(formData);
  if (!form.ok) return { ok: false, issues: form.issues };

  let client;
  let resolved;
  try {
    client = await resolveClient(formData);
    resolved = await resolveBooking({
      serviceIds: form.serviceIds,
      packageId: form.packageId,
      manualDiscount: form.manualDiscount,
    });
  } catch (error) {
    return {
      ok: false,
      issues: [error instanceof Error ? error.message : "Алдаа гарлаа."],
    };
  }

  // ── Сервер талын давхцлын шалгалт ──
  const slotIssues = await validateSlot({
    branchId: form.branchId,
    staffId: form.staffId,
    dateKey: form.dateKey,
    startMin: form.startMin,
    durationMin: resolved.totalDuration,
  });
  if (slotIssues.length > 0) {
    return { ok: false, issues: slotIssues.map((i) => i.message) };
  }

  const startAt = localToUtc(form.dateKey, form.startMin);
  const endAt = new Date(startAt.getTime() + resolved.totalDuration * 60_000);

  try {
    await prisma.appointment.create({
      data: {
        branchId: form.branchId,
        staffId: form.staffId,
        clientId: client.id,
        startAt,
        endAt,
        note: form.note,
        packageId: resolved.packageId,
        subtotal: resolved.subtotal,
        discount: resolved.discount,
        discountNote: resolved.discountNote,
        totalPrice: resolved.totalPrice,
        createdById: user.id,
        items: {
          create: resolved.services.map((service, index) => ({
            serviceId: service.id,
            name: service.name,
            price: service.price,
            durationMin: service.durationMin,
            sortOrder: index,
          })),
        },
      },
    });
  } catch (error) {
    if (isOverlapConstraintError(error)) {
      return { ok: false, issues: [OVERLAP_MESSAGE] };
    }
    throw error;
  }

  refresh();
  return { ok: true };
}

/** Байгаа захиалгыг засах. */
export async function updateAppointment(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  await getActionUser();
  const appointmentId = String(formData.get("appointmentId") ?? "");
  if (!appointmentId) return { ok: false, issues: ["Захиалга олдсонгүй."] };

  const form = await readSlotForm(formData);
  if (!form.ok) return { ok: false, issues: form.issues };

  let client;
  let resolved;
  try {
    client = await resolveClient(formData);
    resolved = await resolveBooking({
      serviceIds: form.serviceIds,
      packageId: form.packageId,
      manualDiscount: form.manualDiscount,
    });
  } catch (error) {
    return {
      ok: false,
      issues: [error instanceof Error ? error.message : "Алдаа гарлаа."],
    };
  }

  const slotIssues = await validateSlot({
    branchId: form.branchId,
    staffId: form.staffId,
    dateKey: form.dateKey,
    startMin: form.startMin,
    durationMin: resolved.totalDuration,
    excludeAppointmentId: appointmentId,
  });
  if (slotIssues.length > 0) {
    return { ok: false, issues: slotIssues.map((i) => i.message) };
  }

  const startAt = localToUtc(form.dateKey, form.startMin);
  const endAt = new Date(startAt.getTime() + resolved.totalDuration * 60_000);

  try {
    await prisma.$transaction([
      prisma.appointmentService.deleteMany({ where: { appointmentId } }),
      prisma.appointment.update({
        where: { id: appointmentId },
        data: {
          branchId: form.branchId,
          staffId: form.staffId,
          clientId: client.id,
          startAt,
          endAt,
          note: form.note,
          packageId: resolved.packageId,
          subtotal: resolved.subtotal,
          discount: resolved.discount,
          discountNote: resolved.discountNote,
          totalPrice: resolved.totalPrice,
          items: {
            create: resolved.services.map((service, index) => ({
              serviceId: service.id,
              name: service.name,
              price: service.price,
              durationMin: service.durationMin,
              sortOrder: index,
            })),
          },
        },
      }),
    ]);
  } catch (error) {
    if (isOverlapConstraintError(error)) {
      return { ok: false, issues: [OVERLAP_MESSAGE] };
    }
    throw error;
  }

  refresh();
  return { ok: true };
}

/** Захиалгын төлөв солих (ирсэн, дууссан, цуцалсан гэх мэт). */
export async function setAppointmentStatus(
  appointmentId: string,
  status: AppointmentStatus,
): Promise<ActionResult> {
  await getActionUser();

  try {
    await prisma.appointment.update({
      where: { id: appointmentId },
      data: { status },
    });
  } catch (error) {
    if (isOverlapConstraintError(error)) {
      return {
        ok: false,
        issues: [
          "Энэ цагт өөр захиалга орсон тул төлөвийг буцаах боломжгүй байна.",
        ],
      };
    }
    throw error;
  }

  refresh();
  return { ok: true };
}

/** Захиалгыг бүрмөсөн устгах (зөвхөн буруу бүртгэлийг арилгахад). */
export async function deleteAppointment(
  appointmentId: string,
): Promise<ActionResult> {
  await getActionUser();
  await prisma.appointment.delete({ where: { id: appointmentId } });
  refresh();
  return { ok: true };
}

/** Захиалгын цонхны үйлчлүүлэгч хайх талбарт. */
export async function findClients(query: string) {
  await getActionUser();
  return searchClients(query);
}
