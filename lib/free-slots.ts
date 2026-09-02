/**
 * Сул цагийн интервалын тооцоо — цэвэр функцууд, сан хөндөхгүй.
 *
 * Ажилтны нэг өдөр нь цөөн хэдэн муж: ээлж нь нээж, чөлөө ба захиалга нь
 * тасалдаг. Тэр мужуудаас «энэ үйлчилгээ багтах эхлэх цагууд»-ыг гаргана.
 */

/** Локал шөнө дундаас хойшх минутаар илэрхийлсэн муж — [эхлэл, төгсгөл). */
export type Interval = { startMin: number; endMin: number };

/** Хоосон мужийг хаяж, эрэмбэлж, шүргэлцсэн мужуудыг нийлүүлнэ. */
export function normalizeIntervals(list: Interval[]): Interval[] {
  const sorted = list
    .filter((item) => item.endMin > item.startMin)
    .sort((a, b) => a.startMin - b.startMin);

  const merged: Interval[] = [];
  for (const item of sorted) {
    const last = merged[merged.length - 1];
    if (last && item.startMin <= last.endMin) {
      last.endMin = Math.max(last.endMin, item.endMin);
    } else {
      merged.push({ ...item });
    }
  }
  return merged;
}

/** Хоёр багц мужийн ДАВХЦАЛ — хоёулангийнх нь сул хэсэг. */
export function intersectIntervals(a: Interval[], b: Interval[]): Interval[] {
  const out: Interval[] = [];
  for (const left of a) {
    for (const right of b) {
      const startMin = Math.max(left.startMin, right.startMin);
      const endMin = Math.min(left.endMin, right.endMin);
      if (endMin > startMin) out.push({ startMin, endMin });
    }
  }
  return normalizeIntervals(out);
}

/** `base` мужуудаас `cuts`-ыг хасна — захиалга, чөлөө нь ээлжийг тасалдаг. */
export function subtractIntervals(
  base: Interval[],
  cuts: Interval[],
): Interval[] {
  let current = normalizeIntervals(base);

  for (const hole of normalizeIntervals(cuts)) {
    const next: Interval[] = [];
    for (const piece of current) {
      // Огт хүрэлцэхгүй бол бүтнээр нь үлдээнэ
      if (hole.endMin <= piece.startMin || hole.startMin >= piece.endMin) {
        next.push(piece);
        continue;
      }
      if (hole.startMin > piece.startMin) {
        next.push({ startMin: piece.startMin, endMin: hole.startMin });
      }
      if (hole.endMin < piece.endMin) {
        next.push({ startMin: hole.endMin, endMin: piece.endMin });
      }
    }
    current = next;
  }

  return current;
}

/**
 * Сул мужуудад `durationMin` багтах эхлэх цагууд.
 *
 * Шат нь МУЖИЙН ЭХЛЭЛЭЭС тоологдоно, шөнө дундаас биш: 11:30-д чөлөөтэй болсон
 * ажилтан 11:30, 12:30 ... гэж дараалан авна — хооронд нь хаягдах 30 минут
 * үлдэхгүй. `step`-ийг үйлчилгээний хугацаагаар өгвөл захиалгууд мөр мөрөөрөө
 * шахуу таарна.
 */
export function startTimesIn(
  free: Interval[],
  durationMin: number,
  step: number,
  notBefore = 0,
): number[] {
  if (step <= 0) return [];
  const times: number[] = [];

  for (const piece of free) {
    for (
      let start = piece.startMin;
      start + durationMin <= piece.endMin;
      start += step
    ) {
      // Өнгөрсөн цагийг алгасна — шатны эхлэл нь мужид тогтсон хэвээр
      if (start >= notBefore) times.push(start);
    }
  }

  return times;
}
