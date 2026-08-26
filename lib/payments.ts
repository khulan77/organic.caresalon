import type { PaymentMethod } from "@/lib/generated/prisma/enums";

/**
 * Захиалгын төлбөрийн тооцоо.
 *
 * ДҮРЭМ: төлөх дүн = үйлчилгээ (subtotal) + нэмэлт төлбөр (extraTotal) − хөнгөлөлт.
 * Төлсөн дүн нь `Payment` мөрүүдийн НИЙЛБЭР — хаана ч давхар хадгалахгүй,
 * ингэснээр тоо хэзээ ч зөрөхгүй.
 */

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  CASH: "Бэлэн",
  CARD: "Карт",
  TRANSFER: "Данс / QR",
  OTHER: "Бусад",
};

/** Сонгох цэсэнд гарах дараалал. */
export const PAYMENT_METHODS: PaymentMethod[] = [
  "CASH",
  "CARD",
  "TRANSFER",
  "OTHER",
];

/** Төлбөрийн явц. */
export type PaymentState = "UNPAID" | "PARTIAL" | "PAID" | "OVERPAID";

export const PAYMENT_STATE_LABELS: Record<
  PaymentState,
  { label: string; color: string; bg: string }
> = {
  UNPAID: { label: "Төлөгдөөгүй", color: "#9a5555", bg: "#f6e8e8" },
  PARTIAL: { label: "Дутуу төлсөн", color: "#986438", bg: "#f6ead9" },
  PAID: { label: "Төлсөн", color: "#3e5a47", bg: "#dee6e0" },
  OVERPAID: { label: "Илүү төлсөн", color: "#3f7a6e", bg: "#dff0ec" },
};

/** Төлбөрийн мөрүүдийн нийлбэр. Буцаалт сөрөг тул хасагдана. */
export function sumPayments(payments: { amount: number }[]): number {
  return payments.reduce((sum, payment) => sum + payment.amount, 0);
}

/** Нэмэлт төлбөрүүдийн нийлбэр. */
export function sumCharges(charges: { amount: number }[]): number {
  return charges.reduce((sum, charge) => sum + charge.amount, 0);
}

/**
 * Захиалгын төлбөрийн бүрэн зураг.
 * Хуанли, захиалгын цонх, тайлан гурав ЯГ ижил тооцоог хэрэглэнэ.
 */
export function summarize(input: {
  totalPrice: number;
  payments: { amount: number; isDeposit: boolean }[];
}) {
  const paid = sumPayments(input.payments);
  const balance = input.totalPrice - paid;

  const state: PaymentState =
    paid <= 0
      ? "UNPAID"
      : balance > 0
        ? "PARTIAL"
        : balance === 0
          ? "PAID"
          : "OVERPAID";

  return {
    paid,
    /** Эерэг бол дутуу, сөрөг бол илүү төлсөн */
    balance,
    state,
    /** Урьдчилгаа авсан эсэх — «бүтэн төлсөн» -өөс ялгаж харуулна */
    hasDeposit: input.payments.some((payment) => payment.isDeposit),
  };
}
