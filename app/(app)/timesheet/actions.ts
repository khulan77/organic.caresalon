"use server";

import { refresh } from "next/cache";
import { canWriteBranch, getActionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isDateKey } from "@/lib/time";
import { fail, type ActionResult } from "@/lib/action-result";
import type { DayMarkKind } from "@/lib/generated/prisma/enums";

const KINDS: DayMarkKind[] = ["WORK", "DAY_OFF", "LEAVE"];

/**
 * Цагийн бүртгэлийн нэг нүдийг гараар тэмдэглэх.
 *
 * Салонд амралтын өдөр тогтмол биш тул долоо хоногийн хуваарь зөвхөн ҮНДЭС
 * болдог — бодит өдрийг ресепшн энд тэмдэглэнэ. `kind` нь `null` бол
 * тэмдэглэгээ арилж, тухайн өдөр буцаад хуваариараа бодогдоно.
 *
 * Админ бүх салбарт, ресепшн зөвхөн харьяа салбартаа.
 */
export async function setDayMark(input: {
  staffId: string;
  dateKey: string;
  kind: DayMarkKind | null;
  note?: string | null;
}): Promise<ActionResult> {
  const user = await getActionUser();

  if (!isDateKey(input.dateKey)) return fail("Огноо буруу байна.");
  if (input.kind !== null && !KINDS.includes(input.kind)) {
    return fail("Тэмдэглэгээ буруу байна.");
  }

  const staff = await prisma.staff.findUnique({
    where: { id: input.staffId },
    select: { branchId: true },
  });
  if (!staff) return fail("Ажилтан олдсонгүй.");

  if (!canWriteBranch(user, staff.branchId)) {
    return fail(
      "Та зөвхөн харьяа салбарынхаа цагийн бүртгэлийг өөрчилнө. Бусдыг нь харах боломжтой ч засах эрхгүй.",
    );
  }

  const date = new Date(`${input.dateKey}T00:00:00.000Z`);
  const where = { staffId_date: { staffId: input.staffId, date } };

  if (input.kind === null) {
    // Байхгүй бол ч алдаа болгохгүй — дарахад нь тэмдэглэгээ нь аль хэдийн
    // арилсан байж болно
    await prisma.staffDayMark.deleteMany({
      where: { staffId: input.staffId, date },
    });
  } else {
    const note = input.note?.trim() || null;
    await prisma.staffDayMark.upsert({
      where,
      update: { kind: input.kind, note },
      create: { staffId: input.staffId, date, kind: input.kind, note },
    });
  }

  refresh();
  return { ok: true };
}
