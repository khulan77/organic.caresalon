import type { AppointmentStatus, Role } from "@/lib/generated/prisma/enums";

/** 7 хоногийн өдрүүд — индекс нь `Date.getUTCDay()`-тэй тохирно (0 = Ням). */
export const WEEKDAYS = [
  "Ням",
  "Даваа",
  "Мягмар",
  "Лхагва",
  "Пүрэв",
  "Баасан",
  "Бямба",
] as const;

export const WEEKDAYS_SHORT = ["Ня", "Да", "Мя", "Лх", "Пү", "Ба", "Бя"] as const;

export const MONTHS = [
  "1 сар",
  "2 сар",
  "3 сар",
  "4 сар",
  "5 сар",
  "6 сар",
  "7 сар",
  "8 сар",
  "9 сар",
  "10 сар",
  "11 сар",
  "12 сар",
] as const;

/** Захиалгын төлөвийн монгол нэр ба өнгө. */
export const STATUS_LABELS: Record<
  AppointmentStatus,
  { label: string; color: string; bg: string }
> = {
  BOOKED: { label: "Захиалсан", color: "#5c5850", bg: "#eeebe5" },
  CONFIRMED: { label: "Баталгаажсан", color: "#3e5a47", bg: "#dee6e0" },
  ARRIVED: { label: "Ирсэн", color: "#3f7a6e", bg: "#dff0ec" },
  COMPLETED: { label: "Дууссан", color: "#4a6b53", bg: "#e7eee9" },
  CANCELLED: { label: "Цуцалсан", color: "#9a5555", bg: "#f6e8e8" },
  NO_SHOW: { label: "Ирээгүй", color: "#986438", bg: "#f6ead9" },
};

/** Хуанли дээр зай эзэлдэг (идэвхтэй) төлөвүүд. Давхцал шалгахад ашиглана. */
export const ACTIVE_STATUSES: AppointmentStatus[] = [
  "BOOKED",
  "CONFIRMED",
  "ARRIVED",
  "COMPLETED",
];

export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: "Админ",
  RECEPTION: "Ресепшн",
};

/** Огноог "8 сарын 25, Мягмар" хэлбэрээр. */
export function formatDateLong(dateKey: string): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return `${month} сарын ${day}, ${WEEKDAYS[weekday]}`;
}

/** Огноог "25 / 08 / 2026" ба гаригаар нь тусад нь буцаана. */
export function formatDateNumeric(dateKey: string): {
  date: string;
  weekday: string;
} {
  const [year, month, day] = dateKey.split("-").map(Number);
  const index = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return {
    date: `${String(day).padStart(2, "0")} / ${String(month).padStart(2, "0")} / ${year}`,
    weekday: WEEKDAYS[index],
  };
}

/** Огноог "2026 оны 8 сарын 25" хэлбэрээр. */
export function formatDateFull(dateKey: string): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  return `${year} оны ${month} сарын ${day}`;
}

/** Үнийг "45,000₮" хэлбэрээр. */
export function formatPrice(amount: number): string {
  return `${amount.toLocaleString("mn-MN")}₮`;
}

/** Хугацааг "1ц 30м" хэлбэрээр. */
export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}м`;
  if (m === 0) return `${h}ц`;
  return `${h}ц ${m}м`;
}
