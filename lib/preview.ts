import "server-only";

import { cookies } from "next/headers";
import type { Role } from "@/lib/generated/prisma/enums";
import type { CurrentUser } from "@/lib/session";

const PREVIEW_COOKIE = "oc_preview_role";

/**
 * Админ «Ресепшн» эрхээр UI яаж харагдахыг урьдчилан харах горим.
 *
 * ЭНЭ НЬ ХАМГААЛАЛТ БИШ — зөвхөн харагдах байдлыг өөрчилнө.
 * Жинхэнэ эрхийн шалгалт `requireAdmin()` дотор бодит `user.role`-оор хийгдэнэ.
 * Ресепшн хэрэглэгч энэ товчийг огт харахгүй бөгөөд cookie тавьсан ч
 * өөрийгөө админ болгож чадахгүй (доорх функц зөвхөн эрхийг БУУРУУЛНА).
 */
export async function getEffectiveRole(user: CurrentUser): Promise<Role> {
  if (user.role !== "ADMIN") return user.role;

  const store = await cookies();
  return store.get(PREVIEW_COOKIE)?.value === "RECEPTION"
    ? "RECEPTION"
    : "ADMIN";
}

export { PREVIEW_COOKIE };
