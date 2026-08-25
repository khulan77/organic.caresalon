import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { toDateKey } from "@/lib/time";
import { PageHeader } from "@/components/page-header";
import { ClientSearch } from "@/components/client-search";

export const metadata = { title: "Үйлчлүүлэгч" };

export default async function ClientsPage(props: PageProps<"/clients">) {
  await requireUser();
  const params = await props.searchParams;
  const query = typeof params.q === "string" ? params.q.trim() : "";
  const digits = query.replace(/\D/g, "");

  const clients = await prisma.client.findMany({
    where: query
      ? {
          OR: [
            { name: { contains: query, mode: "insensitive" } },
            ...(digits ? [{ phone: { contains: digits } }] : []),
          ],
        }
      : undefined,
    orderBy: { name: "asc" },
    take: 100,
    select: {
      id: true,
      name: true,
      phone: true,
      note: true,
      _count: { select: { appointments: true } },
      appointments: {
        where: { status: "COMPLETED" },
        orderBy: { startAt: "desc" },
        take: 1,
        select: { startAt: true, totalPrice: true },
      },
    },
  });

  const total = await prisma.client.count();

  return (
    <>
      <PageHeader
        title="Үйлчлүүлэгч"
        subtitle={`Нийт ${total} бүртгэлтэй`}
        action={<ClientSearch defaultValue={query} />}
      />

      <div className="min-h-0 flex-1 overflow-auto scrollbar-slim p-4 md:p-6">
        {clients.length === 0 ? (
          <p className="rounded-xl border border-sand-200 bg-white px-4 py-8 text-center text-sand-500">
            {query ? "Хайлтад тохирох үйлчлүүлэгч олдсонгүй." : "Бүртгэл алга."}
          </p>
        ) : (
          <div className="scrollbar-slim overflow-x-auto rounded-xl border border-sand-200 bg-white">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="border-b border-sand-200 bg-sand-50 text-left text-xs text-sand-600">
                <tr>
                  <th className="px-4 py-2 font-medium">Нэр</th>
                  <th className="w-32 px-4 py-2 font-medium">Утас</th>
                  <th className="px-4 py-2 font-medium">Тэмдэглэл</th>
                  <th className="w-24 px-4 py-2 text-right font-medium">Ирсэн</th>
                  <th className="w-32 px-4 py-2 text-right font-medium">
                    Сүүлд ирсэн
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-sand-100">
                {clients.map((client) => (
                  <tr key={client.id} className="hover:bg-sand-50">
                    <td className="px-4 py-2.5 font-medium text-sand-900">
                      {client.name}
                    </td>
                    <td className="px-4 py-2.5 tabular-nums text-sand-700">
                      {client.phone}
                    </td>
                    <td className="max-w-xs truncate px-4 py-2.5 text-sand-600">
                      {client.note ?? "—"}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-sand-700">
                      {client._count.appointments}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-sand-600">
                      {client.appointments[0]
                        ? toDateKey(client.appointments[0].startAt)
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {clients.length === 100 ? (
          <p className="mt-3 text-center text-sm text-sand-500">
            Эхний 100 бүртгэлийг харууллаа. Хайлт ашиглана уу.
          </p>
        ) : null}
      </div>
    </>
  );
}
