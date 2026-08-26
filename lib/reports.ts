import "server-only";

import { prisma } from "@/lib/prisma";
import { dayRangeUtc, toDateKey, type DateKey } from "@/lib/time";
import type {
  AppointmentStatus,
  PaymentMethod,
} from "@/lib/generated/prisma/enums";

/**
 * Админы тайлан — сонгосон хугацааны үнэ, орлого, ажилтны ачааллын нэгтгэл.
 *
 * Бүх нэгтгэлийг САНГААС нэг удаа уншаад JS дээр бодно. Салоны нэг сарын
 * захиалгын тоо цөөн тул энэ нь олон `groupBy` асуулгаас хялбар бөгөөд
 * «ажилласан өдөр» гэх мэт локал цагаас хамаарсан тооцоог зөв гаргана.
 */

/** Орлого нь БОДИТООР орсон гэж үзэх төлөв. */
const REALIZED: AppointmentStatus[] = ["COMPLETED"];

/** Хараахан дуусаагүй ч орлого болох нь хүлээгдэж буй төлөвүүд. */
const PENDING: AppointmentStatus[] = ["BOOKED", "CONFIRMED", "ARRIVED"];

export type ReportRange = {
  fromKey: DateKey;
  toKey: DateKey;
  /** null бол бүх салбар. */
  branchId: string | null;
};

/** Мөнгөн дүнгүүдийн нэгдсэн хэлбэр — хүснэгт бүрт давтагдана. */
type Money = {
  /** Үйлчилгээний нийлбэр — хөнгөлөлтийн ӨМНӨХ */
  subtotal: number;
  /** Нэмэлт төлбөр (материал, урт хумс г.м.) */
  extra: number;
  discount: number;
  /** Төлөх дүн = subtotal + extra − discount */
  total: number;
};

const zeroMoney = (): Money => ({
  subtotal: 0,
  extra: 0,
  discount: 0,
  total: 0,
});

function addMoney(
  target: Money,
  appt: {
    subtotal: number;
    extraTotal: number;
    discount: number;
    totalPrice: number;
  },
): void {
  target.subtotal += appt.subtotal;
  target.extra += appt.extraTotal;
  target.discount += appt.discount;
  target.total += appt.totalPrice;
}

