import "server-only";

import { prisma } from "@/lib/prisma";
import { ACTIVE_STATUSES } from "@/lib/labels";
import {
  addDays,
  dayRangeUtc,
  todayKey,
  weekdayOf,
  type DateKey,
} from "@/lib/time";

/** Хуанлийн толгойд харагдах салбаруудын жагсаалт. */
export async function getBranches() {
  return prisma.branch.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      address: true,
      phone: true,
      openMin: true,
      closeMin: true,
    },
  });
}

export type BranchSummary = Awaited<ReturnType<typeof getBranches>>[number];

/**
 * Нэг салбарын нэг өдрийн хуанлийн бүх өгөгдөл.
 *
 * Ажилтан бүрийн тухайн өдрийн ажлын цаг, чөлөө, захиалгуудыг нэг дор буцаана.
 */
export async function getDaySchedule(branchId: string, dateKey: DateKey) {
  const { start, end } = dayRangeUtc(dateKey);
  const dateOnly = new Date(`${dateKey}T00:00:00.000Z`);
  const weekday = weekdayOf(dateKey);

  const [staff, appointments, closure] = await Promise.all([
    prisma.staff.findMany({
      where: { branchId, isActive: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        position: true,
        color: true,
        schedules: {
          where: { weekday },
          select: { isDayOff: true, startMin: true, endMin: true },
        },
        timeOffs: {
          where: { date: dateOnly },
          select: { startMin: true, endMin: true, reason: true },
        },
      },
    }),
    prisma.appointment.findMany({
      where: {
        branchId,
        // Өдрийн мужид оролцож буй бүх захиалга
        startAt: { lt: end },
        endAt: { gt: start },
      },
      orderBy: { startAt: "asc" },
      select: {
        id: true,
        staffId: true,
        startAt: true,
        endAt: true,
        status: true,
        note: true,
        groupId: true,
        isPrimary: true,
        createdAt: true,
        cancelledAt: true,
        cancelReason: true,
        cancelledBy: { select: { name: true } },
        subtotal: true,
        extraTotal: true,
        discount: true,
        discountNote: true,
        totalPrice: true,
        client: { select: { id: true, name: true, phone: true, note: true } },
        // Нэмэлт төлбөр — захиалгын цонхонд засагдана
        charges: {
          orderBy: { createdAt: "asc" },
          select: { id: true, label: true, amount: true },
        },
        // Төлбөрийн бичилтүүд — урьдчилгаа, үлдэгдэл
        payments: {
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            amount: true,
            method: true,
            isDeposit: true,
            note: true,
            createdAt: true,
            receivedBy: { select: { name: true } },
          },
        },
        items: {
          orderBy: { sortOrder: "asc" },
          select: {
            id: true,
            name: true,
            price: true,
            durationMin: true,
            // Блокийн өнгө — үйлчилгээнийх, эс бөгөөс ангиллынх
            service: {
              select: {
                color: true,
                category: { select: { color: true } },
              },
            },
          },
        },
      },
    }),
    prisma.branchClosure.findUnique({
      where: { branchId_date: { branchId, date: dateOnly } },
      select: { isClosed: true, openMin: true, closeMin: true, reason: true },
    }),
  ]);

  return { staff, appointments, closure };
}

export type DaySchedule = Awaited<ReturnType<typeof getDaySchedule>>;
export type DayStaff = DaySchedule["staff"][number];
export type DayAppointment = DaySchedule["appointments"][number];

/**
 * 15 / 30 хоногийн тойм — өдөр тус бүрийн захиалгын тоо, орлого, ачаалал.
 * Ресепшн ойрын хугацааны ачааллыг нэг харцаар харахад зориулав.
 */
export async function getRangeOverview(
  branchId: string,
  fromKey: DateKey,
  days: number,
) {
  const start = dayRangeUtc(fromKey).start;
  const end = dayRangeUtc(addDays(fromKey, days - 1)).end;

  const [appointments, staffCount] = await Promise.all([
    prisma.appointment.findMany({
      where: {
        branchId,
        status: { in: ACTIVE_STATUSES },
        startAt: { gte: start, lt: end },
      },
      orderBy: { startAt: "asc" },
      select: { startAt: true, endAt: true, totalPrice: true, status: true },
    }),
    prisma.staff.count({ where: { branchId, isActive: true } }),
  ]);

  return { appointments, staffCount };
}

