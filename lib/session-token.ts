import { createHash } from "node:crypto";

/**
 * Сессийн cookie-той ажиллах ЖИЖИГ туслах модуль.
 *
 * `lib/session.ts` нь `next/headers` ашигладаг тул proxy дотор дуудагдахгүй.
 * Иймд хоёр талд ХАМТ хэрэгтэй зүйлсийг (нэр, хугацаа, хэш) эндээс авна.
 */

/** Сессийн токен агуулсан cookie. */
export const SESSION_COOKIE = "oc_session";

/**
 * Сессийг хэзээ сунгахыг хэлэх туслах cookie. Доторх утга нь epoch миллисекунд.
 * Ингэснээр proxy нь хүсэлт бүрд өгөгдлийн сан руу хандахгүйгээр
 * «одоо сунгах цаг болсон уу?» гэдгийг мэдэж чадна.
 */
export const SESSION_RENEW_COOKIE = "oc_session_renew";

/** Сессийн хүчинтэй хугацаа — 30 хоног. */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Хоёр сунгалтын хоорондох хамгийн бага зай — 1 хоног. */
export const SESSION_RENEW_AFTER_MS = 24 * 60 * 60 * 1000;

/** Cookie-д очих токеныг өгөгдлийн санд хадгалахын өмнө хэшлэнэ. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Хоёр cookie-д адилхан хэрэглэх тохиргоо. */
export function sessionCookieOptions(expiresAt: Date) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    expires: expiresAt,
  };
}

/** Дараагийн сунгалт хэдийд болохыг илэрхийлэх cookie-ийн утга. */
export function nextRenewAt(): string {
  return String(Date.now() + SESSION_RENEW_AFTER_MS);
}
