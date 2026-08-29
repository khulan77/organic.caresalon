import "server-only";

import { prisma } from "@/lib/prisma";
import { addDays, weekdayOf, type DateKey } from "@/lib/time";

/**
 * Ажилчдын цагийн бүртгэл — Excel-ийн хүснэгт шиг «ажилтан × өдөр» тор.
 *
 * Нэг өдрийн ажилласан цагийг гурван эх сурвалжаас бодно:
 *   1. Ажилтны долоо хоногийн ҮНДСЭН хуваарь (StaffSchedule)
 *   2. Тухайн өдрийн чөлөө / амралт (StaffTimeOff) — хасагдана
 *   3. Салбарын хаалттай өдөр (BranchClosure) — бүтэн хасагдана
 *
 * Жишээ: 10:00–19:00 хуваарьтай ажилтан 2 цагийн чөлөө авбал 7 цаг гарна.
 * Бүтэн өдрийн чөлөө бол «Ирээгүй» гэж тэмдэглэгдэнэ.
 */

export type DayState = "WORK" | "DAY_OFF" | "ABSENT" | "CLOSED";

export type TimesheetCell = {
  dateKey: DateKey;
  state: DayState;
  /** Бодитоор ажилласан минут */
  minutes: number;
  /** Хуваарийн минут — чөлөө хасахын өмнөх */
  scheduledMinutes: number;
  /** Чөлөөгөөр хасагдсан минут */
  offMinutes: number;
  /** Чөлөө / хаалтын шалтгаан */
  note: string | null;
};

export type TimesheetRow = {
  staffId: string;
  name: string;
  position: string | null;
  color: string;
  branchName: string;
  cells: TimesheetCell[];
  totals: {
    minutes: number;
    /** Ядаж нэг цаг ажилласан өдрийн тоо */
    workedDays: number;
    /** Долоо хоногийн хуваариар амарсан өдөр */
    dayOffDays: number;
    /** Бүтэн өдөр ирээгүй (чөлөө/өвчтэй) */
    absentDays: number;
    /** Хэсэгчилсэн чөлөөгөөр хасагдсан нийт минут */
    offMinutes: number;
  };
};

/** Сарын бүх өдрийн түлхүүр. */
export function monthDays(monthKey: string): DateKey[] {
  const [year, month] = monthKey.split("-").map(Number);
  const days: DateKey[] = [];
  let cursor: DateKey = `${monthKey}-01`;
  while (true) {
    const [, m] = cursor.split("-").map(Number);
    if (m !== month) break;
    days.push(cursor);
    cursor = addDays(cursor, 1);
  }
  // `year` нь зөвхөн уншигчид ойлгомжтой байхад — цикл сараар зогсоно
  void year;
  return days;
}

/** `YYYY-MM` эсэхийг шалгах. */
export function isMonthKey(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

/** Тухайн агшны Улаанбаатар дахь сар (`YYYY-MM`). */
export function monthOf(dateKey: DateKey): string {
  return dateKey.slice(0, 7);
}

export async function getTimesheet(input: {
  monthKey: string;
  /** null бол бүх салбар */
  branchId: string | null;
}): Promise<TimesheetRow[]> {
  const days = monthDays(input.monthKey);
  if (days.length === 0) return [];

  const from = new Date(`${days[0]}T00:00:00.000Z`);
  const to = new Date(`${days[days.length - 1]}T00:00:00.000Z`);

  const [staff, closures] = await Promise.all([
    prisma.staff.findMany({
      where: {
        isActive: true,
        ...(input.branchId ? { branchId: input.branchId } : {}),
      },
      orderBy: [{ branchId: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        position: true,
        color: true,
        branchId: true,
        branch: { select: { name: true } },
        schedules: {
          select: { weekday: true, isDayOff: true, startMin: true, endMin: true },
        },
        timeOffs: {
          where: { date: { gte: from, lte: to } },
          select: { date: true, startMin: true, endMin: true, reason: true },
        },
      },
    }),
    prisma.branchClosure.findMany({
      where: {
        date: { gte: from, lte: to },
        isClosed: true,
        ...(input.branchId ? { branchId: input.branchId } : {}),
      },
      select: { branchId: true, date: true, reason: true },
    }),
  ]);

  // Салбар + өдрөөр хаалтын индекс
  const closedBy = new Map<string, string | null>();
  for (const closure of closures) {
    closedBy.set(
      `${closure.branchId}|${closure.date.toISOString().slice(0, 10)}`,
      closure.reason,
    );
  }

  return staff.map((member) => {
    const byWeekday = new Map(member.schedules.map((s) => [s.weekday, s]));

    // Өдрөөр нь чөлөөнүүдийг бүлэглэнэ — нэг өдөр хэд хэдэн чөлөөтэй байж болно
    const offsByDay = new Map<
      string,
      { startMin: number | null; endMin: number | null; reason: string | null }[]
    >();
    for (const off of member.timeOffs) {
      const key = off.date.toISOString().slice(0, 10);
      const list = offsByDay.get(key) ?? [];
      list.push(off);
      offsByDay.set(key, list);
    }

    const cells = days.map<TimesheetCell>((dateKey) => {
      const closureReason = closedBy.get(`${member.branchId}|${dateKey}`);
      const shift = byWeekday.get(weekdayOf(dateKey));
      const offs = offsByDay.get(dateKey) ?? [];
      const reason = offs.find((off) => off.reason)?.reason ?? null;

      if (closureReason !== undefined) {
        return {
          dateKey,
          state: "CLOSED",
          minutes: 0,
          scheduledMinutes: 0,
          offMinutes: 0,
          note: closureReason,
        };
      }

      if (!shift || shift.isDayOff) {
        return {
          dateKey,
          state: "DAY_OFF",
          minutes: 0,
          scheduledMinutes: 0,
          offMinutes: 0,
          note: null,
        };
      }

      const scheduledMinutes = Math.max(0, shift.endMin - shift.startMin);

      // Чөлөөг ээлжийн мужтай огтлолцуулж хасна
      const offMinutes = offs.reduce((sum, off) => {
        const start = Math.max(off.startMin ?? 0, shift.startMin);
        const end = Math.min(off.endMin ?? 24 * 60, shift.endMin);
        return sum + Math.max(0, end - start);
      }, 0);

      const minutes = Math.max(0, scheduledMinutes - offMinutes);

      return {
        dateKey,
        state: minutes === 0 ? "ABSENT" : "WORK",
        minutes,
        scheduledMinutes,
        offMinutes,
        note: reason,
      };
    });

    return {
      staffId: member.id,
      name: member.name,
      position: member.position,
      color: member.color,
      branchName: member.branch.name,
      cells,
      totals: {
        minutes: cells.reduce((sum, cell) => sum + cell.minutes, 0),
        workedDays: cells.filter((cell) => cell.state === "WORK").length,
        dayOffDays: cells.filter((cell) => cell.state === "DAY_OFF").length,
        absentDays: cells.filter((cell) => cell.state === "ABSENT").length,
        offMinutes: cells.reduce(
          (sum, cell) => sum + (cell.state === "WORK" ? cell.offMinutes : 0),
          0,
        ),
      },
    };
  });
}
