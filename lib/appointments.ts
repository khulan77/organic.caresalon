import "server-only";

import { prisma } from "@/lib/prisma";
import { effectivePrice } from "@/lib/pricing";
import { ACTIVE_STATUSES } from "@/lib/labels";
import {
  addDays,
  formatMinutes,
  localToUtc,
  todayKey,
  toLocalMinutes,
  weekdayOf,
  type DateKey,
} from "@/lib/time";

/**
 * Захиалгыг хэдэн хоногийн дараа хүртэл бүртгэхийг зөвшөөрөх.
 * Он сар буруу оруулсан алдааг барихад л зориулагдсан өргөн хязгаар.
 */
export const MAX_BOOKING_DAYS = 365;

export type SlotInput = {
  branchId: string;
  staffId: string;
  /** Локал хуанлийн өдөр */
  dateKey: DateKey;
  /** Локал шөнө дундаас хойшх минут */
  startMin: number;
  durationMin: number;
  /** Засварлаж байгаа захиалгыг өөрөөс нь давхцуулж үзэхгүйн тулд */
  excludeAppointmentId?: string;
  /** Бүлгээр засварлах үед — бүлгийн бүх мөрийг давхцалд тооцохгүй */
  excludeAppointmentIds?: string[];
};

export type SlotIssue = { code: string; message: string };

/**
 * Цаг захиалга боломжтой эсэхийг СЕРВЕР ТАЛД бүрэн шалгана.
 *
 * Шалгах зүйлс:
 *  1. Хугацаа зөв эсэх
 *  2. Ажилтан тухайн салбарынх, идэвхтэй эсэх
 *  3. Салбар тухайн өдөр ажиллаж байгаа эсэх
 *  4. Салбарын ажлын цагт багтаж байгаа эсэх
 *  5. Ажилтны долоо хоногийн хуваарьт багтаж байгаа эсэх
 *  6. Ажилтны чөлөө/амралттай давхцаж байгаа эсэх
 *  7. Ажилтны өөр захиалгатай давхцаж байгаа эсэх
 *
 * Асуудал байвал бүгдийг нэг дор буцаана — хэрэглэгч нэг нэгээр засахгүй.
 */
