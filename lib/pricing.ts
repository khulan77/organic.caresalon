/**
 * Үнийн дүрмүүд.
 *
 * Хямдрал: үйлчилгээнд `salePrice` тавьсан бөгөөд `saleEndsAt` өнгөрөөгүй бол
 * тухайн үнээр бодогдоно. Захиалга үүсэх агшны үнэ нь `AppointmentService`-д
 * хуулагдаж царцдаг тул дараа үнэ өөрчлөгдөхөд түүх алдагдахгүй.
 *
 * Багц: сонгосон багцын үйлчилгээнүүдийн нийлбэрээс багцын үнийг хассан
 * зөрүү нь хөнгөлөлт болно. Багцаас гадуур нэмж сонгосон үйлчилгээ
 * бүрэн үнээрээ бодогдоно.
 */

export type Priceable = {
  price: number;
  salePrice: number | null;
  saleEndsAt: Date | null;
};

/** Хямдрал яг одоо хүчинтэй эсэх. */
export function isSaleActive(item: Priceable, now: Date = new Date()): boolean {
  if (item.salePrice == null) return false;
  return item.saleEndsAt == null || item.saleEndsAt.getTime() > now.getTime();
}

/** Одоогийн бодит үнэ — хямдрал хүчинтэй бол хямдралтай үнэ. */
export function effectivePrice(item: Priceable, now: Date = new Date()): number {
  return isSaleActive(item, now) ? (item.salePrice as number) : item.price;
}

/** Хямдралын хувь (харуулахад). 45000 → 30000 бол 33. */
export function salePercent(item: Priceable): number | null {
  if (!isSaleActive(item) || item.price <= 0) return null;
  return Math.round((1 - (item.salePrice as number) / item.price) * 100);
}
