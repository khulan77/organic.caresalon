"use server";

import { randomUUID } from "node:crypto";
import { refresh } from "next/cache";
import {
  BRANCH_WRITE_DENIED,
  canWriteBranch,
  getActionUser,
} from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resolveBooking, validateSlot } from "@/lib/appointments";
import { searchClients } from "@/lib/queries";
import { trimOldClients } from "@/lib/clients";
import { isDateKey, localToUtc } from "@/lib/time";
import type { ActionResult } from "@/lib/action-result";
import type {
  AppointmentStatus,
  PaymentMethod,
} from "@/lib/generated/prisma/enums";

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

/**
 * Формоос нэмэлт төлбөрүүдийг уншина — зөвхөн дүн.
 * Юуны төлбөр болохыг асуухгүй: ресепшн хурдан бүртгэх нь чухал.
 */
function readCharges(formData: FormData): { amount: number }[] {
  return formData.getAll("chargeAmount").map((value) => ({
    amount: Number(String(value).replace(/[^\d-]/g, "")) || 0,
  }));
}

/** Нэмэлт төлбөрийн мөрөнд түүхэнд үлдэх нэг жигд нэр. */
const CHARGE_LABEL = "Нэмэлт төлбөр";

/** Төлбөрийн хэлбэрийг шалгаж авах — танихгүй утга ирвэл бэлэн гэж үзнэ. */
function readMethod(value: unknown): PaymentMethod {
  const allowed: PaymentMethod[] = ["CASH", "CARD", "TRANSFER", "OTHER"];
  return allowed.includes(value as PaymentMethod)
    ? (value as PaymentMethod)
    : "CASH";
}

/** Формоос ирсэн ерөнхий талбаруудыг уншиж шалгах. */
async function readSlotForm(formData: FormData) {
  const issues: string[] = [];

  const branchId = String(formData.get("branchId") ?? "");
  const staffId = String(formData.get("staffId") ?? "");
  const dateKey = String(formData.get("dateKey") ?? "");
  const startTime = String(formData.get("startTime") ?? "");
  const note = String(formData.get("note") ?? "").trim() || null;
  const serviceIds = formData.getAll("serviceIds").map(String).filter(Boolean);

  if (!branchId) issues.push("Салбар сонгогдоогүй байна.");
  if (!staffId) issues.push("Ажилтан сонгоно уу.");
  if (!isDateKey(dateKey)) issues.push("Огноо буруу байна.");
  if (!/^\d{2}:\d{2}$/.test(startTime)) issues.push("Эхлэх цаг буруу байна.");
  if (serviceIds.length === 0)
    issues.push("Хамгийн багадаа нэг үйлчилгээ сонгоно уу.");

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
    serviceStaffIds: formData.getAll("serviceStaffId").map(String),
    charges: readCharges(formData),
  };
}

/**
 * Бүлгийн бүх ажилтны цагийг шалгана.
 *
 * Зэрэг эхэлж зэрэг дуусах тул ажилтан БҮР бүлгийн БҮТЭН хугацаанд эзлэгдэнэ —
 * богино үйлчилгээтэй ажилтан ч бүлэг дуустал өөр захиалга авахгүй.
 */
