/**
 * Цагийн бүсийн хөрвүүлэлт.
 *
 * ДҮРЭМ: өгөгдлийн санд бүх агшин (Appointment.startAt/endAt) UTC-д хадгалагдана.
 * Хэрэглэгчид харагдах бүх цаг Улаанбаатарын локал цаг байна.
 *
 * Ажлын цаг (openMin, startMin гэх мэт) нь ЛОКАЛ шөнө дундаас хойшх минут:
 * 600 = 10:00, 1140 = 19:00.
 */

export const TIMEZONE = "Asia/Ulaanbaatar";

/** `YYYY-MM-DD` хэлбэрийн локал хуанлийн өдөр. */
export type DateKey = string;

const partsFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIMEZONE,
  hour12: false,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

type LocalParts = {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
};

/** Тухайн агшны Улаанбаатар дахь хуанлийн хэсгүүдийг гаргана. */
function localParts(instant: Date): LocalParts {
  const parts = partsFormatter.formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    // 24 цагийн формат заримдаа шөнө дундыг "24" гэж өгдөг
    hour: get("hour") % 24,
    minute: get("minute"),
    second: get("second"),
  };
}

/** Тухайн агшинд UTC-аас локал цаг хэдэн миллисекундээр урд байгаа. */
function offsetMs(instant: Date): number {
  const p = localParts(instant);
  const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asIfUtc - instant.getTime();
}

/**
 * Локал хана цагийг (өдөр + минут) UTC агшин болгоно.
 *
 * Шилжилтийн (DST) ирмэгт зөв ажиллахын тулд офсетийг хоёр удаа тооцно.
 * Монгол улс одоогоор зуны цаг хэрэглэдэггүй тул энэ нь нэмэлт баталгаа юм.
 */
export function localToUtc(dateKey: DateKey, minutes: number): Date {
  const [year, month, day] = dateKey.split("-").map(Number);
  const wallAsUtc = Date.UTC(year, month - 1, day, 0, minutes);
  let instant = new Date(wallAsUtc - offsetMs(new Date(wallAsUtc)));
  instant = new Date(wallAsUtc - offsetMs(instant));
  return instant;
}

/** UTC агшныг локал `YYYY-MM-DD` болгоно. */
export function toDateKey(instant: Date): DateKey {
  const p = localParts(instant);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** UTC агшны локал шөнө дундаас хойшх минут. */
export function toLocalMinutes(instant: Date): number {
  const p = localParts(instant);
  return p.hour * 60 + p.minute;
}

/** Локал өдрийн 7 хоногийн дугаар: 0 = Ням … 6 = Бямба. */
export function weekdayOf(dateKey: DateKey): number {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** Локал хуанлийн өдрийн UTC муж — `[эхлэл, дараагийн өдрийн эхлэл)`. */
export function dayRangeUtc(dateKey: DateKey): { start: Date; end: Date } {
  return {
    start: localToUtc(dateKey, 0),
    end: localToUtc(addDays(dateKey, 1), 0),
  };
}

/** Өдөр нэмэх / хасах. */
export function addDays(dateKey: DateKey, amount: number): DateKey {
  const [year, month, day] = dateKey.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + amount));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}-${String(shifted.getUTCDate()).padStart(2, "0")}`;
}

/** Улаанбаатарын өнөөдөр. */
export function todayKey(): DateKey {
  return toDateKey(new Date());
}

/** Минутыг `HH:MM` болгоно. 630 → "10:30" */
export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** `HH:MM`-ийг минут болгоно. "10:30" → 630 */
export function parseMinutes(value: string): number {
  const [h, m] = value.split(":").map(Number);
  return h * 60 + m;
}

/** `YYYY-MM-DD` эсэхийг шалгах. */
export function isDateKey(value: unknown): value is DateKey {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}
