import { NextResponse, type NextRequest } from "next/server";
import {
  SESSION_COOKIE,
  SESSION_RENEW_COOKIE,
  SESSION_TTL_MS,
  hashToken,
  nextRenewAt,
  sessionCookieOptions,
} from "@/lib/session-token";

/**
 * Хоёр ажил хийнэ:
 *
 * 1. Нэвтрээгүй хэрэглэгчийг нэвтрэх хуудас руу урьдчилан чиглүүлнэ. Энэ бол
 *    зөвхөн ХЭРЭГЛЭГЧИЙН ТУХ ТАЙД зориулсан хурдан шалгалт — cookie байгаа
 *    эсэхийг л хардаг. Жинхэнэ хамгаалалт нь `requireUser()` дотор, өгөгдөл
 *    хандахын өмнө хийгддэг (lib/auth.ts).
 *
 * 2. Идэвхтэй хэрэглэгчийн сессийг СУНГАНА. Ингэснээр өдөр бүр ажиллаж байгаа
 *    ресепшн 30 хоногийн дараа гэнэт хаягдахгүй. Сунгалт хоногт нэгээс олон
 *    удаа хийгдэхгүй — `oc_session_renew` cookie нь дараагийн сунгалтын цагийг
 *    хадгалдаг тул хүсэлт болгонд сан руу хандах шаардлагагүй.
 */
export async function proxy(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const isLoginPage = request.nextUrl.pathname === "/login";

  if (!token) {
    return isLoginPage ? NextResponse.next() : redirectToLogin(request);
  }

  if (!isRenewDue(request)) {
    return NextResponse.next();
  }

  const expiresAt = await renewSession(token);

  // Сесс олдсонгүй — гарсан, цуцлагдсан, эсвэл хугацаа нь дууссан байна.
  if (expiresAt === null) {
    const response = isLoginPage
      ? NextResponse.next()
      : redirectToLogin(request);
    response.cookies.delete(SESSION_COOKIE);
    response.cookies.delete(SESSION_RENEW_COOKIE);
    return response;
  }

  const response = NextResponse.next();
  // Сангийн алдаа гарсан бол шинэ хугацаа буцахгүй — cookie-г хөндөхгүй өнгөрнө.
  if (expiresAt) {
    const options = sessionCookieOptions(expiresAt);
    response.cookies.set(SESSION_COOKIE, token, options);
    response.cookies.set(SESSION_RENEW_COOKIE, nextRenewAt(), options);
  }
  return response;
}

/** Нэвтрэх хуудас руу буцаана — хаяг дахь query-г үлдээхгүй. */
function redirectToLogin(request: NextRequest): NextResponse {
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}

/**
 * Сунгах цаг болсон уу?
 *
 * Тэмдэглэгээ cookie байхгүй эсвэл гэмтсэн бол ТИЙМ гэж үзнэ — ингэснээр энэ
 * шинэчлэлээс өмнө үүссэн сессүүд эхний хандалтдаа тэмдэглэгээгээ авна.
 */
function isRenewDue(request: NextRequest): boolean {
  const marker = Number(request.cookies.get(SESSION_RENEW_COOKIE)?.value);
  return !Number.isFinite(marker) || Date.now() >= marker;
}

/**
 * Сессийн хугацааг өнөөдрөөс хойш дахин бүтэн TTL болгож сунгана.
 *
 * Буцаах утга:
 *   Date — сунгагдсан, шинэ дуусах хугацаа
 *   null — ийм хүчинтэй сесс алга (cookie-г цэвэрлэх ёстой)
 *   undefined — сангийн алдаа; юу ч өөрчлөхгүй өнгөрөх (нэвтрэлтийг таслахгүй)
 */
async function renewSession(token: string): Promise<Date | null | undefined> {
  try {
    const { prisma } = await import("@/lib/prisma");
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    const { count } = await prisma.session.updateMany({
      where: { tokenHash: hashToken(token), expiresAt: { gt: new Date() } },
      data: { expiresAt },
    });
    return count > 0 ? expiresAt : null;
  } catch {
    return undefined;
  }
}

export const config = {
  // Статик файл, зураг зэргийг алгасана
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|svg|ico)$).*)"],
};
