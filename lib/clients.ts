import "server-only";

import { prisma } from "@/lib/prisma";

/** Үйлчлүүлэгчийн жагсаалтад байлгах дээд тоо. */
export const CLIENT_LIMIT = 30;

/**
 * Хязгаараас хэтэрсэн ХАМГИЙН ХУУЧИН бүртгэлүүдийг устгана — жагсаалт
 * тогтмол 30 орчим байж, хуучин нь доороосоо гарч явна.
 *
 * ЗАХИАЛГЫН ТҮҮХТЭЙ хүнийг хөндөхгүй: түүнийг устгавал тайлангийн орлого,
 * хуанлийн бичлэг хамт алга болно (сан дээр ч `Restrict` тул устахгүй).
 * Тиймээс бүгд түүхтэй бол жагсаалт 30-аас олон хэвээр үлдэж болно —
 * хуудас нь хамгийн сүүлийн 30-г л харуулна.
 *
 * Алдаа гарвал дуугүй өнгөрнө: цэвэрлэгээ бүтэлгүйтсэнээс болж
 * бүртгэл/захиалга унах учиргүй.
 */
export async function trimOldClients(exceptId?: string): Promise<void> {
  try {
    const total = await prisma.client.count();
    if (total <= CLIENT_LIMIT) return;

    const removable = await prisma.client.findMany({
      where: {
        appointments: { none: {} },
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      orderBy: { createdAt: "asc" },
      take: total - CLIENT_LIMIT,
      select: { id: true },
    });
    if (removable.length === 0) return;

    await prisma.client.deleteMany({
      where: { id: { in: removable.map((client) => client.id) } },
    });
  } catch {
    // Цэвэрлэгээ бол туслах ажил — амжилтгүй бол дараагийн бүртгэлээр дахина
  }
}
