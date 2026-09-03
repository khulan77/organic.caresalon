import "server-only";

import { prisma } from "@/lib/prisma";
import { addDays, todayKey, weekdayOf, type DateKey } from "@/lib/time";

/**
 * Ажилчдын цагийн бүртгэл — «ажилтан × өдөр» тор.
 *
 * Өдөр бүр ХОЁРХОН утгатай: АЖИЛЛАСАН эсвэл АМАРСАН. Цалин өдрөөр бодогддог
 * тул үүнээс илүү нарийвчлал шаардлагагүй — цагийн чөлөө авсан ч тэр өдөр
 * ажилласанд тооцогдоно.
 *
 * Дараалал (дээрээс нь дарна):
 *   1. Гараар тавьсан тэмдэглэгээ (StaffDayMark) — ресепшний шийдвэр
 *   2. Салбарын хаалттай өдөр (BranchClosure) → амарсан
 *   3. Бүтэн өдрийн чөлөө (StaffTimeOff) → амарсан
 *   4. Долоо хоногийн үндсэн хуваарь (StaffSchedule)
 *
 * ӨНӨӨДРӨӨС ХОЙШХ өдөр нь `FUTURE` — хараахан болоогүй тул ажилласан өдөрт
 * тоологдохгүй. Гараар тэмдэглэсэн бол хүний шийдвэрийг барина.
 *
 * Тэмдэглэгээ нь ХУАНЛИТАЙ холбоотой: «амарсан» гэж тэмдэглэсэн ажилтан тэр
 * өдрийн хуанлиас алга болж, шинэ захиалга ч авахгүй болно (`lib/day-shift`).
 */

export type DayState = "WORK" | "DAY_OFF" | "FUTURE";

export type TimesheetCell = {
  dateKey: DateKey;
  state: DayState;
  /** Тухайн өдрийн ээлжийн минут — ажилласан өдөрт л утгатай */
  minutes: number;
  /** Амралт / хаалтын шалтгаан */
  note: string | null;
  /** Гараар тэмдэглэсэн эсэх — хуваариар бодогдсоноос ялгахад */
  marked: boolean;
  /**
   * ТэмдэглэгээГҮЙ бол энэ өдөр юу болох байсан бэ — хуваарь, хаалт, чөлөөгөөр
   * бодогдсон СУУРЬ төлөв. Тэмдэглэгээг арилгахад нүд юу болохыг клиент урьдчилж
   * мэдэхэд хэрэгтэй (`marked` худал бол `state`-тэй үргэлж тэнцүү).
   */
  base: DayState;
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
    /** Ажилласан өдрийн тоо */
    workedDays: number;
    /** Амарсан өдрийн тоо */
    dayOffDays: number;
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
      const shift = byWeekday.get(weekdayOf(dateKey));
      const startMin = shift?.startMin ?? 600;
      const endMin = shift?.endMin ?? 1140;
      const minutes = Math.max(0, endMin - startMin);

      /**
       * СУУРЬ төлөв — гараар тэмдэглээгүй бол өдөр юу болох вэ.
       * Тэмдэглэгээ үүнийг дарна, гэхдээ арилгах үед буцаад энэ нь үлдэнэ.
       */
      const base = ((): { state: DayState; note: string | null } => {
        // 1. Салбар хаалттай өдөр — амарсанд тооцно
        const closureReason = closedBy.get(`${member.branchId}|${dateKey}`);
        if (closureReason !== undefined) {
          return {
            state: "DAY_OFF",
            note: closureReason ?? "Салбар хаалттай",
          };
        }

        // 2. Долоо хоногийн хуваарийн амралт
        if (!shift || shift.isDayOff) return { state: "DAY_OFF", note: null };

        /*
          3. Бүтэн өдрийн чөлөө — амарсанд тооцно. ХЭСЭГЧИЛСЭН чөлөө (2 цаг
          эмнэлэг г.м.) тооцоонд ОРОХГҮЙ: тэр өдөр ажилласан хэвээр.
        */
        const offs = offsByDay.get(dateKey) ?? [];
        const wholeDayOff = offs.find(
          (off) =>
            (off.startMin ?? 0) <= startMin && (off.endMin ?? 24 * 60) >= endMin,
        );
        if (wholeDayOff) return { state: "DAY_OFF", note: wholeDayOff.reason };

        // 4. Ирээдүйн ажлын өдөр — хараахан ажиллаагүй, зөвхөн хуваарь
        if (dateKey > today) return { state: "FUTURE", note: null };

        return {
          state: "WORK",
          note: offs.find((off) => off.reason)?.reason ?? null,
        };
      })();

      // Гараар тавьсан нь бүхнээс дээгүүр — ресепшний шийдвэр
      const mark = markByDay.get(dateKey);
      if (mark) {
        const worked = mark.kind === "WORK";
        return {
          dateKey,
          state: worked ? "WORK" : "DAY_OFF",
          minutes: worked ? minutes : 0,
          note: mark.note ?? base.note,
          marked: true,
          base: base.state,
        };
      }

      return {
        dateKey,
        state: base.state,
        minutes: base.state === "WORK" ? minutes : 0,
        note: base.note,
        marked: false,
        base: base.state,
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
      },
    };
  });
}
