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
          Нэг гол тоо — нийт орлого. Задаргаа нь хажуудаа тусдаа хайрцгуудаар:
          үйлчилгээ хэд, нэмэлт төлбөр хэд, хэдэн захиалга, нэг захиалга дунджаар хэд.
        */}
        <section className="grid gap-3 lg:grid-cols-[1.4fr_1fr]">
          <div className="relative overflow-hidden rounded-2xl bg-brand-700 px-5 py-6 text-white shadow-sm md:px-6">
            {/* Намуухан гэрэлтэлт — тоо нь дэвсгэрээсээ тодорно */}
            <span
              aria-hidden
              className="pointer-events-none absolute -right-16 -top-16 size-52 rounded-full bg-white/5"
            />
            <p className="text-sm text-brand-100">Нийт орлого</p>
            {/*
              Гол тоо нь sans, ЖИГД БУС цифрээр. Serif эсвэл `tabular-nums`
              хэрэглэвэл том хэмжээнд сул, чимэглэл шиг харагддаг — жигд өргөнтэй
              цифр нь зөвхөн багана дотор дээрээс доош эгнэх үед хэрэгтэй.
            */}
            <p className="mt-1 text-4xl font-semibold tracking-tight md:text-5xl">
              {formatPrice(report.total.total)}
            </p>
            <p className="mt-2 text-sm text-brand-100">
              {formatDateLong(start)} – {formatDateLong(end)}
            </p>
          </div>

          <dl className="grid grid-cols-2 gap-3">
            <Figure
              label="Үйлчилгээ"
              value={formatPrice(report.total.services)}
            />
            <Figure
              label="Нэмэлт төлбөр"
              value={formatPrice(report.total.extra)}
            />
            <Figure label="Захиалга" value={`${report.visits}`} />
            <Figure
              label="Дундаж дүн"
              value={
                report.visits > 0
                  ? formatPrice(Math.round(report.total.total / report.visits))
                  : "—"
              }
            />
          </dl>
        </section>

        <section>
          <h2 className="mb-3 text-sm font-semibold text-sand-800">
            Өдрөөр
            <span className="ml-2 font-normal text-sand-500">
              {report.days.length} өдөр
            </span>
          </h2>
          <RevenueChart days={report.days} />
        </section>

        <RevenueBreakdown services={report.services} staff={report.staff} />
      </div>
    </>
  );
}

/** Гол тооны хажуугийн жижиг хайрцаг. */
function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col justify-center rounded-2xl border border-sand-200 bg-white px-4 py-3">
      <dt className="text-xs text-sand-500">{label}</dt>
      <dd className="mt-1 text-lg font-semibold tracking-tight text-sand-900">
        {value}
      </dd>
    </div>
  );
}
