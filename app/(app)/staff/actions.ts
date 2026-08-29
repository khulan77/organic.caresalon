"use server";

import { refresh } from "next/cache";
import { requireAdminAction } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ACTIVE_STATUSES } from "@/lib/labels";
import { fail, readAmount, type ActionResult } from "@/lib/action-result";
import {
  formatMinutes,
  isDateKey,
  localToUtc,
  parseMinutes,
  toDateKey,
  toLocalMinutes,
  weekdayOf,
} from "@/lib/time";

/** Админаас өөр хүн энэ үйлдлийг оролдвол харагдах мессеж. */
const ADMIN_ONLY = "Ажилтны мэдээлэл өөрчлөх эрх зөвхөн админд байна.";

const HEX = /^#[0-9a-fA-F]{6}$/;
const TIME = /^\d{2}:\d{2}$/;

type ShiftInput = {
  weekday: number;
  isDayOff: boolean;
  startMin: number;
  endMin: number;
};

/** Формоос долоо хоногийн 7 өдрийн хуваарийг уншина. */
function readSchedule(formData: FormData): ShiftInput[] | string {
  const shifts: ShiftInput[] = [];

  for (let weekday = 0; weekday < 7; weekday++) {
    const isDayOff = formData.get(`dayOff-${weekday}`) === "on";
    const start = String(formData.get(`start-${weekday}`) ?? "");
    const end = String(formData.get(`end-${weekday}`) ?? "");

    if (isDayOff) {
      shifts.push({ weekday, isDayOff: true, startMin: 600, endMin: 1140 });
      continue;
    }
    if (!TIME.test(start) || !TIME.test(end)) {
      return "Ажлын цаг буруу байна.";
    }
    const startMin = parseMinutes(start);
    const endMin = parseMinutes(end);
    if (endMin <= startMin) {
      return "Ажлын дуусах цаг эхлэх цагаас хойш байх ёстой.";
    }
    shifts.push({ weekday, isDayOff: false, startMin, endMin });
  }

  return shifts;
}

/**
 * Шинэ хуваарьт багтахгүй болох ИРЭЭДҮЙН захиалгуудыг олно.
 * Ийм захиалга байвал хуваарийг өөрчлөхгүй — эс бөгөөс хуанли дээр
 * ажилтан «амралттай» атлаа захиалга харагдах зөрчил үүснэ.
 */
async function appointmentsOutsideSchedule(
  staffId: string,
  shifts: ShiftInput[],
) {
  const upcoming = await prisma.appointment.findMany({
    where: {
      staffId,
      status: { in: ACTIVE_STATUSES },
      startAt: { gte: new Date() },
    },
    orderBy: { startAt: "asc" },
    select: {
      startAt: true,
      endAt: true,
      client: { select: { name: true } },
    },
  });

  const byWeekday = new Map(shifts.map((s) => [s.weekday, s]));

  return upcoming.filter((appointment) => {
    const dateKey = toDateKey(appointment.startAt);
    const shift = byWeekday.get(weekdayOf(dateKey));
    if (!shift) return true;
    if (shift.isDayOff) return true;

    const startMin = toLocalMinutes(appointment.startAt);
    const endLocal = toLocalMinutes(appointment.endAt);
    const endMin = endLocal <= startMin ? 24 * 60 : endLocal;
    return startMin < shift.startMin || endMin > shift.endMin;
  });
}

/** Зөрчилтэй захиалгуудыг хүнд ойлгомжтой мессеж болгоно. */
function describeConflicts(
  conflicts: { startAt: Date; endAt: Date; client: { name: string } }[],
) {
  return conflicts.slice(0, 4).map((a) => {
    const start = toLocalMinutes(a.startAt);
    const end = toLocalMinutes(a.endAt);
    return `${toDateKey(a.startAt)} ${formatMinutes(start)}–${formatMinutes(end)} · ${a.client.name}`;
  });
}

// ───────────────────────────── Ажилтан ─────────────────────────────