async function validateGroup(input: {
  branchId: string;
  dateKey: string;
  startMin: number;
  durationMin: number;
  staffIds: string[];
  /** Засварлаж буй бүлгийн мөрүүд — өөрсдийгөө давхцуулж үзэхгүй */
  excludeAppointmentIds?: string[];
}): Promise<string[]> {
  const results = await Promise.all(
    input.staffIds.map((staffId) =>
      validateSlot({
        branchId: input.branchId,
        staffId,
        dateKey: input.dateKey,
        startMin: input.startMin,
        durationMin: input.durationMin,
        excludeAppointmentIds: input.excludeAppointmentIds,
      }),
    ),
  );

  // Ижил мессеж давхардахаас сэргийлнэ (жишээ нь «салбар хаалттай»)
  const seen = new Set<string>();
  const messages: string[] = [];
  for (const issue of results.flat()) {
    if (seen.has(issue.message)) continue;
    seen.add(issue.message);
    messages.push(issue.message);
  }
  return messages;
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

/**
 * Шинэ цаг захиалга үүсгэх.
 *
 * Үйлчилгээ бүр өөр ажилтанд ногдсон бол НЭГ бүлэг (`groupId`) дор хэд хэдэн
 * мөр үүснэ: бүгд зэрэг эхэлж зэрэг дуусна, төлбөр нь үндсэн мөрөнд наалдана.
 */
export async function createAppointment(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const user = await getActionUser();
  const form = await readSlotForm(formData);
  if (!form.ok) return { ok: false, issues: form.issues };

  // Ресепшн зөвхөн харьяа салбартаа бүртгэнэ
  if (!canWriteBranch(user, form.branchId)) {
    return { ok: false, issues: [BRANCH_WRITE_DENIED] };
  }

  let client;
  let resolved;
  try {
    client = await resolveClient(formData);
    resolved = await resolveBooking({
      branchId: form.branchId,
      serviceIds: form.serviceIds,
      serviceStaffIds: form.serviceStaffIds,
      primaryStaffId: form.staffId,
      charges: form.charges,
    });
  } catch (error) {
    return {
      ok: false,
      issues: [error instanceof Error ? error.message : "Алдаа гарлаа."],
    };
  }

  // ── Сервер талын давхцлын шалгалт — бүлгийн ажилтан бүрээр ──
  const issues = await validateGroup({
    branchId: form.branchId,
    dateKey: form.dateKey,
    startMin: form.startMin,
    durationMin: resolved.totalDuration,
    staffIds: resolved.groups.map((group) => group.staffId),
  });
  if (issues.length > 0) return { ok: false, issues };

  const startAt = localToUtc(form.dateKey, form.startMin);
  const endAt = new Date(startAt.getTime() + resolved.totalDuration * 60_000);

  // Урьдчилгаа — заавал биш. Төлөх дүнгээс хэтэрч болохгүй.
  const depositAmount = Math.max(
    0,
    Number(String(formData.get("depositAmount") ?? "").replace(/\D/g, "")) || 0,
  );
  if (depositAmount > resolved.totalPrice) {
    return {
      ok: false,
      issues: ["Урьдчилгаа нь төлөх дүнгээс их байж болохгүй."],
    };
  }
  const deposit =
    depositAmount > 0
      ? {
          amount: depositAmount,
          method: readMethod(formData.get("depositMethod")),
        }
      : null;

  // Ганц ажилтан бол бүлэг үүсгэхгүй — өгөгдөл энгийн хэвээр үлдэнэ
  const groupId = resolved.groups.length > 1 ? randomUUID() : null;

  try {
    await prisma.$transaction(
      resolved.groups.map((group) =>
        prisma.appointment.create({
          data: {
            branchId: form.branchId,
            staffId: group.staffId,
            clientId: client.id,
            startAt,
            endAt,
            note: form.note,
            groupId,
            isPrimary: group.isPrimary,
            subtotal: group.subtotal,
            extraTotal: group.extraTotal,
            totalPrice: group.totalPrice,
            createdById: user.id,
            items: {
              create: group.services.map((service, index) => ({
                serviceId: service.id,
                name: service.name,
                price: service.price,
                durationMin: service.durationMin,
                sortOrder: index,
              })),
            },
            // Нэмэлт төлбөр ба урьдчилгаа ЗӨВХӨН үндсэн мөрөнд
            charges: group.isPrimary
              ? {
                  create: resolved.charges.map((charge) => ({
                    label: CHARGE_LABEL,
                    amount: charge.amount,
                    createdById: user.id,
                  })),
                }
              : undefined,
            payments:
              group.isPrimary && deposit
                ? {
                    create: {
                      amount: deposit.amount,
                      method: deposit.method,
                      // Бүтэн дүнг төлсөн бол энэ нь урьдчилгаа биш
                      isDeposit: deposit.amount < resolved.totalPrice,
                      note:
                        deposit.amount < resolved.totalPrice
                          ? "Захиалгын урьдчилгаа"
                          : "Бүрэн төлөлт",
                      receivedById: user.id,
                    },
                  }
                : undefined,
          },
        }),
      ),
    );
  } catch (error) {
    if (isOverlapConstraintError(error)) {
      return { ok: false, issues: [OVERLAP_MESSAGE] };
    }
    throw error;
  }

  // Захиалгаар шинэ хүн бүртгэгдсэн байж болзошгүй — жагсаалтыг 30-д барина
  await trimOldClients(client.id);

  refresh();
  return { ok: true };
}

/**
 * Байгаа захиалгыг засах.
 *
 * Бүлгийн ҮНДСЭН мөрийг ХЭЗЭЭ Ч устгахгүй — түүнд төлбөрийн бичилтүүд
 * наалдсан байдаг. Бусад мөрийг дахин байгуулна.
 */
export async function updateAppointment(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const user = await getActionUser();
  const appointmentId = String(formData.get("appointmentId") ?? "");
  if (!appointmentId) return { ok: false, issues: ["Захиалга олдсонгүй."] };

  const existing = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    select: { id: true, branchId: true, groupId: true, isPrimary: true },
  });
  if (!existing) return { ok: false, issues: ["Захиалга олдсонгүй."] };

  // Хоёрдогч мөрөөс засвал үндсэн мөр рүү шилжинэ — нэхэмжлэх нэг байх ёстой
  const primary = existing.isPrimary
    ? existing
    : ((await prisma.appointment.findFirst({
        where: { groupId: existing.groupId, isPrimary: true },
        select: { id: true, branchId: true, groupId: true, isPrimary: true },
      })) ?? existing);

  // Бүлгийн одоогийн бүх мөр — давхцлын шалгалтад хасаж, дараа нь цэвэрлэнэ
  const siblings = primary.groupId
    ? await prisma.appointment.findMany({
        where: { groupId: primary.groupId },
        select: { id: true },
      })
    : [{ id: primary.id }];
  const siblingIds = siblings.map((row) => row.id);

  const form = await readSlotForm(formData);
  if (!form.ok) return { ok: false, issues: form.issues };

  // Хуучин ба шинэ салбар ХОЁУЛАА эрхэд багтах ёстой — өөр салбар руу
  // зөөх замаар хязгаарлалтыг тойрч гарахаас сэргийлнэ.
  if (
    !canWriteBranch(user, primary.branchId) ||
    !canWriteBranch(user, form.branchId)
  ) {
    return { ok: false, issues: [BRANCH_WRITE_DENIED] };
  }

  let client;
  let resolved;
  try {
    client = await resolveClient(formData);
    resolved = await resolveBooking({
      branchId: form.branchId,
      serviceIds: form.serviceIds,
      serviceStaffIds: form.serviceStaffIds,
      primaryStaffId: form.staffId,
      charges: form.charges,
    });
  } catch (error) {
    return {
      ok: false,
      issues: [error instanceof Error ? error.message : "Алдаа гарлаа."],
    };
  }

  const issues = await validateGroup({
    branchId: form.branchId,
    dateKey: form.dateKey,
    startMin: form.startMin,
    durationMin: resolved.totalDuration,
    staffIds: resolved.groups.map((group) => group.staffId),
    excludeAppointmentIds: siblingIds,
  });
  if (issues.length > 0) return { ok: false, issues };

  const startAt = localToUtc(form.dateKey, form.startMin);
  const endAt = new Date(startAt.getTime() + resolved.totalDuration * 60_000);
  const groupId =
    resolved.groups.length > 1 ? (primary.groupId ?? randomUUID()) : null;

  const [first, ...others] = resolved.groups;

  try {
    await prisma.$transaction([
      // Үндсэнээс бусад хуучин мөрийг устгана
      prisma.appointment.deleteMany({
        where: { id: { in: siblingIds.filter((id) => id !== primary.id) } },
      }),
      prisma.appointmentService.deleteMany({
        where: { appointmentId: primary.id },
      }),
      // Нэмэлт төлбөрийг мөн бүхэлд нь дахин бичнэ. Төлбөрийн (Payment)
      // мөрүүдийг ХЭЗЭЭ Ч ингэж арчихгүй — тэдгээр нь мөнгөний бодит бичилт.
      prisma.appointmentCharge.deleteMany({
        where: { appointmentId: primary.id },
      }),
      prisma.appointment.update({
        where: { id: primary.id },
        data: {
          branchId: form.branchId,
          staffId: first.staffId,
          clientId: client.id,
          startAt,
          endAt,
          note: form.note,
          groupId,
          isPrimary: true,
          subtotal: first.subtotal,
          extraTotal: first.extraTotal,
          totalPrice: first.totalPrice,
          items: {
            create: first.services.map((service, index) => ({
              serviceId: service.id,
              name: service.name,
              price: service.price,
              durationMin: service.durationMin,
              sortOrder: index,
            })),
          },
          charges: {
            create: resolved.charges.map((charge) => ({
              label: CHARGE_LABEL,
              amount: charge.amount,
              createdById: user.id,
            })),
          },
        },
      }),
      ...others.map((group) =>
        prisma.appointment.create({
          data: {
            branchId: form.branchId,
            staffId: group.staffId,
            clientId: client.id,
            startAt,
            endAt,
            note: form.note,
            groupId,
            isPrimary: false,
            subtotal: group.subtotal,
            extraTotal: 0,
            totalPrice: group.totalPrice,
            createdById: user.id,
            items: {
              create: group.services.map((service, index) => ({
                serviceId: service.id,
                name: service.name,
                price: service.price,
                durationMin: service.durationMin,
                sortOrder: index,
              })),
            },
          },
        }),
      ),
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

/**
 * Хуанли дээр чирж зөөх — өөр ажилтан руу, эсвэл өөр цаг руу.
 *
 * Үйлчилгээ, үнэ, төлбөрт ХҮРЭХГҮЙ: зөвхөн ХЭН, ХЭЗЭЭ гэдгийг л өөрчилнө.
 * Хамтарсан захиалгын цаг бүлгээрээ хөдөлнө (зэрэг эхэлж зэрэг дуусах ёстой),
 * ажилтан нь зөвхөн чирсэн мөрөнд солигдоно.
 */
export async function moveAppointment(input: {
  appointmentId: string;
  staffId: string;
  dateKey: string;
  startMin: number;
}): Promise<ActionResult> {
  const user = await getActionUser();

  if (!input.staffId) return { ok: false, issues: ["Ажилтан олдсонгүй."] };
  if (!isDateKey(input.dateKey)) return { ok: false, issues: ["Огноо буруу байна."] };
  if (
    !Number.isInteger(input.startMin) ||
    input.startMin < 0 ||
    input.startMin >= 24 * 60
  ) {
    return { ok: false, issues: ["Эхлэх цаг буруу байна."] };
  }

  const appointment = await prisma.appointment.findUnique({
    where: { id: input.appointmentId },
    select: {
      id: true,
      branchId: true,
      staffId: true,
      groupId: true,
      startAt: true,
      endAt: true,
      status: true,
    },
  });
  if (!appointment) return { ok: false, issues: ["Захиалга олдсонгүй."] };
  if (!canWriteBranch(user, appointment.branchId)) {
    return { ok: false, issues: [BRANCH_WRITE_DENIED] };
  }

  // Цуцлагдсан мөрийг зөөвөл идэвхтэй захиалгын цаг руу чимээгүй давхцана —
  // эхлээд төлөвийг нь сэргээх шаардлагатай.
  if (appointment.status === "CANCELLED" || appointment.status === "NO_SHOW") {
    return {
      ok: false,
      issues: [
        "Цуцлагдсан захиалгыг чирж зөөх боломжгүй. Эхлээд төлөвийг нь сэргээнэ үү.",
      ],
    };
  }

  const durationMin = Math.round(
    (appointment.endAt.getTime() - appointment.startAt.getTime()) / 60_000,
  );

  const group = appointment.groupId
    ? await prisma.appointment.findMany({
        where: { groupId: appointment.groupId },
        select: { id: true, staffId: true },
      })
    : [{ id: appointment.id, staffId: appointment.staffId }];

  // Бүлгийн хоёр мөр нэг ажилтанд ногдож болохгүй — тэр хүн өөртэйгөө давхцана
  if (
    group.some((row) => row.id !== appointment.id && row.staffId === input.staffId)
  ) {
    return {
      ok: false,
      issues: ["Энэ ажилтан уг хамтарсан захиалгад аль хэдийн орсон байна."],
    };
  }

  const rows = group.map((row) => ({
    id: row.id,
    staffId: row.id === appointment.id ? input.staffId : row.staffId,
  }));

  const issues = await validateGroup({
    branchId: appointment.branchId,
    dateKey: input.dateKey,
    startMin: input.startMin,
    durationMin,
    staffIds: rows.map((row) => row.staffId),
    excludeAppointmentIds: rows.map((row) => row.id),
  });
  if (issues.length > 0) return { ok: false, issues };

  const startAt = localToUtc(input.dateKey, input.startMin);
  const endAt = new Date(startAt.getTime() + durationMin * 60_000);

  try {
    await prisma.$transaction(
      rows.map((row) =>
        prisma.appointment.update({
          where: { id: row.id },
          data: { staffId: row.staffId, startAt, endAt },
        }),
      ),
    );
  } catch (error) {
    if (isOverlapConstraintError(error)) {
      return { ok: false, issues: [OVERLAP_MESSAGE] };
    }
    throw error;
  }

  refresh();
  return { ok: true };
}

/**
 * Захиалгын төлөв солих (ирсэн, дууссан, цуцалсан гэх мэт).
 * Хамтарсан захиалга бол бүлгийн БҮХ мөр хамт солигдоно — нэг үйлчлүүлэгчийн
 * нэг ирэлт хоёр өөр төлөвт байж болохгүй.
 */
export async function setAppointmentStatus(
  appointmentId: string,
  status: AppointmentStatus,
  reason?: string,
): Promise<ActionResult> {
  const user = await getActionUser();

  const existing = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    select: { branchId: true, groupId: true },
  });
  if (!existing) return { ok: false, issues: ["Захиалга олдсонгүй."] };
  if (!canWriteBranch(user, existing.branchId)) {
    return { ok: false, issues: [BRANCH_WRITE_DENIED] };
  }

  // Цуцлалт / ирээгүйг ХЭН, ХЭЗЭЭ хийснийг тэмдэглэнэ. Идэвхтэй төлөв рүү
  // буцаавал тэмдэглэгээг арилгана — түүх нь одоогийн байдалтай зөрөхгүй.
  const cancelling = status === "CANCELLED" || status === "NO_SHOW";
  const audit = cancelling
    ? {
        cancelledAt: new Date(),
        cancelledById: user.id,
        cancelReason: reason?.trim() || null,
      }
    : { cancelledAt: null, cancelledById: null, cancelReason: null };

  try {
    await prisma.appointment.updateMany({
      where: existing.groupId
        ? { groupId: existing.groupId }
        : { id: appointmentId },
      data: { status, ...audit },
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
  const user = await getActionUser();

  const existing = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    select: { branchId: true, groupId: true },
  });
  if (!existing) return { ok: false, issues: ["Захиалга олдсонгүй."] };
  if (!canWriteBranch(user, existing.branchId)) {
    return { ok: false, issues: [BRANCH_WRITE_DENIED] };
  }

  // Хамтарсан захиалгыг хэсэгчлэн устгавал өнчин мөр үлдэнэ — бүлгээр нь авна
  await prisma.appointment.deleteMany({
    where: existing.groupId
      ? { groupId: existing.groupId }
      : { id: appointmentId },
  });
  refresh();
  return { ok: true };
}

// ───────────────────────────── Төлбөр ──────────────────────────────────

/** Захиалгын салбарыг олж, бичих эрхийг шалгана. */
async function requirePayableAppointment(appointmentId: string) {
  const user = await getActionUser();
  const appointment = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    select: { id: true, branchId: true, totalPrice: true },
  });
  if (!appointment) return { ok: false as const, issue: "Захиалга олдсонгүй." };
  if (!canWriteBranch(user, appointment.branchId)) {
    return { ok: false as const, issue: BRANCH_WRITE_DENIED };
  }
  return { ok: true as const, user, appointment };
}

