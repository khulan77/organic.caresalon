import { requireAdmin } from "@/lib/auth";
import { getBranches } from "@/lib/queries";
import { getReport } from "@/lib/reports";
import { formatDateLong, formatPrice } from "@/lib/labels";
import { isDateKey, todayKey } from "@/lib/time";
import { PageHeader } from "@/components/page-header";
import { ReportFilters } from "@/components/reports/report-filters";
import { RevenueBreakdown } from "@/components/reports/revenue-breakdown";
import { RevenueChart } from "@/components/reports/revenue-chart";

export const metadata = { title: "Тайлан" };

export default async function ReportsPage(props: PageProps<"/reports">) {
  await requireAdmin();
  const params = await props.searchParams;

  // Анхдагч муж — сарын эхнээс өнөөдөр хүртэл
  const today = todayKey();
  const fromKey = isDateKey(params.from) ? params.from : `${today.slice(0, 7)}-01`;
  const toKey = isDateKey(params.to) ? params.to : today;

  const branches = await getBranches();
  const requested = typeof params.branch === "string" ? params.branch : "all";
  const branchId = branches.some((b) => b.id === requested) ? requested : null;

  // Огноог урвуу оруулсан бол сольж өгнө — хоосон тайлан харуулахгүй
  const [start, end] = fromKey <= toKey ? [fromKey, toKey] : [toKey, fromKey];

  const report = await getReport({ fromKey: start, toKey: end, branchId });

  const branchName = branchId
    ? (branches.find((b) => b.id === branchId)?.name ?? "")
    : "Бүх салбар";

  return (
    <>
      <PageHeader
        title="Тайлан"
        subtitle={`${branchName} · ${formatDateLong(start)} – ${formatDateLong(end)}`}
      />

      <ReportFilters
        branches={branches}
        fromKey={fromKey}
        toKey={toKey}
        branchId={branchId}
      />

      <div className="min-h-0 flex-1 space-y-6 overflow-auto scrollbar-slim p-4 md:p-6">
        {/*
          Нэг гол тоо — нийт орлого. Задаргаа нь доор нь жижгээр:
          үйлчилгээ хэд, нэмэлт төлбөр хэд, хэдэн захиалга.
        */}
        <section className="rounded-xl border border-sand-200 bg-white px-5 py-5 md:px-6 md:py-6">
          <p className="text-sm text-sand-500">Нийт орлого</p>
          {/*
            Гол тоо нь sans, ЖИГД БУС цифрээр. Serif эсвэл `tabular-nums`
            хэрэглэвэл том хэмжээнд сул, чимэглэл шиг харагддаг — жигд өргөнтэй
            цифр нь зөвхөн багана дотор дээрээс доош эгнэх үед хэрэгтэй.
          */}
          <p className="mt-1 text-4xl font-semibold tracking-tight text-sand-900 md:text-5xl">
            {formatPrice(report.total.total)}
          </p>

          <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-3 border-t border-sand-100 pt-4">
            <Figure label="Үйлчилгээ" value={formatPrice(report.total.services)} />
            <Figure label="Нэмэлт төлбөр" value={formatPrice(report.total.extra)} />
            <Figure label="Захиалга" value={String(report.visits)} />
          </dl>
        </section>

        <section>
          <h2 className="mb-3 text-sm font-semibold text-sand-800">Өдрөөр</h2>
          <RevenueChart days={report.days} />
        </section>

        <RevenueBreakdown services={report.services} staff={report.staff} />
      </div>
    </>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-sand-500">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium text-sand-900">{value}</dd>
    </div>
  );
}
