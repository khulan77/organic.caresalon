import "server-only";

import { redirect } from "next/navigation";
import { getCurrentUser, type CurrentUser } from "@/lib/session";

/**
 * Өгөгдөл хандах давхаргын хамгаалалт (Data Access Layer).
 *
 * Хуудас, Server Action бүр өгөгдөл уншихаасаа ӨМНӨ энэ функцийг дуудна.
 * Зөвхөн proxy дээрх шалгалтад найдахгүй — хамгаалалт өгөгдлийн эх сурвалжид байна.
 */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/** Зөвхөн админд зөвшөөрөх үйлдэлд. */
export async function requireAdmin(): Promise<CurrentUser> {
  const user = await requireUser();
  if (user.role !== "ADMIN") {
    redirect("/calendar");
  }
  return user;
}

/**
 * Server Action дотор ашиглах хувилбар — redirect хийхийн оронд алдаа шиднэ,
 * ингэснээр action нь хэрэглэгчид ойлгомжтой хариу буцааж чадна.
 */
export async function getActionUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Нэвтрэх шаардлагатай.");
  return user;
}