/**
 * Төлбөр бүртгэх — урьдчилгаа, үлдэгдэл, бүтэн төлөлт бүгд энэ замаар орно.
 * Буцаалтыг сөрөг дүнгээр бичнэ.
 */
export async function addPayment(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const appointmentId = String(formData.get("appointmentId") ?? "");
  const guard = await requirePayableAppointment(appointmentId);
  if (!guard.ok) return { ok: false, issues: [guard.issue] };

  const raw = String(formData.get("amount") ?? "").replace(/[^\d-]/g, "");
  const amount = Number(raw) || 0;
  if (amount === 0) {
    return { ok: false, issues: ["Төлбөрийн дүнг оруулна уу."] };
  }

  // Одоогийн төлсөн дүнг уншиж, хэт их төлөхөөс сэргийлнэ
  const existing = await prisma.payment.aggregate({
    where: { appointmentId },
    _sum: { amount: true },
  });
  const paid = existing._sum.amount ?? 0;
  if (paid + amount < 0) {
    return {
      ok: false,
      issues: [
        `Буцаалт хэтэрсэн байна. Одоогоор нийт ${paid.toLocaleString("mn-MN")}₮ төлөгдсөн.`,
      ],
    };
  }

  await prisma.payment.create({
    data: {
      appointmentId,
      amount,
      method: readMethod(formData.get("method")),
      isDeposit: formData.get("isDeposit") === "on",
      note: String(formData.get("note") ?? "").trim() || null,
      receivedById: guard.user.id,
    },
  });

  refresh();
  return { ok: true };
}