/**
 * Захиалга үүсгэх цонхонд хэрэгтэй үйлчилгээний жагсаалт.
 *
 * Тухайн САЛБАРЫН үйлчилгээ ба бүх салбарт нийтлэг (branchId = null)
 * үйлчилгээнүүд л орно. Хоосон үлдсэн ангиллыг гаргахгүй.
 */
export async function getServiceCatalog(branchId: string) {
  const categories = await prisma.serviceCategory.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      color: true,
      services: {
        where: {
          isActive: true,
          OR: [{ branchId: null }, { branchId }],
        },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        select: {
          id: true,
          name: true,
          price: true,
          salePrice: true,
          saleEndsAt: true,
          durationMin: true,
          color: true,
        },
      },
    },
  });

  return categories.filter((category) => category.services.length > 0);
}

/** Админы удирдлагын хуудсанд — идэвхгүйг ч оруулаад бүх үйлчилгээ. */
export async function getServiceAdmin() {
  return prisma.serviceCategory.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      color: true,
      sortOrder: true,
      services: {
        orderBy: [{ branchId: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
        select: {
          id: true,
          name: true,
          price: true,
          salePrice: true,
          saleEndsAt: true,
          durationMin: true,
          color: true,
          isActive: true,
          branchId: true,
          branch: { select: { name: true } },
          _count: { select: { items: true } },
        },
      },
    },
  });
}

export type ServiceAdmin = Awaited<ReturnType<typeof getServiceAdmin>>;

/** Ажилтны хуудас — салбараар бүлэглэсэн, хуваарь ба чөлөөтэй нь. */
export async function getStaffAdmin() {
  const today = new Date(`${todayKey()}T00:00:00.000Z`);

  return prisma.branch.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      openMin: true,
      closeMin: true,
      staff: {
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        select: {
          id: true,
          name: true,
          phone: true,
          position: true,
          color: true,
          isActive: true,
          branchId: true,
          schedules: {
            orderBy: { weekday: "asc" },
            select: {
              weekday: true,
              isDayOff: true,
              startMin: true,
              endMin: true,
            },
          },
          timeOffs: {
            where: { date: { gte: today } },
            orderBy: { date: "asc" },
            select: {
              id: true,
              date: true,
              startMin: true,
              endMin: true,
              reason: true,
            },
          },
          _count: { select: { appointments: true } },
        },
      },
    },
  });
}

export type StaffAdmin = Awaited<ReturnType<typeof getStaffAdmin>>;
export type StaffMember = StaffAdmin[number]["staff"][number];

export type ServiceCatalog = Awaited<ReturnType<typeof getServiceCatalog>>;

/**
 * Системд нэвтрэх эрхтэй хэрэглэгчид (админ, ресепшн).
 * `passwordHash` ЭНД ОРОХГҮЙ — client рүү хэзээ ч явуулахгүй.
 */
export async function getUsersAdmin() {
  return prisma.user.findMany({
    orderBy: [{ role: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      phone: true,
      role: true,
      branchId: true,
      isActive: true,
      mustChangePassword: true,
      lastLoginAt: true,
      branch: { select: { name: true } },
      _count: { select: { createdAppts: true } },
    },
  });
}

export type UsersAdmin = Awaited<ReturnType<typeof getUsersAdmin>>;
export type UserRow = UsersAdmin[number];

/** Үйлчлүүлэгчийг нэр эсвэл утсаар хайх (захиалга үүсгэх цонхонд). */
export async function searchClients(query: string, limit = 8) {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const digits = trimmed.replace(/\D/g, "");

  return prisma.client.findMany({
    where: {
      OR: [
        { name: { contains: trimmed, mode: "insensitive" } },
        ...(digits ? [{ phone: { contains: digits } }] : []),
      ],
    },
    orderBy: { name: "asc" },
    take: limit,
    select: { id: true, name: true, phone: true, note: true },
  });
}
