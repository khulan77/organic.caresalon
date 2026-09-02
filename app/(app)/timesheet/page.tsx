import { requireUser } from "@/lib/auth";
import { getBranches } from "@/lib/queries";
import { getTimesheet, isMonthKey, monthOf } from "@/lib/timesheet";
import { todayKey } from "@/lib/time";
import { TimesheetView } from "@/components/staff/timesheet-view";

export const metadata = { title: "Цагийн бүртгэл" };

export default async function TimesheetPage(props: PageProps<"/timesheet">) {
  const user = await requireUser();
  const params = await props.searchParams;

  /**
   * Ресепшн ЗӨВХӨН харьяа салбараа харна — ажилчид нь хэдэн өдөр ажилласныг
   * лавлахад хэрэгтэй. Салбар сонгох боломж өгөхгүй: доор салбарын жагсаалтад
   * өөрийнх нь салбар ганцаараа очиж, шүүлтүүр нь өөрөө нуугдана.
   * Админд хязгаар байхгүй.
   */
  const isAdmin = user.role === "ADMIN";

  const monthKey = isMonthKey(params.month)
    ? params.month
    : monthOf(todayKey());

  // Цалин 15 хоногоор олгогддог тул сарыг хагасаар нь харж болно
  const half = params.half === "1" || params.half === "2" ? params.half : null;

  const requested = typeof params.branch === "string" ? params.branch : "";
  const all = await getBranches();

  const own = isAdmin ? null : all.find((b) => b.id === user.branchId);
  if (!isAdmin && !own) {
    return (
      <main className="grid flex-1 place-items-center p-8 text-center text-sand-600">
        <div>
          <p className="text-lg font-medium text-sand-800">
            Танд салбар оноогоогүй байна.
          </p>
          <p className="mt-1 text-sm">
            Админ таныг салбарт хамааруулсны дараа цагийн бүртгэл харагдана.
          </p>
        </div>
      </main>
    );
  }

  const branches = own ? [own] : all;
  const branchId = own
    ? own.id
    : branches.some((b) => b.id === requested)
      ? requested
      : null;

  const rows = await getTimesheet({ monthKey, branchId });

  return (
    <TimesheetView
      monthKey={monthKey}
      branchId={branchId}
      half={half}
      branches={branches.map((branch) => ({ id: branch.id, name: branch.name }))}
      rows={rows}
    />
  );
}
