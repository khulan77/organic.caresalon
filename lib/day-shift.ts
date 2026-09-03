import type { DayMarkKind } from "@/lib/generated/prisma/enums";

/**
 * Ажилтан тухайн өдөр ХЭДЭН ЦАГТ ажиллах вэ — нэг эх сурвалж.
 *
 * Хуанли, захиалгын шалгалт, сул цагийн тооцоо ба өдрийн хураангуй БҮГД
 * үүнийг дуудна: цагийн бүртгэл дээр «амарсан» гэж тэмдэглэсэн ажилтан
 * хуанлиас шууд алга болж, түүнд шинэ цаг ч бүртгэгдэхгүй байх ёстой.
 *
 * Дараалал (дээрээс нь дарна):
 *   1. Гараар тавьсан тэмдэглэгээ (StaffDayMark) — ресепшний шийдвэр
 *   2. Долоо хоногийн үндсэн хуваарь (StaffSchedule)
 *   3. Бүтэн өдрийн чөлөө (StaffTimeOff)
 *
 * Тэмдэглэгээ нь ХОЁР ЧИГЛЭЛД дардаг: `DAY_OFF`/`LEAVE` нь ажлын өдрийг
 * амралт болгоно, `WORK` нь эсрэгээр хуваариар амралттай өдөр ажиллуулна
 * (салонд амралтын өдөр долоо хоног бүр өөр байдаг).
 */

/** Хуваарь огт байхгүй ажилтныг WORK гэж тэмдэглэсэн үеийн ээлж. */
const FALLBACK_SHIFT = { startMin: 600, endMin: 1140 };

export type Shift = { startMin: number; endMin: number };

/** `effectiveShift`-д хэрэгтэй талбарууд — сангийн аль ч query-д тохирно. */
export type ShiftSource = {
  /** Тухайн ӨДРИЙН гарагийн хуваарь (0 эсвэл 1 мөр) */
  schedules: { isDayOff: boolean; startMin: number; endMin: number }[];
  /** Тухайн ӨДРИЙН чөлөөнүүд */
  timeOffs: { startMin: number | null; endMin: number | null }[];
  /** Тухайн ӨДРИЙН гараар тавьсан тэмдэглэгээ (0 эсвэл 1 мөр) */
  dayMarks: { kind: DayMarkKind }[];
};

/**
 * Тухайн өдрийн бодит ээлж. Огт ажиллахгүй бол `null`.
 */
export function effectiveShift(member: ShiftSource): Shift | null {
  const mark = member.dayMarks[0];
  const shift = member.schedules[0];

  // 1. Гараар «амарсан / чөлөө» гэсэн бол ямар ч хуваарь хүчингүй
  if (mark && mark.kind !== "WORK") return null;

  /*
    Гараар «ажилласан» гэсэн бол хуваариар амралттай ч ажиллана. Цагийг нь
    хуваариас авна — амралтын мөр ч `startMin`/`endMin`-тэй хадгалагддаг тул
    ажилтны ердийн ээлж хэвээр гарч ирнэ. Мөн бүтэн өдрийн чөлөөг ч дарна:
    ресепшн «ажилласан» гэж хэлсэн бол ажилласан.
  */
  if (mark) return shift ? { startMin: shift.startMin, endMin: shift.endMin } : FALLBACK_SHIFT;

  // 2. Долоо хоногийн хуваарийн амралт
  if (!shift || shift.isDayOff) return null;

  // 3. Ээлжийг БҮТНЭЭР хамарсан чөлөө — тэр өдөр ажиллахгүй.
  //    Хэсэгчилсэн чөлөө нь ээлжийг цуцлахгүй, зөвхөн дундаас нь хасна.
  const wholeDayOff = member.timeOffs.some(
    (off) =>
      (off.startMin ?? 0) <= shift.startMin &&
      (off.endMin ?? 24 * 60) >= shift.endMin,
  );
  if (wholeDayOff) return null;

  return { startMin: shift.startMin, endMin: shift.endMin };
}

/** Тухайн өдөр огт ажиллахгүй эсэх. */
export function isRestingAllDay(member: ShiftSource): boolean {
  return effectiveShift(member) === null;
}

/** Цагийн бүртгэлээс гараар «амралт / чөлөө» гэж тэмдэглэсэн эсэх. */
export function isMarkedOff(member: ShiftSource): boolean {
  const mark = member.dayMarks[0];
  return Boolean(mark && mark.kind !== "WORK");
}

/**
 * Тухайн өдөр ХҮЧИНТЭЙ чөлөөнүүд.
 *
 * Гараар «ажилласан» гэж тэмдэглэсэн бол ээлжийг БҮТНЭЭР хамарсан чөлөө
 * хүчингүй болно — ресепшний шийдвэр дээгүүр. Хэсэгчилсэн чөлөө хэвээр.
 */
export function activeTimeOffs<
  T extends { startMin: number | null; endMin: number | null },
>(
  member: { dayMarks: { kind: DayMarkKind }[] },
  timeOffs: T[],
  shift: Shift,
): T[] {
  if (member.dayMarks[0]?.kind !== "WORK") return timeOffs;
  return timeOffs.filter(
    (off) =>
      !(
        (off.startMin ?? 0) <= shift.startMin &&
        (off.endMin ?? 24 * 60) >= shift.endMin
      ),
  );
}
