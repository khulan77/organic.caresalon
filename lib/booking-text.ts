/**
 * Үйлчлүүлэгч рүү илгээх «захиалга баталгаажлаа» мессежийг угсарна.
 *
 * Ресепшн үүнийг нэг товчоор хуулж аваад Messenger / мессежээр илгээнэ.
 * Хамтарсан захиалгын хувьд бүлгийн БҮХ мөрийн үйлчилгээ багтана — үйлчлүүлэгч
 * нэг ирэлтдээ юу авахаа бүтнээр нь харна.
 */

import { formatDateFull, formatDuration, formatPrice } from "@/lib/labels";
import { formatMinutes, toDateKey, toLocalMinutes } from "@/lib/time";

export type BookingLine = {
  staffName: string;
  items: { name: string; price: number; durationMin: number }[];
};

export type BookingTextInput = {
  clientName: string;
  branchName?: string | null;
  startAt: Date;
  endAt: Date;
  /** Бүлгийн мөрүүд — ганц захиалга бол нэг элемент */
  lines: BookingLine[];
  extraTotal: number;
  totalPrice: number;
  paid: number;
};

/** Хуулж авах бэлэн текст. */
export function buildBookingText(input: BookingTextInput): string {
  const dateKey = toDateKey(input.startAt);
  const startMin = toLocalMinutes(input.startAt);
  const endLocal = toLocalMinutes(input.endAt);
  const endMin = endLocal <= startMin ? 24 * 60 : endLocal;

  const rows: string[] = [
    "Захиалга баталгаажлаа ✅",
    "",
    `Үйлчлүүлэгч: ${input.clientName}`,
    `Огноо: ${formatDateFull(dateKey)}`,
    `Цаг: ${formatMinutes(startMin)}–${formatMinutes(endMin)} (${formatDuration(endMin - startMin)})`,
  ];

  if (input.branchName) rows.push(`Салбар: ${input.branchName}`);

  const staffNames = [...new Set(input.lines.map((line) => line.staffName))];
  if (staffNames.length > 0) rows.push(`Мастер: ${staffNames.join(", ")}`);

  rows.push("", "Үйлчилгээ:");
  for (const line of input.lines) {
    for (const item of line.items) {
      const who = staffNames.length > 1 ? ` — ${line.staffName}` : "";
      rows.push(`• ${item.name}${who} — ${formatPrice(item.price)}`);
    }
  }

  if (input.extraTotal > 0) {
    rows.push(`• Нэмэлт төлбөр — ${formatPrice(input.extraTotal)}`);
  }

  rows.push("", `Нийт төлбөр: ${formatPrice(input.totalPrice)}`);

  const due = input.totalPrice - input.paid;
  if (input.paid > 0) {
    rows.push(`Төлсөн: ${formatPrice(input.paid)}`);
    rows.push(
      due > 0
        ? `Үлдэгдэл: ${formatPrice(due)}`
        : due < 0
          ? `Илүү төлсөн: ${formatPrice(-due)}`
          : "Төлбөр бүрэн төлөгдсөн.",
    );
  }

  return rows.join("\n");
}
