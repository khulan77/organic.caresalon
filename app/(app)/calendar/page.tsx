import { requireUser } from "@/lib/auth";
import {
  getBranches,
  getDaySchedule,
  getRangeOverview,
  getServiceCatalog,
  type DaySchedule,
} from "@/lib/queries";
import { formatPrice } from "@/lib/labels";
import { isDateKey, todayKey } from "@/lib/time";
import { CalendarHeader } from "@/components/calendar/calendar-header";
import {
  CalendarStats,
  type StatItem,
} from "@/components/calendar/calendar-stats";
import { DayGrid } from "@/components/calendar/day-grid";
import { RangeOverview } from "@/components/calendar/range-overview";

export const metadata = { title: "Хуанли" };

export default async function CalendarPage(props: PageProps<"/calendar">) {
  const user = await requireUser();
  const params = await props.searchParams;

  const branches = await getBranches();
  if (branches.length === 0) {
    return (
      <main className="grid flex-1 place-items-center p-8 text-center text-sand-600">
        <div>
          <p className="text-lg font-medium text-sand-800">
            Салбар бүртгэгдээгүй байна.
          </p>
          <p className="mt-1 text-sm">Тохиргоо хэсгээс салбар нэмнэ үү.</p>
        </div>
      </main>
    );
  }

  // Ресепшн бүх салбарыг харна — сонголт хийгээгүй бол өөрийн салбар анхдагч.
  const requested = typeof params.branch === "string" ? params.branch : undefined;
  const branch =
    branches.find((b) => b.id === requested) ??
    branches.find((b) => b.id === user.branchId) ??
    branches[0];

  const dateKey = isDateKey(params.date) ? params.date : todayKey();
  const view =
    params.view === "15" || params.view === "30" ? Number(params.view) : 0;

  // Ресепшн бусад салбарын хуанлийг ХАРНА, гэхдээ зөвхөн харьяа салбартаа
  // бүртгэнэ. Энэ нь зөвхөн UI — жинхэнэ хориг server action дотор (lib/auth).
  const canWrite = user.role === "ADMIN" || user.branchId === branch.id;

  const header = (
    <CalendarHeader
      branches={branches}
      activeBranchId={branch.id}
      dateKey={dateKey}
      canWrite={canWrite}
    />
  );

  if (view === 0) {
    const [schedule, catalog] = await Promise.all([
      getDaySchedule(branch.id, dateKey),
      getServiceCatalog(branch.id),
    ]);

    return (
      <main className="flex min-h-0 flex-1 flex-col">
        {header}
        <CalendarStats items={dayStats(schedule)} view={view} />
        <DayGrid
          branch={branch}
          dateKey={dateKey}
          staff={schedule.staff}
          appointments={schedule.appointments}
          closure={schedule.closure}
          catalog={catalog}
          canWrite={canWrite}
          isAdmin={user.role === "ADMIN"}
        />
      </main>
    );
  }

  const overview = await getRangeOverview(branch.id, dateKey, view);
  const revenue = overview.appointments.reduce((sum, a) => sum + a.totalPrice, 0);

  return (
    <main className="flex min-h-0 flex-1 flex-col">
      {header}
      <CalendarStats
        items={[
          { label: "Хугацаа", value: `${view} хоног` },
          { label: "Захиалга", value: String(overview.appointments.length) },
          { label: "Нийт орлого", value: formatPrice(revenue) },
          { label: "Мастер", value: String(overview.staffCount) },
        ]}
        view={view}
      />
      <RangeOverview
        fromKey={dateKey}
        days={view}
        appointments={overview.appointments}
        staffCount={overview.staffCount}
      />
    </main>
  );
}

/** Өдрийн хураангуй — ачаалал, сул цаг. */
function dayStats(schedule: DaySchedule): StatItem[] {
  const working = schedule.staff.filter(
    (member) => member.schedules[0] && !member.schedules[0].isDayOff,
  );

  // Боломжит нийт минут — ажиллах мастеруудын цагаас чөлөөг хасна
  const capacityMinutes = working.reduce((sum, member) => {
    const shift = member.schedules[0];
    const offMinutes = member.timeOffs.reduce((offSum, off) => {
      const start = Math.max(off.startMin ?? 0, shift.startMin);
      const end = Math.min(off.endMin ?? 24 * 60, shift.endMin);
      return offSum + Math.max(0, end - start);
    }, 0);
    return sum + Math.max(0, shift.endMin - shift.startMin - offMinutes);
  }, 0);

  const active = schedule.appointments.filter(
    (a) => a.status !== "CANCELLED" && a.status !== "NO_SHOW",
  );
  const bookedMinutes = active.reduce(
    (sum, a) => sum + (a.endAt.getTime() - a.startAt.getTime()) / 60_000,
    0,
  );

  const load =
    capacityMinutes > 0 ? Math.round((bookedMinutes / capacityMinutes) * 100) : 0;

  return [
    { label: "Захиалга", value: String(active.length) },
    { label: "Ажиллах мастер", value: String(working.length) },
    { label: "Ачаалал", value: `${load}%` },
    {
      label: "Чөлөөт цаг",
      value: `${Math.max(0, Math.round((capacityMinutes - bookedMinutes) / 60))} ц`,
    },
    {
      label: "Цуцлагдсан",
      value: String(schedule.appointments.length - active.length),
    },
  ];
}
