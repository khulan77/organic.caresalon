import { requireAdmin } from "@/lib/auth";
import { getBranches } from "@/lib/queries";
import { getTimesheet, isMonthKey, monthOf } from "@/lib/timesheet";
import { todayKey } from "@/lib/time";
import { TimesheetView } from "@/components/staff/timesheet-view";

export const metadata = { title: "Цагийн бүртгэл" };

export default async function TimesheetPage(props: PageProps<"/timesheet">) {
  await requireAdmin();
  const params = await props.searchParams;

  const monthKey = isMonthKey(params.month)
    ? params.month
    : monthOf(todayKey());

  // Цалин 15 хоногоор олгогддог тул сарыг хагасаар нь харж болно
  const half = params.half === "1" || params.half === "2" ? params.half : null;

  const requested = typeof params.branch === "string" ? params.branch : "";
  const branches = await getBranches();
  const branchId = branches.some((b) => b.id === requested) ? requested : null;

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