export async function getReport(range: ReportRange) {
  const start = dayRangeUtc(range.fromKey).start;
  const end = dayRangeUtc(range.toKey).end;

  const appointments = await prisma.appointment.findMany({
    where: {
      startAt: { gte: start, lt: end },
      ...(range.branchId ? { branchId: range.branchId } : {}),
    },
    orderBy: { startAt: "asc" },
    select: {
      id: true,
      startAt: true,
      endAt: true,
      status: true,
      groupId: true,
      subtotal: true,
      extraTotal: true,
      discount: true,
      totalPrice: true,
      staff: { select: { id: true, name: true, color: true } },
      branch: { select: { id: true, name: true } },
      items: { select: { name: true, price: true, durationMin: true } },
      payments: { select: { amount: true, method: true } },
    },
  });

  const realized = zeroMoney();
  const pending = zeroMoney();
  let realizedCount = 0;
  let pendingCount = 0;
  let cancelledCount = 0;
  let noShowCount = 0;
  /** Цуцлагдсан захиалгын алдагдсан боломжит дүн */
  let lostTotal = 0;

  /**
   * Бодитоор ГАРТ ОРСОН мөнгө — `Payment` мөрүүдийн нийлбэр.
   * Захиалгын дүнгээс тусдаа: дутуу төлсөн, урьдчилгаа авсан нь эндээс харагдана.
   */
  let collected = 0;
  const byMethod = new Map<PaymentMethod, number>();

  /**
   * Хамтарсан захиалга нэг ИРЭЛТ — хоёр мөр байсан ч нэг л удаа тоологдоно.
   * Мөнгө нь мөрүүдэд хуваарилагдсан тул дүнг давхардуулахгүй нэмнэ.
   */
  const visits = new Set<string>();

  // Ажилтан, үйлчилгээ, салбар, өдрөөр нэгтгэх сав
  const byStaff = new Map<
    string,
    {
      id: string;
      name: string;
      color: string;
      /** Ядаж нэг захиалга авсан ӨӨР ӨӨР локал өдрүүд */
      days: Set<DateKey>;
      appointments: number;
      minutes: number;
      money: Money;
    }
  >();
  const byService = new Map<string, { name: string; count: number; amount: number }>();
  const byBranch = new Map<
    string,
    { id: string; name: string; appointments: number; money: Money }
  >();
  const byDay = new Map<DateKey, { appointments: number; total: number }>();

  for (const appt of appointments) {
    const isRealized = REALIZED.includes(appt.status);
    const isPending = PENDING.includes(appt.status);
    const visitKey = appt.groupId ?? appt.id;

    // Төлбөр цуцлагдсан захиалгад ч бүртгэгдсэн байж болно (буцаагаагүй
    // урьдчилгаа) — тиймээс төлөвөөс үл хамааран тоолно.
    for (const payment of appt.payments) {
      collected += payment.amount;
      byMethod.set(
        payment.method,
        (byMethod.get(payment.method) ?? 0) + payment.amount,
      );
    }

    if (appt.status === "CANCELLED") {
      if (!visits.has(visitKey)) cancelledCount += 1;
      visits.add(visitKey);
      lostTotal += appt.totalPrice;
      continue; // Цуцлагдсан захиалга ачаалал ба орлогод орохгүй
    }
    if (appt.status === "NO_SHOW") {
      if (!visits.has(visitKey)) noShowCount += 1;
      visits.add(visitKey);
      lostTotal += appt.totalPrice;
      continue;
    }

    // Дүнг мөр бүрээр нэмнэ (хуваарилагдсан), тоог зөвхөн ШИНЭ ирэлт дээр
    const newVisit = !visits.has(visitKey);
    visits.add(visitKey);

    if (isRealized) {
      addMoney(realized, appt);
      if (newVisit) realizedCount += 1;
    } else if (isPending) {
      addMoney(pending, appt);
      if (newVisit) pendingCount += 1;
    }

    const dateKey = toDateKey(appt.startAt);
    const minutes = Math.round(
      (appt.endAt.getTime() - appt.startAt.getTime()) / 60_000,
    );

    // ── Ажилтан ──
    let staffRow = byStaff.get(appt.staff.id);
    if (!staffRow) {
      staffRow = {
        id: appt.staff.id,
        name: appt.staff.name,
        color: appt.staff.color,
        days: new Set(),
        appointments: 0,
        minutes: 0,
        money: zeroMoney(),
      };
      byStaff.set(appt.staff.id, staffRow);
    }
    staffRow.days.add(dateKey);
    staffRow.appointments += 1;
    staffRow.minutes += minutes;
    addMoney(staffRow.money, appt);

    // ── Салбар ──
    let branchRow = byBranch.get(appt.branch.id);
    if (!branchRow) {
      branchRow = {
        id: appt.branch.id,
        name: appt.branch.name,
        appointments: 0,
        money: zeroMoney(),
      };
      byBranch.set(appt.branch.id, branchRow);
    }
    if (newVisit) branchRow.appointments += 1;
    addMoney(branchRow.money, appt);

    // ── Үйлчилгээ ── нэрээр нэгтгэнэ: үйлчилгээ устсан ч түүх үлдэнэ
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

    // ── Өдөр ──
    const dayRow = byDay.get(dateKey) ?? { appointments: 0, total: 0 };
    if (newVisit) dayRow.appointments += 1;
    dayRow.total += appt.totalPrice;
    byDay.set(dateKey, dayRow);
  }

  const staffRows = [...byStaff.values()]
    .map(({ days, ...rest }) => ({ ...rest, workedDays: days.size }))
    .sort((a, b) => b.money.total - a.money.total);

  return {
    summary: {
      realized,
      pending,
      realizedCount,
      pendingCount,
      cancelledCount,
      noShowCount,
      lostTotal,
      /** Дууссан захиалгын дундаж дүн */
      averageTicket:
        realizedCount > 0 ? Math.round(realized.total / realizedCount) : 0,
      /** Бодитоор гарт орсон мөнгө */
      collected,
      /** Хүлээгдэж буй ба дууссан захиалгын нийт дүнгээс төлөгдөөгүй үлдэгдэл */
      outstanding: realized.total + pending.total - collected,
    },
    payments: [...byMethod.entries()]
      .map(([method, amount]) => ({ method, amount }))
      .sort((a, b) => b.amount - a.amount),
    staff: staffRows,
    services: [...byService.values()].sort((a, b) => b.amount - a.amount),
    branches: [...byBranch.values()].sort((a, b) => b.money.total - a.money.total),
    days: [...byDay.entries()]
      .map(([dateKey, value]) => ({ dateKey, ...value }))
      .sort((a, b) => a.dateKey.localeCompare(b.dateKey)),
  };
}

export type Report = Awaited<ReturnType<typeof getReport>>;