export async function saveStaff(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const guard = await requireAdminAction(ADMIN_ONLY);
  if (!guard.ok) return guard;

  const id = String(formData.get("id") ?? "") || null;
  const name = String(formData.get("name") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").replace(/\D/g, "") || null;
  const position = String(formData.get("position") ?? "").trim() || null;
  const branchId = String(formData.get("branchId") ?? "");
  const color = String(formData.get("color") ?? "").trim();
  const sortOrder = readAmount(formData.get("sortOrder")) ?? 0;

  const issues: string[] = [];
  if (!name) issues.push("Ажилтны нэрийг оруулна уу.");
  if (!branchId) issues.push("Салбар сонгоно уу.");
  if (color && !HEX.test(color)) issues.push("Өнгө нь #rrggbb хэлбэртэй байна.");

  const schedule = readSchedule(formData);
  if (typeof schedule === "string") issues.push(schedule);

  if (issues.length > 0) return { ok: false, issues };
  const shifts = schedule as ShiftInput[];

  if (id) {
    // Хуваарь нарийсгахад байгаа захиалга гацахаас сэргийлнэ
    const conflicts = await appointmentsOutsideSchedule(id, shifts);
    if (conflicts.length > 0) {
      return fail(
        "Шинэ хуваарьт багтахгүй захиалга байна. Эхлээд тэдгээрийг зөөх эсвэл цуцлана уу:",
        ...describeConflicts(conflicts),
      );
    }

    // Салбар солиход захиалгууд хуучин салбартаа үлдэхгүйн тулд шалгана
    const current = await prisma.staff.findUnique({
      where: { id },
      select: { branchId: true, name: true },
    });
    if (current && current.branchId !== branchId) {
      const upcoming = await prisma.appointment.count({
        where: {
          staffId: id,
          status: { in: ACTIVE_STATUSES },
          startAt: { gte: new Date() },
        },
      });
      if (upcoming > 0) {
        return fail(
          `${current.name} нь ${upcoming} ирээдүйн захиалгатай тул салбарыг нь солих боломжгүй. Эхлээд захиалгуудыг зөөнө үү.`,
        );
      }
    }
  }

  const data = {
    name,
    phone,
    position,
    branchId,
    color: color || "#a39887",
    sortOrder,
  };

  if (id) {
    await prisma.$transaction([
      prisma.staff.update({ where: { id }, data }),
      ...shifts.map((shift) =>
        prisma.staffSchedule.upsert({
          where: { staffId_weekday: { staffId: id, weekday: shift.weekday } },
          update: {
            isDayOff: shift.isDayOff,
            startMin: shift.startMin,
            endMin: shift.endMin,
          },
          create: { staffId: id, ...shift },
        }),
      ),
    ]);
  } else {
    await prisma.staff.create({
      data: { ...data, schedules: { create: shifts } },
    });
  }

  refresh();
  return { ok: true };
}

/** Идэвхгүй ажилтан хуанлид гарахгүй, шинэ захиалга авахгүй. */
export async function toggleStaff(
  id: string,
  isActive: boolean,
): Promise<ActionResult> {
  const guard = await requireAdminAction(ADMIN_ONLY);
  if (!guard.ok) return guard;

  if (!isActive) {
    const upcoming = await prisma.appointment.findMany({
      where: {
        staffId: id,
        status: { in: ACTIVE_STATUSES },
        startAt: { gte: new Date() },
      },
      orderBy: { startAt: "asc" },
      select: { startAt: true, endAt: true, client: { select: { name: true } } },
    });
    if (upcoming.length > 0) {
      return fail(
        `Энэ ажилтан ${upcoming.length} ирээдүйн захиалгатай байна. Эхлээд тэдгээрийг зөөх эсвэл цуцлана уу:`,
        ...describeConflicts(upcoming),
      );
    }
  }

  await prisma.staff.update({ where: { id }, data: { isActive } });
  refresh();
  return { ok: true };
}

/** Бүрмөсөн устгах — зөвхөн ямар ч захиалга аваагүй ажилтныг. */
export async function deleteStaff(id: string): Promise<ActionResult> {
  const guard = await requireAdminAction(ADMIN_ONLY);
  if (!guard.ok) return guard;

  const staff = await prisma.staff.findUnique({
    where: { id },
    select: { name: true, _count: { select: { appointments: true } } },
  });
  if (!staff) return fail("Ажилтан олдсонгүй.");

  if (staff._count.appointments > 0) {
    return fail(
      `${staff.name} нь ${staff._count.appointments} захиалгад бүртгэгдсэн тул устгах боломжгүй. Түүхийг хадгалахын тулд «Идэвхгүй» болгоно уу.`,
    );
  }

  await prisma.staff.delete({ where: { id } });
  refresh();
  return { ok: true };
}

// ────────────────────────────── Чөлөө ──────────────────────────────

export async function addTimeOff(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const guard = await requireAdminAction(ADMIN_ONLY);
  if (!guard.ok) return guard;

  const staffId = String(formData.get("staffId") ?? "");
  const dateKey = String(formData.get("date") ?? "");
  const wholeDay = formData.get("wholeDay") === "on";
  const reason = String(formData.get("reason") ?? "").trim() || null;

  if (!staffId) return fail("Ажилтан олдсонгүй.");
  if (!isDateKey(dateKey)) return fail("Огноо буруу байна.");

  let startMin: number | null = null;
  let endMin: number | null = null;

  if (!wholeDay) {
    const start = String(formData.get("startTime") ?? "");
    const end = String(formData.get("endTime") ?? "");
    if (!TIME.test(start) || !TIME.test(end)) {
      return fail("Чөлөөний цаг буруу байна.");
    }
    startMin = parseMinutes(start);
    endMin = parseMinutes(end);
    if (endMin <= startMin) {
      return fail("Дуусах цаг эхлэх цагаас хойш байх ёстой.");
    }
  }

  // Чөлөөтэй давхцах захиалга байвал зөвшөөрөхгүй
  const from = localToUtc(dateKey, startMin ?? 0);
  const to = localToUtc(dateKey, endMin ?? 24 * 60);
  const conflicts = await prisma.appointment.findMany({
    where: {
      staffId,
      status: { in: ACTIVE_STATUSES },
      startAt: { lt: to },
      endAt: { gt: from },
    },
    orderBy: { startAt: "asc" },
    select: { startAt: true, endAt: true, client: { select: { name: true } } },
  });

  if (conflicts.length > 0) {
    return fail(
      "Тухайн үед захиалга бүртгэгдсэн байна. Эхлээд зөөх эсвэл цуцлана уу:",
      ...describeConflicts(conflicts),
    );
  }

  await prisma.staffTimeOff.create({
    data: {
      staffId,
      date: new Date(`${dateKey}T00:00:00.000Z`),
      startMin,
      endMin,
      reason,
    },
  });

  refresh();
  return { ok: true };
}

export async function deleteTimeOff(id: string): Promise<ActionResult> {
  const guard = await requireAdminAction(ADMIN_ONLY);
  if (!guard.ok) return guard;
  await prisma.staffTimeOff.delete({ where: { id } });
  refresh();
  return { ok: true };
}
