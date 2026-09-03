import "server-only";

import { prisma } from "@/lib/prisma";
import { effectivePrice } from "@/lib/pricing";
import { ACTIVE_STATUSES, formatDuration } from "@/lib/labels";
import {
  addDays,
  dayRangeUtc,
  formatMinutes,
  localToUtc,
  todayKey,
  toLocalMinutes,
  weekdayOf,
  type DateKey,
} from "@/lib/time";
import {
  intersectIntervals,
  startTimesIn,
  subtractIntervals,
  type Interval,
} from "@/lib/free-slots";

/**
 * Захиалгыг хэдэн хоногийн дараа хүртэл бүртгэхийг зөвшөөрөх.
 * Он сар буруу оруулсан алдааг барихад л зориулагдсан өргөн хязгаар.
 */
export const MAX_BOOKING_DAYS = 365;

/** Нэг захиалга хамгийн ихдээ хэдэн минут үргэлжлэх вэ — буруу оруулалтын хамгаалалт. */
export const MAX_DURATION_MIN = 12 * 60;

/**
 * ӨНГӨРСӨН өдрөөр хэр хол ухраад бүртгэж болох вэ.
 *
 * Салонд бүртгэлгүй үйлчлүүлсэн цагийг ажил дууссаны дараа буцаж бүртгэх нь
 * хэвийн — тиймээс өнгөрсөн цаг, өнгөрсөн өдөр хоёулаа НЭЭЛТТЭЙ. Энэ хязгаар
 * нь зөвхөн огноог андуурч бичсэнийг барихад (жишээ нь буруу он) зориулагдсан.
 */
