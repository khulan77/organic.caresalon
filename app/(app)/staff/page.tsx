import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { WEEKDAYS_SHORT } from "@/lib/labels";
import { formatMinutes, toDateKey, todayKey } from "@/lib/time";
import { PageHeader } from "@/components/page-header";

export const metadata = { title: "Ажилтан" };

export default async function StaffPage() {
  await requireUser();

  const branches = await prisma.branch.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      openMin: true,
      closeMin: true,
      staff: {
        where: { isActive: true },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        select: {
          id: true,
          name: true,
          position: true,
          color: true,
          schedules: {
            orderBy: { weekday: "asc" },
            select: { weekday: true, isDayOff: true, startMin: true, endMin: true },
          },
          timeOffs: {
            where: { date: { gte: new Date(`${todayKey()}T00:00:00.000Z`) } },
            orderBy: { date: "asc" },
            take: 4,
            select: { date: true, startMin: true, endMin: true, reason: true },
          },
        },
      },
    },
  });

  const totalStaff = branches.reduce((sum, b) => sum + b.staff.length, 0);

  return (
    <>
      <PageHeader
        title="Ажилтан ба хуваарь"
        subtitle={`${totalStaff} ажилтан · ${branches.length} салбар`}
      />

      <div className="min-h-0 flex-1 overflow-auto scrollbar-slim p-4">
        <div className="space-y-6">
          {branches.map((branch) => (
            <section key={branch.id}>
              <h2 className="mb-2 text-sm font-semibold text-sand-800">
                {branch.name}
                <span className="ml-2 font-normal text-sand-500">
                  {formatMinutes(branch.openMin)}–{formatMinutes(branch.closeMin)}
                </span>
              </h2>

              {branch.staff.length === 0 ? (
                <p className="rounded-xl border border-sand-200 bg-white px-4 py-5 text-sm text-sand-500">
                  Ажилтан бүртгэгдээгүй.
                </p>
              ) : (
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {branch.staff.map((member) => (
                    <article
                      key={member.id}
                      className="rounded-xl border border-sand-200 bg-white p-4"
                    >
                      <div className="mb-3 flex items-center gap-2.5">
                        <span
                          aria-hidden
                          className="size-3 shrink-0 rounded-full"
                          style={{ backgroundColor: member.color }}
                        />
                        <div className="min-w-0">
                          <p className="truncate font-medium text-sand-900">
                            {member.name}
                          </p>
                          {member.position ? (
                            <p className="truncate text-xs text-sand-500">
                              {member.position}
                            </p>
                          ) : null}
                        </div>
                      </div>

                      {/* Долоо хоногийн хуваарь */}
                      <div className="grid grid-cols-7 gap-1 text-center">
                        {Array.from({ length: 7 }, (_, weekday) => {
                          const schedule = member.schedules.find(
                            (s) => s.weekday === weekday,
                          );
                          const off = !schedule || schedule.isDayOff;
                          return (
                            <div key={weekday}>
                              <p className="mb-1 text-[11px] text-sand-500">
                                {WEEKDAYS_SHORT[weekday]}
                              </p>
                              <div
                                title={
                                  off
                                    ? "Амралт"
                                    : `${formatMinutes(schedule.startMin)}–${formatMinutes(schedule.endMin)}`
                                }
                                className={`rounded py-1 text-[10px] leading-tight ${
                                  off
                                    ? "bg-sand-100 text-sand-400"
                                    : "bg-brand-50 text-brand-800"
                                }`}
                              >
                                {off ? "—" : formatMinutes(schedule.startMin)}
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {/* Ойрын чөлөө */}
                      {member.timeOffs.length > 0 ? (
                        <ul className="mt-3 space-y-1 border-t border-sand-100 pt-2 text-xs text-sand-600">
                          {member.timeOffs.map((off, index) => (
                            <li key={index} className="flex justify-between gap-2">
                              <span className="tabular-nums">
                                {toDateKey(off.date)}
                              </span>
                              <span className="truncate">
                                {off.startMin == null
                                  ? "Бүтэн өдөр"
                                  : `${formatMinutes(off.startMin)}–${formatMinutes(off.endMin ?? 0)}`}
                                {off.reason ? ` · ${off.reason}` : ""}
                              </span>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </article>
                  ))}
                </div>
              )}
            </section>
          ))}
        </div>

        <p className="mt-6 rounded-lg bg-sand-50 px-4 py-3 text-sm text-sand-600">
          Ажилтан нэмэх, хуваарь засах, чөлөө бүртгэх дэлгэц дараагийн алхамд
          нэмэгдэнэ. Одоогоор seed өгөгдөл харагдаж байна.
        </p>
      </div>
    </>
  );
}
