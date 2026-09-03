import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { toDateKey } from "@/lib/time";
import { CLIENT_LIMIT } from "@/lib/clients";
import { ClientsView, type ClientRow } from "@/components/clients/clients-view";

export const metadata = { title: "Үйлчлүүлэгч" };

/** Ирэлтэд тооцохгүй төлөвүүд. */
const NOT_A_VISIT = ["CANCELLED", "NO_SHOW"] as const;

export default async function ClientsPage() {
  const user = await requireUser();

  const clients = await prisma.client.findMany({
    orderBy: { createdAt: "desc" },
    // Хамгийн сүүлийн 30 — хуучин нь доороосоо гарч явна (lib/clients.ts)
    take: CLIENT_LIMIT,
    select: {
      id: true,
      name: true,
      phone: true,
      note: true,
      createdAt: true,
      // Сүүлийн ирэлт — тэр удаад авсан үйлчилгээг мөрөн дээр харуулна
      appointments: {
        where: { status: { notIn: [...NOT_A_VISIT] } },
        orderBy: { startAt: "desc" },
        take: 1,
        select: {
          startAt: true,
          items: {
            orderBy: { sortOrder: "asc" },
            select: {
              name: true,
              service: {
                select: { color: true, category: { select: { color: true } } },
              },
            },
          },
        },
      },
    },
  });

  /*
    Ирэлтийн тоо ба нийт зарцуулалтыг ТУСДАА нэг асуулгаар авна.
    Хоёр ажилтан зэрэг үйлчилсэн захиалга сан дотроо хэд хэдэн мөр болдог тул
    `groupId`-аар нь нэгтгэж НЭГ ирэлт гэж тооцно (тайлантай ижил дүрэм).
  */
  const rowsById = new Map(clients.map((client) => [client.id, client]));
  const history = await prisma.appointment.findMany({
    where: {
      clientId: { in: [...rowsById.keys()] },
      status: { notIn: [...NOT_A_VISIT] },
    },
    select: { id: true, clientId: true, groupId: true, totalPrice: true },
  });

  const stats = new Map<string, { visits: Set<string>; spent: number }>();
  for (const row of history) {
    const entry = stats.get(row.clientId) ?? { visits: new Set(), spent: 0 };
    entry.visits.add(row.groupId ?? row.id);
    entry.spent += row.totalPrice;
    stats.set(row.clientId, entry);
  }

  const rows: ClientRow[] = clients.map((client) => {
    const last = client.appointments[0];
    const stat = stats.get(client.id);
    return {
      id: client.id,
      name: client.name,
      phone: client.phone,
      note: client.note,
      registeredAt: toDateKey(client.createdAt),
      visits: stat?.visits.size ?? 0,
      spent: stat?.spent ?? 0,
      lastVisit: last ? toDateKey(last.startAt) : null,
      services: last
        ? last.items.map((item) => ({
            name: item.name,
            color: item.service.color ?? item.service.category.color,
          }))
        : [],
    };
  });

  return <ClientsView clients={rows} isAdmin={user.role === "ADMIN"} />;
}
