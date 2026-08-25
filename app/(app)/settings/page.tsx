import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ROLE_LABELS } from "@/lib/labels";
import { formatMinutes, toDateKey } from "@/lib/time";
import { PageHeader } from "@/components/page-header";

export const metadata = { title: "Тохиргоо" };

export default async function SettingsPage() {
  await requireAdmin();

  const [branches, users] = await Promise.all([
    prisma.branch.findMany({
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        address: true,
        phone: true,
        openMin: true,
        closeMin: true,
        slotMin: true,
        isActive: true,
        _count: { select: { staff: true } },
      },
    }),
    prisma.user.findMany({
      orderBy: [{ role: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        phone: true,
        role: true,
        isActive: true,
        lastLoginAt: true,
        branch: { select: { name: true } },
      },
    }),
  ]);

  return (
    <>
      <PageHeader title="Тохиргоо" subtitle="Зөвхөн админ харна" />

      <div className="min-h-0 flex-1 space-y-6 overflow-auto scrollbar-slim p-4">
        <section>
          <h2 className="mb-2 text-sm font-semibold text-sand-800">Салбар</h2>
          <div className="overflow-hidden rounded-xl border border-sand-200 bg-white">
            <table className="w-full text-sm">
              <thead className="border-b border-sand-200 bg-sand-50 text-left text-xs text-sand-600">
                <tr>
                  <th className="px-4 py-2 font-medium">Нэр</th>
                  <th className="px-4 py-2 font-medium">Хаяг</th>
                  <th className="w-32 px-4 py-2 font-medium">Ажлын цаг</th>
                  <th className="w-20 px-4 py-2 text-right font-medium">Нүд</th>
                  <th className="w-24 px-4 py-2 text-right font-medium">Ажилтан</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-sand-100">
                {branches.map((branch) => (
                  <tr key={branch.id} className="hover:bg-sand-50">
                    <td className="px-4 py-2.5 font-medium text-sand-900">
                      {branch.name}
                      {!branch.isActive ? (
                        <span className="ml-2 rounded bg-sand-200 px-1.5 py-0.5 text-xs text-sand-600">
                          идэвхгүй
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-2.5 text-sand-600">{branch.address}</td>
                    <td className="px-4 py-2.5 tabular-nums text-sand-700">
                      {formatMinutes(branch.openMin)}–{formatMinutes(branch.closeMin)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-sand-600">
                      {branch.slotMin} мин
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-sand-700">
                      {branch._count.staff}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h2 className="mb-2 text-sm font-semibold text-sand-800">Хэрэглэгч</h2>
          <div className="overflow-hidden rounded-xl border border-sand-200 bg-white">
            <table className="w-full text-sm">
              <thead className="border-b border-sand-200 bg-sand-50 text-left text-xs text-sand-600">
                <tr>
                  <th className="px-4 py-2 font-medium">Нэр</th>
                  <th className="w-32 px-4 py-2 font-medium">Утас</th>
                  <th className="w-28 px-4 py-2 font-medium">Эрх</th>
                  <th className="px-4 py-2 font-medium">Үндсэн салбар</th>
                  <th className="w-32 px-4 py-2 text-right font-medium">
                    Сүүлд нэвтэрсэн
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-sand-100">
                {users.map((user) => (
                  <tr key={user.id} className="hover:bg-sand-50">
                    <td className="px-4 py-2.5 font-medium text-sand-900">
                      {user.name}
                      {!user.isActive ? (
                        <span className="ml-2 rounded bg-sand-200 px-1.5 py-0.5 text-xs text-sand-600">
                          идэвхгүй
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-2.5 tabular-nums text-sand-700">
                      {user.phone}
                    </td>
                    <td className="px-4 py-2.5 text-sand-700">
                      {ROLE_LABELS[user.role]}
                    </td>
                    <td className="px-4 py-2.5 text-sand-600">
                      {user.branch?.name ?? "—"}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-sand-600">
                      {user.lastLoginAt ? toDateKey(user.lastLoginAt) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-sm text-sand-500">
            Ресепшн эрхтэй хэрэглэгч бүх салбарын хуанлийг харна. Үндсэн салбар нь
            зөвхөн нэвтрэхэд аль салбар эхэлж нээгдэхийг заана.
          </p>
        </section>
      </div>
    </>
  );
}