export async function validateSlot(input: SlotInput): Promise<SlotIssue[]> {
  const issues: SlotIssue[] = [];
  const { branchId, staffId, dateKey, startMin, durationMin } = input;

  // 1. Хугацаа
  if (!Number.isInteger(durationMin) || durationMin <= 0) {
    issues.push({
      code: "DURATION",
      message: "Үйлчилгээний хугацаа 0-ээс их байх ёстой.",
    });
    return issues; // Хугацаагүйгээр цааш шалгах утгагүй
  }
  if (!Number.isInteger(startMin) || startMin < 0 || startMin >= 24 * 60) {
    issues.push({ code: "START", message: "Эхлэх цаг буруу байна." });
    return issues;
  }

  const endMin = startMin + durationMin;
  const today = todayKey();
  if (dateKey < today) {
    issues.push({
      code: "PAST",
      message: "Өнгөрсөн өдөрт цаг захиалах боломжгүй.",
    });
  }
  if (dateKey > addDays(today, MAX_BOOKING_DAYS)) {
    issues.push({
      code: "TOO_FAR",
      message: `Хамгийн ихдээ ${MAX_BOOKING_DAYS} хоногийн дараах цагийг захиалж болно. Огноогоо шалгана уу.`,
    });
  }

  // 2. Ажилтан ба салбар
  const staff = await prisma.staff.findUnique({
    where: { id: staffId },
    select: {
      id: true,
      name: true,
      isActive: true,
      branchId: true,
      branch: { select: { name: true, openMin: true, closeMin: true } },
      schedules: { where: { weekday: weekdayOf(dateKey) } },
      timeOffs: {
        where: { date: new Date(`${dateKey}T00:00:00.000Z`) },
      },
    },
  });

  if (!staff) {
    issues.push({ code: "STAFF", message: "Ажилтан олдсонгүй." });
    return issues;
  }
  if (!staff.isActive) {
    issues.push({
      code: "STAFF_INACTIVE",
      message: `${staff.name} идэвхгүй болсон байна.`,
    });
  }
  if (staff.branchId !== branchId) {
    issues.push({
      code: "STAFF_BRANCH",
      message: `${staff.name} нь ${staff.branch.name} салбарынх. Салбараа шалгана уу.`,
    });
  }

  // 3-4. Салбарын ажлын өдөр ба цаг
  const closure = await prisma.branchClosure.findUnique({
    where: { branchId_date: { branchId, date: new Date(`${dateKey}T00:00:00.000Z`) } },
  });

  let branchOpen = staff.branch.openMin;
  let branchClose = staff.branch.closeMin;

  if (closure?.isClosed) {
    issues.push({
      code: "BRANCH_CLOSED",
      message: closure.reason
        ? `Тухайн өдөр салбар хаалттай (${closure.reason}).`
        : "Тухайн өдөр салбар хаалттай.",
    });
  } else if (closure) {
    branchOpen = closure.openMin ?? branchOpen;
    branchClose = closure.closeMin ?? branchClose;
  }

  if (startMin < branchOpen || endMin > branchClose) {
    issues.push({
      code: "BRANCH_HOURS",
      message: `Салбарын ажлын цаг ${formatMinutes(branchOpen)}–${formatMinutes(branchClose)}. Сонгосон цаг ${formatMinutes(startMin)}–${formatMinutes(endMin)} нь багтахгүй байна.`,
    });
  }

  // 5. Ажилтны долоо хоногийн хуваарь
  const schedule = staff.schedules[0];
  if (!schedule || schedule.isDayOff) {
    issues.push({
      code: "STAFF_DAY_OFF",
      message: `${staff.name} тухайн өдөр амралттай.`,
    });
  } else if (startMin < schedule.startMin || endMin > schedule.endMin) {
    issues.push({
      code: "STAFF_HOURS",
      message: `${staff.name}-ийн ажлын цаг ${formatMinutes(schedule.startMin)}–${formatMinutes(schedule.endMin)}. Сонгосон цаг багтахгүй байна.`,
    });
  }

  // 6. Чөлөө / амралт
  for (const timeOff of staff.timeOffs) {
    const offStart = timeOff.startMin ?? 0;
    const offEnd = timeOff.endMin ?? 24 * 60;
    if (startMin < offEnd && endMin > offStart) {
      const range =
        timeOff.startMin == null
          ? "бүтэн өдөр"
          : `${formatMinutes(offStart)}–${formatMinutes(offEnd)}`;
      issues.push({
        code: "STAFF_TIME_OFF",
        message: `${staff.name} тухайн үед чөлөөтэй (${range}${timeOff.reason ? `, ${timeOff.reason}` : ""}).`,
      });
    }
  }

  // 7. Өөр захиалгатай давхцах эсэх — [эхлэл, төгсгөл) нээлттэй муж
  const startAt = localToUtc(dateKey, startMin);
  const endAt = localToUtc(dateKey, endMin);

  const conflicts = await prisma.appointment.findMany({
    where: {
      staffId,
      status: { in: ACTIVE_STATUSES },
      startAt: { lt: endAt },
      endAt: { gt: startAt },
      ...(() => {
        const excluded = [
          ...(input.excludeAppointmentId ? [input.excludeAppointmentId] : []),
          ...(input.excludeAppointmentIds ?? []),
        ];
        return excluded.length > 0 ? { id: { notIn: excluded } } : {};
      })(),
    },
    select: {
      id: true,
      startAt: true,
      endAt: true,
      client: { select: { name: true } },
    },
    orderBy: { startAt: "asc" },
    take: 5,
  });

  for (const conflict of conflicts) {
    issues.push({
      code: "OVERLAP",
      message: `${staff.name} тухайн цагт завгүй: ${formatMinutes(toLocalMinutes(conflict.startAt))}–${formatMinutes(toLocalMinutes(conflict.endAt))} (${conflict.client.name}).`,
    });
  }

  return issues;
}