/**
 * «Төлбөрөө төлсөн» — үлдэгдлийг нэг товчоор бүрэн бүртгэнэ.
 *
 * Дүнг СЕРВЕР ДЭЭР дахин тооцно: клиентээс ирсэн тоонд найдвал хуучирсан
 * дэлгэц дутуу/илүү төлөлт бичих эрсдэлтэй.
 */
export async function settleAppointment(
  appointmentId: string,
  method: PaymentMethod,
): Promise<ActionResult> {
  const guard = await requirePayableAppointment(appointmentId);
  if (!guard.ok) return { ok: false, issues: [guard.issue] };

  const existing = await prisma.payment.aggregate({
    where: { appointmentId },
    _sum: { amount: true },
  });
  const due = guard.appointment.totalPrice - (existing._sum.amount ?? 0);

  if (due <= 0) {
    return { ok: false, issues: ["Энэ захиалга аль хэдийн бүрэн төлөгдсөн."] };
  }

  await prisma.payment.create({
    data: {
      appointmentId,
      amount: due,
      method: readMethod(method),
      isDeposit: false,
      note: "Бүрэн төлөлт",
      receivedById: guard.user.id,
    },
  });

  refresh();
  return { ok: true };
}

/** Буруу бүртгэсэн төлбөрийг устгах. */
export async function deletePayment(paymentId: string): Promise<ActionResult> {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    select: { appointmentId: true },
  });
  if (!payment) return { ok: false, issues: ["Төлбөр олдсонгүй."] };

  const guard = await requirePayableAppointment(payment.appointmentId);
  if (!guard.ok) return { ok: false, issues: [guard.issue] };

  await prisma.payment.delete({ where: { id: paymentId } });
  refresh();
  return { ok: true };
}

/** Захиалгын цонхны үйлчлүүлэгч хайх талбарт. */
export async function findClients(query: string) {
  await getActionUser();
  return searchClients(query);
}
