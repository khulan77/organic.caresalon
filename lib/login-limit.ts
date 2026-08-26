import "server-only";

import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";

/**
 * Нэвтрэх оролдлогын хязгаар — нууц үг таах (brute force) халдлагаас хамгаална.
 *
 * Зөвхөн АМЖИЛТГҮЙ оролдлогыг `login_attempts` хүснэгтэд бичнэ. Санд хадгалж
 * байгаа шалтгаан: Vercel дээр апп олон хувилбараар зэрэг ажилладаг тул
 * санах ойд тоолсон тоо хуваалцагдахгүй.
 */

/** Оролдлого тоолох хугацааны цонх — 15 минут. */
const WINDOW_MS = 15 * 60 * 1000;

/** Нэг утасны дугаар руу хийж болох буруу оролдлогын дээд тоо. */
const MAX_PER_PHONE = 5;

/** Нэг IP-ээс хийж болох дээд тоо — олон дугаар дараалан туршихаас хамгаална. */
const MAX_PER_IP = 20;

/** Нэг хязгаарлалтын дүрэм: аль түлхүүрийг хэдээр таслах вэ. */
type Limit = { key: string; max: number };

/**
 * Хүсэлт илгээгчийн IP. Vercel нь `x-forwarded-for` толгойг тавьдаг.
 * Локал ажиллуулахад байхгүй байж болно — тэр үед IP-гээр хязгаарлахгүй.
 */
async function clientIp(): Promise<string | null> {
  const head = await headers();
  const forwarded = head.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || head.get("x-real-ip")?.trim();
  return ip ? ip : null;
}

/** Тухайн нэвтрэх оролдлогод хамаарах бүх дүрмийг цуглуулна. */
export async function loginLimits(phone: string): Promise<Limit[]> {
  const limits: Limit[] = [{ key: `phone:${phone}`, max: MAX_PER_PHONE }];
  const ip = await clientIp();
  if (ip) limits.push({ key: `ip:${ip}`, max: MAX_PER_IP });
  return limits;
}

/**
 * Одоо хаалттай байгаа эсэх. Хаалттай бол хэдэн СЕКУНД хүлээхийг буцаана,
 * үгүй бол `null`.
 *
 * Сангийн алдаа гарвал хаахгүй өнгөрүүлнэ: энэ хамгаалалт ажиллахгүй байгаагаас
 * бүх ажилтныг системд оруулахгүй байх нь салонд илүү хортой.
 */
export async function loginBlockSeconds(
  limits: Limit[],
): Promise<number | null> {
  const since = new Date(Date.now() - WINDOW_MS);

  const attempts = await prisma.loginAttempt
    .findMany({
      where: { key: { in: limits.map((limit) => limit.key) }, createdAt: { gte: since } },
      select: { key: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    })
    .catch(() => null);

  if (!attempts) return null;

  let waitMs = 0;
  for (const limit of limits) {
    const mine = attempts.filter((attempt) => attempt.key === limit.key);
    if (mine.length < limit.max) continue;
    // Хязгаараас хэтэрсэн — хамгийн эртний оролдлого цонхноос гармагц чөлөөлөгдөнө.
    const freeAt = mine[0].createdAt.getTime() + WINDOW_MS;
    waitMs = Math.max(waitMs, freeAt - Date.now());
  }

  return waitMs > 0 ? Math.ceil(waitMs / 1000) : null;
}

/** Амжилтгүй оролдлогыг бүртгэнэ, зэрэгцээд хуучирсан мөрүүдийг цэвэрлэнэ. */
export async function recordLoginFailure(limits: Limit[]): Promise<void> {
  await prisma.loginAttempt
    .createMany({ data: limits.map((limit) => ({ key: limit.key })) })
    .catch(() => undefined);

  await prisma.loginAttempt
    .deleteMany({ where: { createdAt: { lt: new Date(Date.now() - WINDOW_MS) } } })
    .catch(() => undefined);
}

/**
 * Амжилттай нэвтэрсэн дугаарын түүхийг цэвэрлэнэ.
 * IP-ийн тоолуурыг хөндөхгүй — эс бөгөөс халдагч өөрийн данс руугаа нэвтрээд
 * тоолуураа тэглэх боломжтой болно.
 */
export async function clearLoginFailures(phone: string): Promise<void> {
  await prisma.loginAttempt
    .deleteMany({ where: { key: `phone:${phone}` } })
    .catch(() => undefined);
}

/** Хаалттай үед хэрэглэгчид харуулах мессеж. */
export function loginBlockMessage(seconds: number): string {
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  return `Хэт олон удаа буруу оруулсан тул түр хаалаа. ${minutes} минутын дараа дахин оролдоно уу.`;
}
