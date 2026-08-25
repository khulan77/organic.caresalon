import { NextResponse, type NextRequest } from "next/server";

/**
 * Нэвтрээгүй хэрэглэгчийг нэвтрэх хуудас руу урьдчилан чиглүүлнэ.
 *
 * Энэ бол зөвхөн ХЭРЭГЛЭГЧИЙН ТУХ ТАЙД зориулсан хурдан шалгалт — cookie байгаа
 * эсэхийг л хардаг. Жинхэнэ хамгаалалт нь `requireUser()` дотор, өгөгдөл
 * хандахын өмнө хийгддэг (lib/auth.ts).
 */
export function proxy(request: NextRequest) {
  const hasSession = Boolean(request.cookies.get("oc_session")?.value);
  const { pathname } = request.nextUrl;

  if (!hasSession && pathname !== "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  // Статик файл, зураг зэргийг алгасана
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|svg|ico)$).*)"],
};
