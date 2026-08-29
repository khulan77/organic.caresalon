import "server-only";

import { prisma } from "@/lib/prisma";
import { dayRangeUtc, toDateKey, type DateKey } from "@/lib/time";

/**
 * Админы тайлан — ЗӨВХӨН ОРЛОГО.
 *
 * Гурван асуултад хариулна:
 *   1. Энэ хугацаанд хэдэн төгрөг орлоо? (үйлчилгээ + нэмэлт төлбөр)
 *   2. Өдрүүдээр яаж хуваарилагдсан бэ? (график)
 *   3. Аль үйлчилгээ / аль ажилтан хэдийг оруулсан бэ?
 *
 * Цуцлагдсан ба ирээгүй захиалга орлогод ОРОХГҮЙ.
 *
 * Бүх нэгтгэлийг САНГААС нэг удаа уншаад JS дээр бодно. Салоны нэг сарын
 * захиалгын тоо цөөн тул энэ нь олон `groupBy` асуулгаас хялбар бөгөөд
 * локал цагийн бүсээр өдөр таслах тооцоог зөв гаргана.
 */

export type ReportRange = {
  fromKey: DateKey;
  toKey: DateKey;
  /** null бол бүх салбар. */
  branchId: string | null;
};

/** Орлогын задаргаа — хаана ч ижил бүтэцтэй. */
export type Revenue = {
  /** Үйлчилгээний дүн */
  services: number;
  /** Нэмэлт төлбөр (урт хумс, материал г.м.) */
  extra: number;
  /** Нийт = services + extra */
  total: number;
};

export type ReportDay = Revenue & {
  dateKey: DateKey;
  /** Ирэлтийн тоо — хамтарсан захиалга нэгээр тоологдоно */
  visits: number;
};

export type ReportService = {
  name: string;
  count: number;
  amount: number;
};

export type ReportStaff = Revenue & {
  id: string;
  name: string;
  color: string;
  visits: number;
};

const zero = (): Revenue => ({ services: 0, extra: 0, total: 0 });

function add(target: Revenue, row: { subtotal: number; extraTotal: number }) {
  target.services += row.subtotal;
  target.extra += row.extraTotal;
  target.total += row.subtotal + row.extraTotal;
}

export async function getReport(range: ReportRange) {
  const start = dayRangeUtc(range.fromKey).start;
  const end = dayRangeUtc(range.toKey).end;

  const appointments = await prisma.appointment.findMany({
    where: {
      startAt: { gte: start, lt: end },
      // Цуцлагдсан, ирээгүй нь орлого биш
      status: { notIn: ["CANCELLED", "NO_SHOW"] },
      ...(range.branchId ? { branchId: range.branchId } : {}),
    },
    orderBy: { startAt: "asc" },
    select: {
      id: true,
      startAt: true,
      groupId: true,
      subtotal: true,
      extraTotal: true,
      staff: { select: { id: true, name: true, color: true } },
      items: { select: { name: true, price: true } },
    },
  });

  const total = zero();
  /** Хамтарсан захиалга НЭГ ирэлт — хоёр мөр байсан ч нэг удаа тоологдоно. */
  const visits = new Set<string>();

  const byDay = new Map<DateKey, ReportDay>();
  const byService = new Map<string, ReportService>();
  const byStaff = new Map<string, ReportStaff>();

  for (const appt of appointments) {
    const visitKey = appt.groupId ?? appt.id;
    const newVisit = !visits.has(visitKey);
    visits.add(visitKey);

    add(total, appt);

    // ── Өдрөөр ──
    const dateKey = toDateKey(appt.startAt);
    let day = byDay.get(dateKey);
    if (!day) {
      day = { dateKey, visits: 0, ...zero() };
      byDay.set(dateKey, day);
    }
    add(day, appt);
    if (newVisit) day.visits += 1;

    // ── Ажилтнаар ──
    let member = byStaff.get(appt.staff.id);
    if (!member) {
      member = {
        id: appt.staff.id,
        name: appt.staff.name,
        color: appt.staff.color,
        visits: 0,
        ...zero(),
      };
      byStaff.set(appt.staff.id, member);
    }
    add(member, appt);
    if (newVisit) member.visits += 1;

    // ── Үйлчилгээгээр ── нэрээр нэгтгэнэ: үйлчилгээ устсан ч түүх үлдэнэ
    for (const item of appt.items) {
      const row = byService.get(item.name) ?? {
        name: item.name,
        count: 0,
        amount: 0,
      };
      row.count += 1;
      row.amount += item.price;
      byService.set(item.name, row);
    }
  }

  return {
    total,
    visits: visits.size,
    // График цаг хугацааны дарааллаар явна
    days: [...byDay.values()].sort((a, b) =>
      a.dateKey.localeCompare(b.dateKey),
    ),
    // Задаргаа нь их дүнгээсээ эхэлнэ
    services: [...byService.values()].sort((a, b) => b.amount - a.amount),
    staff: [...byStaff.values()].sort((a, b) => b.total - a.total),
  };
}

export type Report = Awaited<ReturnType<typeof getReport>>;