/**
 * Захиалгын үйлчилгээ, хугацаа, үнийг СЕРВЕР ДЭЭР эцэслэн тооцно.
 *
 * Клиентээс ирсэн үнэ/хугацаанд НАЙДАХГҮЙ — бүгдийг сангаас дахин уншина.
 * Багц сонгосон бол түүний бүх үйлчилгээ заавал орно.
 */
export async function resolveBooking(input: {
  serviceIds: string[];
  packageId?: string | null;
  /** Гараар өгсөн нэмэлт хөнгөлөлт, төгрөгөөр */
  manualDiscount?: number;
  /** Гараар нэмсэн нэмэлт төлбөрүүд (урт хумс, материал г.м.) */
  charges?: { label: string; amount: number }[];
  /**
   * Үйлчилгээ бүрийг ХЭН хийх — `serviceIds`-тай ИЖИЛ дараалалтай.
   * Хоосон эсвэл дутуу бол `primaryStaffId` руу унана.
   */
  serviceStaffIds?: string[];
  /** Үндсэн ажилтан — хуваарилагдаагүй үйлчилгээ бүгд түүнд очно. */
  primaryStaffId: string;
}) {
  const pkg = input.packageId
    ? await prisma.package.findUnique({
        where: { id: input.packageId },
        select: {
          id: true,
          name: true,
          price: true,
          isActive: true,
          items: {
            orderBy: { sortOrder: "asc" },
            select: { serviceId: true },
          },
        },
      })
    : null;

  if (input.packageId && (!pkg || !pkg.isActive)) {
    throw new Error("Сонгосон багц олдсонгүй эсвэл идэвхгүй болсон байна.");
  }

  // Багцын үйлчилгээнүүд эхэнд, дараа нь нэмэлтээр сонгосон нь
  const packageServiceIds = pkg?.items.map((i) => i.serviceId) ?? [];
  const extraIds = input.serviceIds.filter(
    (id) => !packageServiceIds.includes(id),
  );
  const orderedIds = [...packageServiceIds, ...extraIds];

  if (orderedIds.length === 0) {
    throw new Error("Хамгийн багадаа нэг үйлчилгээ сонгоно уу.");
  }

  const found = await prisma.service.findMany({
    where: { id: { in: orderedIds }, isActive: true },
    select: {
      id: true,
      name: true,
      price: true,
      salePrice: true,
      saleEndsAt: true,
      durationMin: true,
    },
  });

  const byId = new Map(found.map((s) => [s.id, s]));
  const now = new Date();

  const services = orderedIds.map((id) => {
    const service = byId.get(id);
    if (!service) {
      throw new Error("Сонгосон үйлчилгээ олдсонгүй эсвэл идэвхгүй болсон байна.");
    }
    return {
      id: service.id,
      name: service.name,
      durationMin: service.durationMin,
      // Захиалгын агшны бодит үнэ — хямдрал хүчинтэй бол хямдралтай үнэ
      price: effectivePrice(service, now),
    };
  });

  const subtotal = services.reduce((sum, s) => sum + s.price, 0);

  // Нэмэлт төлбөр — хоосон нэр, тэг/сөрөг дүнг шүүнэ. Хугацаанд нөлөөлөхгүй.
  const charges = (input.charges ?? [])
    .map((charge) => ({
      label: charge.label.trim().slice(0, 80),
      amount: Math.round(charge.amount),
    }))
    .filter((charge) => charge.label.length > 0 && charge.amount > 0);
  const extraTotal = charges.reduce((sum, charge) => sum + charge.amount, 0);

  // Багцын хөнгөлөлт — зөвхөн багцад орсон үйлчилгээнүүдээс тооцно
  const packageSubtotal = services
    .filter((s) => packageServiceIds.includes(s.id))
    .reduce((sum, s) => sum + s.price, 0);
  const packageDiscount = pkg ? Math.max(0, packageSubtotal - pkg.price) : 0;

  const manual = Math.max(0, Math.round(input.manualDiscount ?? 0));
  // Хөнгөлөлт нь ҮЙЛЧИЛГЭЭНИЙ дүнгээс хэтрэхгүй — нэмэлт төлбөр (материалын
  // зардал) хөнгөлөлтөөр арчигдаж болохгүй.
  const discount = Math.min(subtotal, packageDiscount + manual);

  const notes: string[] = [];
  if (packageDiscount > 0 && pkg) notes.push(`Багц: ${pkg.name}`);

  // ── Үйлчилгээг ажилтнаар нь хуваах ──
  // Оруулсан дараалал: багцынх эхэлж, дараа нь нэмэлт. Хуваарилалт нь
  // ХЭРЭГЛЭГЧИЙН оруулсан `serviceIds` дарааллаар ирдэг тул индексээр таарна.
  const staffOf = new Map<string, string>();
  input.serviceIds.forEach((serviceId, index) => {
    const staffId = input.serviceStaffIds?.[index];
    if (staffId) staffOf.set(serviceId, staffId);
  });

  type Group = {
    staffId: string;
    services: typeof services;
    subtotal: number;
    durationMin: number;
  };

  // Map нь оруулсан дарааллаа хадгална — үндсэн ажилтан эхэнд байхыг
  // доор тусад нь баталгаажуулна.
  const groupMap = new Map<string, Group>();
  for (const service of services) {
    const staffId = staffOf.get(service.id) ?? input.primaryStaffId;
    const group = groupMap.get(staffId) ?? {
      staffId,
      services: [],
      subtotal: 0,
      durationMin: 0,
    };
    group.services.push(service);
    group.subtotal += service.price;
    group.durationMin += service.durationMin;
    groupMap.set(staffId, group);
  }

  // Үндсэн ажилтан ҮРГЭЛЖ эхний мөр — төлбөр, нэмэлт төлбөр түүнд наалдана.
  // Үндсэн ажилтанд нэг ч үйлчилгээ ногдоогүй бол эхний бүлэг үндсэн болно.
  const all = [...groupMap.values()];
  const ordered = [
    ...all.filter((group) => group.staffId === input.primaryStaffId),
    ...all.filter((group) => group.staffId !== input.primaryStaffId),
  ];

  /**
   * Бүлгийн нийт хугацаа = ХАМГИЙН УРТ ажилтных.
   * Зэрэг эхэлж зэрэг дуусах тул бүх багана ижил өндөртэй харагдана —
   * богино үйлчилгээтэй ажилтны цаг ч бүлгийн төгсгөл хүртэл эзлэгдэнэ.
   */
  const totalDuration = ordered.reduce(
    (max, group) => Math.max(max, group.durationMin),
    0,
  );

  /**
   * Хөнгөлөлтийг мөр бүрийн үйлчилгээний дүнгээр ХУВЬ ТЭНЦҮҮЛЭН хуваарилна.
   * Ингэснээр `totalPrice`-ийн нийлбэр бүлгийн бодит дүнтэй таарч, ажилтан
   * тус бүрийн орлого ч зөв гарна. Мөнгө алдагдахгүйн тулд бүхэлчилсний
   * үлдэгдлийг эхний (үндсэн) мөрөнд өгнө.
   */
  let allocated = 0;
  const groups = ordered.map((group, index) => {
    const isLast = index === ordered.length - 1;
    const share =
      subtotal === 0
        ? 0
        : isLast
          ? discount - allocated
          : Math.floor((discount * group.subtotal) / subtotal);
    allocated += share;

    // Нэмэлт төлбөр бүхэлдээ үндсэн мөрөнд — материалын зардал хуваагдахгүй
    const extra = index === 0 ? extraTotal : 0;

    return {
      ...group,
      isPrimary: index === 0,
      discount: share,
      extraTotal: extra,
      totalPrice: group.subtotal + extra - share,
    };
  });

  return {
    services,
    groups,
    charges,
    packageId: pkg?.id ?? null,
    subtotal,
    extraTotal,
    discount,
    manualDiscount: manual,
    packageDiscount,
    discountNote: notes.length > 0 ? notes.join(" · ") : null,
    totalPrice: subtotal + extraTotal - discount,
    totalDuration,
  };
}