export const MAX_BACKDATE_DAYS = 90;

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
  /**
   * ДАВХАР ЗАХИАЛГА — өөр захиалгатай давхцахыг зөвшөөрнө.
   *
   * Зөвхөн 7 дахь шалгалтыг (өөр захиалгатай давхцах) унтраана. Салбарын
   * ажлын цаг, ажилтны ээлж, чөлөө нь ХЭВЭЭР хүчинтэй — «завгүй» гэдэг нь
   * «ажилладаггүй» гэсэн үг биш.
   */
  allowOverlap?: boolean;
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
  if (dateKey < addDays(today, -MAX_BACKDATE_DAYS)) {
    issues.push({
      code: "TOO_OLD",
      message: `Хамгийн ихдээ ${MAX_BACKDATE_DAYS} хоногийн өмнөх цагийг буцааж бүртгэнэ. Огноогоо шалгана уу.`,
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
  if (input.allowOverlap) return issues;

  const startAt = localToUtc(dateKey, startMin);
  const endAt = localToUtc(dateKey, endMin);

  const conflicts = await prisma.appointment.findMany({
    where: {
      staffId,
      status: { in: ACTIVE_STATUSES },
      // Давхар гэж тэмдэглэсэн захиалга хэнийг ч хаахгүй — сангийн
      // хязгаарлалт ч түүнийг индексэд оруулдаггүй, хоёулаа нэг дүрэмтэй.
      allowOverlap: false,
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

/** Цаг сонголтын хамгийн нарийн алхам — хуанлийн нүдтэй ижил 30 минут. */
export const SLOT_STEP_MIN = 30;

/**
 * Сул цагуудын хоорондын АНХДАГЧ зай.
 *
 * Салонд үйлчилгээ хамгийн багадаа нэг цаг үргэлжилдэг тул 30 минут тутам
 * санал болгох нь утгагүй — сонгосон үйлчилгээнийхээ уртаар зай авна
 * (доод тал нь 1 цаг). Ингэснээр захиалгууд ар араасаа шахуу таарна.
 */
export function defaultSlotStep(durationMin: number): number {
  const rounded = Math.ceil(durationMin / SLOT_STEP_MIN) * SLOT_STEP_MIN;
  return Math.max(2 * SLOT_STEP_MIN, rounded);
}

export type FreeSlots = {
  /** Захиалга багтах эхлэх цагууд, локал минутаар */
  slots: number[];
  /** Сул цаг олдоогүй бол ЯАГААД — хоосон дэлгэц тайлбаргүй үлдэхгүй */
  reason: string | null;
};

/**
 * Тухайн ажилтан (эсвэл зэрэг ажиллах хэдэн ажилтан) дээр захиалга багтах
 * ЭХЛЭХ ЦАГУУДЫГ гаргана.
 *
 * `validateSlot`-той ЯГ ижил дүрмээр: салбарын ажлын цаг, ажилтны ээлж,
 * чөлөө, идэвхтэй захиалгууд. Ялгаа нь — энэ нь нэг цагийг шалгахын оронд
 * боломжтой бүх цагийг урьдчилж санал болгодог.
 */
export async function findFreeStartTimes(input: {
  branchId: string;
  dateKey: DateKey;
  /** Бүлгээр захиалбал бүх ажилтан ЗЭРЭГ сул байх ёстой */
  staffIds: string[];
  durationMin: number;
  /** Сул цагуудын хоорондын зай — өгөхгүй бол `defaultSlotStep` */
  stepMin?: number;
  /** Засварлаж буй бүлгийн мөрүүд — өөрсдийгөө завгүй гэж үзэхгүй */
  excludeAppointmentIds?: string[];
  /** Давхар захиалга — завгүй цагийг ч санал болгоно */
  allowOverlap?: boolean;
}): Promise<FreeSlots> {
  const { branchId, dateKey, durationMin } = input;
  const staffIds = [...new Set(input.staffIds)].filter(Boolean);

  if (staffIds.length === 0) {
    return { slots: [], reason: "Ажилтан сонгоно уу." };
  }
  if (!Number.isInteger(durationMin) || durationMin <= 0) {
    return { slots: [], reason: "Үйлчилгээгээ сонгоно уу." };
  }

  const today = todayKey();
  if (dateKey < addDays(today, -MAX_BACKDATE_DAYS)) {
    return { slots: [], reason: "Огноо хэт эрт байна." };
  }
  if (dateKey > addDays(today, MAX_BOOKING_DAYS)) {
    return { slots: [], reason: "Огноо хэт хол байна." };
  }

  const dateOnly = new Date(`${dateKey}T00:00:00.000Z`);
  const { start: dayStart, end: dayEnd } = dayRangeUtc(dateKey);

  const [branch, closure, staff, busy] = await Promise.all([
    prisma.branch.findUnique({
      where: { id: branchId },
      select: { openMin: true, closeMin: true },
    }),
    prisma.branchClosure.findUnique({
      where: { branchId_date: { branchId, date: dateOnly } },
      select: { isClosed: true, openMin: true, closeMin: true, reason: true },
    }),
    prisma.staff.findMany({
      where: { id: { in: staffIds }, branchId, isActive: true },
      select: {
        id: true,
        name: true,
        schedules: {
          where: { weekday: weekdayOf(dateKey) },
          select: { isDayOff: true, startMin: true, endMin: true },
        },
        timeOffs: {
          where: { date: dateOnly },
          select: { startMin: true, endMin: true },
        },
      },
    }),
    prisma.appointment.findMany({
      where: {
        staffId: { in: staffIds },
        status: { in: ACTIVE_STATUSES },
        startAt: { lt: dayEnd },
        endAt: { gt: dayStart },
        ...(input.excludeAppointmentIds?.length
          ? { id: { notIn: input.excludeAppointmentIds } }
          : {}),
      },
      select: { staffId: true, startAt: true, endAt: true },
    }),
  ]);

  if (!branch) return { slots: [], reason: "Салбар олдсонгүй." };
  if (staff.length !== staffIds.length) {
    return { slots: [], reason: "Ажилтан олдсонгүй." };
  }
  if (closure?.isClosed) {
    return {
      slots: [],
      reason: closure.reason
        ? `Тухайн өдөр салбар хаалттай (${closure.reason}).`
        : "Тухайн өдөр салбар хаалттай.",
    };
  }

  const openMin = closure?.openMin ?? branch.openMin;
  const closeMin = closure?.closeMin ?? branch.closeMin;

  // Ажилтан бүрийн сул муж — бүгдийн ДАВХЦАЛ нь бүлгийн сул цаг
  let free: Interval[] = [{ startMin: openMin, endMin: closeMin }];

  for (const member of staff) {
    const shift = member.schedules[0];
    if (!shift || shift.isDayOff) {
      return { slots: [], reason: `${member.name} тухайн өдөр амралттай.` };
    }

    const cuts: Interval[] = [
      ...member.timeOffs.map((off) => ({
        startMin: off.startMin ?? 0,
        endMin: off.endMin ?? 24 * 60,
      })),
      ...(input.allowOverlap ? [] : busy)
        .filter((appt) => appt.staffId === member.id)
        .map((appt) => ({
          // Шөнө дундыг давсан захиалгыг тухайн өдрийн мужид хумина
          startMin: appt.startAt < dayStart ? 0 : toLocalMinutes(appt.startAt),
          endMin: appt.endAt > dayEnd ? 24 * 60 : toLocalMinutes(appt.endAt),
        })),
    ];

    free = intersectIntervals(
      free,
      subtractIntervals(
        [{ startMin: shift.startMin, endMin: shift.endMin }],
        cuts,
      ),
    );
  }

  const step =
    input.stepMin && input.stepMin >= SLOT_STEP_MIN
      ? input.stepMin
      : defaultSlotStep(durationMin);

  // Өнгөрсөн цагийг ч санал болгоно — бүртгэлгүй үлдсэн үйлчилгээг ажил
  // дууссаны дараа буцааж бүртгэх нь ресепшний өдөр тутмын ажил
  const slots = startTimesIn(free, durationMin, step);

  return {
    slots,
    reason:
      slots.length > 0
        ? null
        : input.allowOverlap
          ? `${formatDuration(durationMin)} багтах цаг ажлын хуваарьт алга байна.`
          : `Энэ өдөр ${formatDuration(durationMin)} багтах сул цаг үлдээгүй байна.`,
  };
}

/**
 * Захиалгын үйлчилгээ, хугацаа, үнийг СЕРВЕР ДЭЭР эцэслэн тооцно.
 *
 * Клиентээс ирсэн үнэ/хугацаанд НАЙДАХГҮЙ — бүгдийг сангаас дахин уншина.
 * Захиалгын түвшинд хөнгөлөлт БАЙХГҮЙ — үнэ нь үйлчилгээний жагсаалтын
 * (хямдралтай бол хямдралтай) үнээр шууд бодогдоно.
 */
export async function resolveBooking(input: {
  /** Аль салбарын захиалга — өөр салбарын үйлчилгээ орохоос сэргийлнэ */
  branchId: string;
  serviceIds: string[];
  /** Гараар нэмсэн нэмэлт төлбөрүүд (урт хумс, материал г.м.) */
  charges?: { amount: number }[];
  /**
   * Үйлчилгээ бүрийг ХЭН хийх — `serviceIds`-тай ИЖИЛ дараалалтай.
   * Хоосон эсвэл дутуу бол `primaryStaffId` руу унана.
   */
  serviceStaffIds?: string[];
  /** Үндсэн ажилтан — хуваарилагдаагүй үйлчилгээ бүгд түүнд очно. */
  primaryStaffId: string;
  /**
   * Захиалгын БОДИТ үргэлжлэх хугацаа, минутаар.
   *
   * Жагсаалтын хугацаа зөвхөн ТООЦООЛОЛ: нэг цагийн хоёр маникурыг мастер
   * цаг хагаст багтаадаг, эсрэгээрээ удаж ч болно. Өгвөл захиалгын төгсгөл
   * үүгээр тогтоно, үйлчилгээ тус бүрийн хугацаа түүхэндээ хэвээр үлдэнэ.
   */
  durationOverride?: number | null;
}) {
  // Давхардлыг арилгаж, оруулсан дарааллыг хадгална
  const orderedIds = [...new Set(input.serviceIds)];

  if (orderedIds.length === 0) {
    throw new Error("Хамгийн багадаа нэг үйлчилгээ сонгоно уу.");
  }

  // Тухайн салбарын ба бүх салбарт нийтлэг үйлчилгээ л зөвшөөрөгдөнө
  const found = await prisma.service.findMany({
    where: {
      id: { in: orderedIds },
      isActive: true,
      OR: [{ branchId: null }, { branchId: input.branchId }],
    },
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
      throw new Error(
        "Сонгосон үйлчилгээ олдсонгүй, идэвхгүй болсон эсвэл өөр салбарынх байна.",
      );
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

  // Нэмэлт төлбөр — тэг/сөрөг дүнг шүүнэ. Хугацаанд нөлөөлөхгүй.
  // Тайлбар асуухгүй — зөвхөн дүн. Түүхэнд нэг жигд нэрээр үлдэнэ.
  const charges = (input.charges ?? [])
    .map((charge) => ({ amount: Math.round(charge.amount) }))
    .filter((charge) => charge.amount > 0);
  const extraTotal = charges.reduce((sum, charge) => sum + charge.amount, 0);

  // ── Үйлчилгээг ажилтнаар нь хуваах ──
  // Хуваарилалт нь ХЭРЭГЛЭГЧИЙН оруулсан `serviceIds` дарааллаар ирдэг тул
  // индексээр таарна.
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
  const computedDuration = ordered.reduce(
    (max, group) => Math.max(max, group.durationMin),
    0,
  );

  const override = input.durationOverride;
  const totalDuration =
    override && Number.isInteger(override) && override > 0
      ? Math.min(override, MAX_DURATION_MIN)
      : computedDuration;

  const groups = ordered.map((group, index) => {
    // Нэмэлт төлбөр бүхэлдээ үндсэн мөрөнд — материалын зардал хуваагдахгүй
    const extra = index === 0 ? extraTotal : 0;

    return {
      ...group,
      isPrimary: index === 0,
      extraTotal: extra,
      totalPrice: group.subtotal + extra,
    };
  });

  return {
    services,
    groups,
    charges,
    subtotal,
    extraTotal,
    totalPrice: subtotal + extraTotal,
    totalDuration,
    /** Үйлчилгээний жагсаалтаар бодвол хэдэн минут болох — харьцуулахад */
    computedDuration,
  };
}
