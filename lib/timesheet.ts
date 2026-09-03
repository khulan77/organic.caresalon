import "server-only";

import { prisma } from "@/lib/prisma";
import { addDays, todayKey, weekdayOf, type DateKey } from "@/lib/time";

/**
 * Ажилчдын цагийн бүртгэл — Excel-ийн хүснэгт шиг «ажилтан × өдөр» тор.
 *
 * Нэг өдрийн ажилласан цагийг дөрвөн эх сурвалжаас бодно:
 *   1. Ажилтны долоо хоногийн ҮНДСЭН хуваарь (StaffSchedule)
 *   2. Тухайн өдрийн ГАРААР тавьсан тэмдэглэгээ (StaffDayMark) — хуваарийг дарна
 *   3. Тухайн өдрийн чөлөө / амралт (StaffTimeOff) — хасагдана
 *   4. Салбарын хаалттай өдөр (BranchClosure) — бүтэн хасагдана
 *
 * Салонд амралтын өдөр тогтмол биш тул 2 дахь нь голлодог: ресепшн цагийн
 * бүртгэл дээрээс шууд «ажилласан / амралт / чөлөө» гэж сольдог.
 *
 * Жишээ: 10:00–19:00 хуваарьтай ажилтан 2 цагийн чөлөө авбал 7 цаг гарна.
 * Бүтэн өдрийн чөлөө бол «Ирээгүй» гэж тэмдэглэгдэнэ.
 *
 * ӨНӨӨДРӨӨС ХОЙШХ ажлын өдөр нь зөвхөн ХУВААРЬ болохоос ажилласан баримт биш.
 * Тиймээс `FUTURE` төлөвтэй гарч, ажилласан өдөрт тоологдохгүй — эс тэгвээс
 * ирэх сарыг харахад бүх өдөр «ажилласан» гэж харагдах байсан.
 */

export type DayState = "WORK" | "DAY_OFF" | "ABSENT" | "CLOSED" | "FUTURE";

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
  /** Гараар тэмдэглэсэн эсэх — хуваариар бодогдсоноос ялгахад */
  marked: boolean;
};

export type TimesheetRow = {
  staffId: string;
  name: string;
  position: string | null;
  color: string;
  branchId: string;
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

  const today = todayKey();

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
        // Гараар тавьсан өдрийн тэмдэглэгээ — хуваарийг дарна
        dayMarks: {
          where: { date: { gte: from, lte: to } },
          select: { date: true, kind: true, note: true },
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

    // Гараар тавьсан тэмдэглэгээ — өдрөөр индекслэнэ
    const markByDay = new Map(
      member.dayMarks.map((mark) => [
        mark.date.toISOString().slice(0, 10),
        mark,
      ]),
    );

    const cells = days.map<TimesheetCell>((dateKey) => {
      const closureReason = closedBy.get(`${member.branchId}|${dateKey}`);
      const shift = byWeekday.get(weekdayOf(dateKey));
      const offs = offsByDay.get(dateKey) ?? [];
      const reason = offs.find((off) => off.reason)?.reason ?? null;
      const mark = markByDay.get(dateKey);

      // Салбар хаалттай өдөр — ажилтны буруу биш, тэмдэглэгээнээс ч дээгүүр
      if (closureReason !== undefined) {
        return {
          dateKey,
          state: "CLOSED",
          minutes: 0,
          scheduledMinutes: 0,
          offMinutes: 0,
          note: closureReason,
          marked: false,
        };
      }

      // Гараар «амралт» эсвэл «чөлөө» гэсэн бол хуваарь хамаагүй
      if (mark && mark.kind !== "WORK") {
        return {
          dateKey,
          state: mark.kind === "DAY_OFF" ? "DAY_OFF" : "ABSENT",
          minutes: 0,
          scheduledMinutes: 0,
          offMinutes: 0,
          note: mark.note ?? reason,
          marked: true,
        };
      }

      /*
        Ажиллах цаг. Гараар «ажилласан» гэж тэмдэглэсэн бол долоо хоногийн
        хуваарь амралт байсан ч ажилласанд тооцно — тэр өдрийн ээлжийн цагийг
        хуваарийн мөрөөс авна (амралтын мөр ч эхлэх/дуусах цагаа хадгалдаг).
      */
      const marked = mark?.kind === "WORK";
      if (!marked && (!shift || shift.isDayOff)) {
        return {
          dateKey,
          state: "DAY_OFF",
          minutes: 0,
          scheduledMinutes: 0,
          offMinutes: 0,
          note: null,
          marked: false,
        };
      }

      const startMin = shift?.startMin ?? 600;
      const endMin = shift?.endMin ?? 1140;
      const scheduledMinutes = Math.max(0, endMin - startMin);

      // Чөлөөг ээлжийн мужтай огтлолцуулж хасна
      const offMinutes = offs.reduce((sum, off) => {
        const start = Math.max(off.startMin ?? 0, startMin);
        const end = Math.min(off.endMin ?? 24 * 60, endMin);
        return sum + Math.max(0, end - start);
      }, 0);

      const minutes = Math.max(0, scheduledMinutes - offMinutes);

      // Ирээдүйн ажлын өдөр — хараахан ажиллаагүй, зөвхөн хуваарь.
      // Гараар тэмдэглэсэн бол хүнийн шийдвэр тул тэрийг барина.
      if (dateKey > today && !marked) {
        return {
          dateKey,
          state: "FUTURE",
          minutes: 0,
          scheduledMinutes,
          offMinutes: 0,
          note: reason,
          marked: false,
        };
      }

      return {
        dateKey,
        state: minutes === 0 ? "ABSENT" : "WORK",
        minutes,
        scheduledMinutes,
        offMinutes,
        note: mark?.note ?? reason,
        marked,
      };
    });

    return {
      staffId: member.id,
      name: member.name,
      position: member.position,
      color: member.color,
      branchId: member.branchId,
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
