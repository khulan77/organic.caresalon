"use server";

import { cookies } from "next/headers";
import { refresh } from "next/cache";
import { getActionUser } from "@/lib/auth";
import { PREVIEW_COOKIE } from "@/lib/preview";
import type { Role } from "@/lib/generated/prisma/enums";

/**
 * Админ UI-г «Ресепшн» эрхээр урьдчилан харах.
 * Зөвхөн эрхийг БУУРУУЛНА — cookie-гоор өөрийгөө админ болгох боломжгүй.
 */
export async function setPreviewRole(role: Role): Promise<void> {
  const user = await getActionUser();
  if (user.role !== "ADMIN") {
    throw new Error("Зөвхөн админ энэ горимыг ашиглана.");
  }

  const store = await cookies();
  if (role === "RECEPTION") {
    store.set(PREVIEW_COOKIE, "RECEPTION", {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
    });
  } else {
    store.delete(PREVIEW_COOKIE);
  }

  refresh();
}
