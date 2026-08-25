import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { cache } from "react";
import { prisma } from "@/lib/prisma";

const COOKIE_NAME = "oc_session";
/** Сессийн хүчинтэй хугацаа — 30 хоног. */
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Cookie-д очих токеныг өгөгдлийн санд хадгалахын өмнө хэшлэнэ. */
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Нэвтэрсэн хэрэглэгчийн мэдээлэл — нууц үгийн хэш ЭНД ОРОХГҮЙ. */
export type CurrentUser = {
  id: string;
  name: string;
  phone: string;
  role: "ADMIN" | "RECEPTION";
  branchId: string | null;
  /** Түр нууц үгтэй байгаа — өөрийн нууц үгээ тохируулах хүртэл цааш оруулахгүй. */
  mustChangePassword: boolean;
};

/**
 * Шинэ сесс үүсгэж cookie тавина.
 * Зөвхөн Server Action эсвэл Route Handler дотроос дуудна.
 */
export async function createSession(userId: string): Promise<void> {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await prisma.session.create({
    data: { tokenHash: hashToken(token), userId, expiresAt },
  });

  const store = await cookies();
  store.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

/** Сессийг устгаж cookie-г арилгана. */
export async function destroySession(): Promise<void> {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;

  if (token) {
    await prisma.session
      .deleteMany({ where: { tokenHash: hashToken(token) } })
      .catch(() => undefined);
  }
  store.delete(COOKIE_NAME);
}

/**
 * Одоогийн хэрэглэгчийг унших.
 * `cache()`-т ороосон тул нэг хүсэлтийн дотор олон дуудсан ч ганц удаа асууна.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    select: {
      expiresAt: true,
      user: {
        select: {
          id: true,
          name: true,
          phone: true,
          role: true,
          branchId: true,
          isActive: true,
          mustChangePassword: true,
        },
      },
    },
  });

  if (!session || session.expiresAt < new Date() || !session.user.isActive) {
    return null;
  }

  return {
    id: session.user.id,
    name: session.user.name,
    phone: session.user.phone,
    role: session.user.role,
    branchId: session.user.branchId,
    mustChangePassword: session.user.mustChangePassword,
  };
});

/** Хугацаа нь дууссан сессүүдийг цэвэрлэнэ (нэвтрэх үед дуудна). */
export async function pruneExpiredSessions(): Promise<void> {
  await prisma.session
    .deleteMany({ where: { expiresAt: { lt: new Date() } } })
    .catch(() => undefined);
}
