import { requireAdmin } from "@/lib/auth";
import { getBranches } from "@/lib/queries";
import { getReport, type Report } from "@/lib/reports";
import { formatDateLong, formatDuration, formatPrice } from "@/lib/labels";
import { isDateKey, todayKey } from "@/lib/time";
import { PAYMENT_METHOD_LABELS } from "@/lib/payments";
import { PageHeader } from "@/components/page-header";
import { ReportFilters } from "@/components/reports/report-filters";

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
        <Summary summary={report.summary} />

        <Section
          title="Төлбөрийн хэлбэрээр"
          hint="Тухайн хугацаанд бүртгэсэн бүх төлбөр — урьдчилгаа, үлдэгдэл, буцаалт."
          empty={report.payments.length === 0}
        >
          <Table head={["Хэлбэр", "Дүн"]} align="r">
            {report.payments.map((row) => (
              <tr key={row.method} className="hover:bg-sand-50">
                <td className="px-4 py-2.5 font-medium text-sand-900">
                  {PAYMENT_METHOD_LABELS[row.method]}
                </td>
                <Num>{formatPrice(row.amount)}</Num>
              </tr>
            ))}
          </Table>
        </Section>

        <Section
          title="Ажилтнаар"
          hint="«Ажилласан өдөр» = ядаж нэг захиалга авсан өдрийн тоо."
          empty={report.staff.length === 0}
        >
          <Table
            head={[
              "Ажилтан",
              "Ажилласан өдөр",
              "Захиалга",
              "Ажилласан цаг",
              "Дүн",
              "Хөнгөлөлт",
              "Орлого",
            ]}
            align="rrrrr"
          >
            {report.staff.map((member) => (
              <tr key={member.id} className="hover:bg-sand-50">
                <td className="px-4 py-2.5 font-medium text-sand-900">
                  <span className="flex items-center gap-2">
                    <span
                      aria-hidden
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: member.color }}
                    />
                    {member.name}
                  </span>
                </td>
                <Num>{member.workedDays}</Num>
                <Num>{member.appointments}</Num>
                <Num>{formatDuration(member.minutes)}</Num>
                <Num>{formatPrice(member.money.subtotal)}</Num>
                <Num muted>
                  {member.money.discount > 0
                    ? `− ${formatPrice(member.money.discount)}`
                    : "—"}
                </Num>
                <Num strong>{formatPrice(member.money.total)}</Num>
              </tr>
            ))}
          </Table>
        </Section>

        {branchId === null && report.branches.length > 1 ? (
          <Section title="Салбараар" empty={false}>
            <Table head={["Салбар", "Захиалга", "Дүн", "Хөнгөлөлт", "Орлого"]} align="rrrr">
              {report.branches.map((branch) => (
                <tr key={branch.id} className="hover:bg-sand-50">
                  <td className="px-4 py-2.5 font-medium text-sand-900">
                    {branch.name}
                  </td>
                  <Num>{branch.appointments}</Num>
                  <Num>{formatPrice(branch.money.subtotal)}</Num>
                  <Num muted>
                    {branch.money.discount > 0
                      ? `− ${formatPrice(branch.money.discount)}`
                      : "—"}
                  </Num>
                  <Num strong>{formatPrice(branch.money.total)}</Num>
                </tr>
              ))}
            </Table>
          </Section>
        ) : null}

        <Section
          title="Үйлчилгээгээр"
          hint="Дүн нь хөнгөлөлтийн ӨМНӨХ, захиалгын үеийн үнээр."
          empty={report.services.length === 0}
        >
          <Table head={["Үйлчилгээ", "Тоо", "Дүн"]} align="rr">
            {report.services.map((service) => (
              <tr key={service.name} className="hover:bg-sand-50">
                <td className="px-4 py-2.5 text-sand-900">{service.name}</td>
                <Num>{service.count}</Num>
                <Num strong>{formatPrice(service.amount)}</Num>
              </tr>
            ))}
          </Table>
        </Section>

        <Section title="Өдрөөр" empty={report.days.length === 0}>
          <DailyBars days={report.days} />
        </Section>
      </div>
    </>
  );
}

/** Дээд талын хураангуй хайрцгууд. */
function Summary({ summary }: { summary: Report["summary"] }) {
  const cards: { label: string; value: string; hint?: string; strong?: boolean }[] = [
    {
      label: "Орлого (дууссан)",
      value: formatPrice(summary.realized.total),
      hint: `${summary.realizedCount} захиалга`,
      strong: true,
    },
    {
      label: "Хүлээгдэж буй",
      value: formatPrice(summary.pending.total),
      hint: `${summary.pendingCount} захиалга`,
    },
    {
      label: "Гарт орсон",
      value: formatPrice(summary.collected),
      hint: "Бодитоор төлөгдсөн",
      strong: true,
    },
    {
      label: "Авах үлдэгдэл",
      value: formatPrice(summary.outstanding),
      hint: "Төлөгдөөгүй дүн",
    },
    {
      label: "Нийт дүн",
      value: formatPrice(summary.realized.subtotal + summary.pending.subtotal),
      hint: "Хөнгөлөлтийн өмнөх",
    },
    {
      label: "Нэмэлт төлбөр",
      value: formatPrice(summary.realized.extra + summary.pending.extra),
      hint: "Материал, урт хумс г.м.",
    },
    {
      label: "Хөнгөлөлт",
      value: formatPrice(summary.realized.discount + summary.pending.discount),
      hint: "Багц + гараар",
    },
    {
      label: "Дундаж дүн",
      value: formatPrice(summary.averageTicket),
      hint: "Нэг дууссан захиалганд",
    },
    {
      label: "Цуцлагдсан",
      value: `${summary.cancelledCount + summary.noShowCount}`,
      hint:
        summary.lostTotal > 0
          ? `${formatPrice(summary.lostTotal)} боломж алдсан`
          : "Цуцлалт, ирээгүй",
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
      {cards.map((card) => (
        <div
          key={card.label}
          className="rounded-xl border border-sand-200 bg-white px-4 py-3"
        >
          <p className="text-xs text-sand-500">{card.label}</p>
          <p
            className={`mt-1 tabular-nums ${
              card.strong
                ? "text-lg font-semibold text-sand-900"
                : "text-lg text-sand-800"
            }`}
          >
            {card.value}
          </p>
          {card.hint ? (
            <p className="mt-0.5 truncate text-xs text-sand-400">{card.hint}</p>
          ) : null}
        </div>
      ))}
    </div>
  );
}

/** Өдөр тутмын орлогыг харьцангуй уртаар харуулна. */
function DailyBars({ days }: { days: Report["days"] }) {
  const peak = Math.max(...days.map((day) => day.total), 1);

  return (
    <div className="scrollbar-slim overflow-x-auto rounded-xl border border-sand-200 bg-white">
      <table className="w-full min-w-[520px] text-sm">
        <tbody className="divide-y divide-sand-100">
          {days.map((day) => (
            <tr key={day.dateKey} className="hover:bg-sand-50">
              <td className="w-44 px-4 py-2 text-sand-700">
                {formatDateLong(day.dateKey)}
              </td>
              <td className="w-20 px-4 py-2 text-right tabular-nums text-sand-500">
                {day.appointments}
              </td>
              <td className="py-2 pr-4">
                <span
                  className="block h-2 rounded-full bg-brand-500/70"
                  style={{ width: `${Math.max(2, (day.total / peak) * 100)}%` }}
                />
              </td>
              <td className="w-32 px-4 py-2 text-right font-medium tabular-nums text-sand-900">
                {formatPrice(day.total)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Section({
  title,
  hint,
  empty,
  children,
}: {
  title: string;
  hint?: string;
  empty: boolean;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold text-sand-800">{title}</h2>
      {empty ? (
        <p className="rounded-xl border border-dashed border-sand-300 px-4 py-6 text-center text-sm text-sand-500">
          Энэ хугацаанд өгөгдөл алга.
        </p>
      ) : (
        <>
          {children}
          {hint ? <p className="mt-2 text-xs text-sand-500">{hint}</p> : null}
        </>
      )}
    </section>
  );
}

/**
 * Хүснэгтийн хүрээ. `align` нь ЭХНИЙ баганаас ХОЙШХ баганууд баруун
 * тийш эгнэх эсэхийг заана ("r" тэмдэгт бүр нэг багана).
 */
function Table({
  head,
  align,
  children,
}: {
  head: string[];
  align: string;
  children: React.ReactNode;
}) {
  return (
    <div className="scrollbar-slim overflow-x-auto rounded-xl border border-sand-200 bg-white">
      <table className="w-full min-w-[640px] text-sm">
        <thead className="border-b border-sand-200 bg-sand-50 text-left text-xs text-sand-600">
          <tr>
            {head.map((label, index) => (
              <th
                key={label}
                className={`px-4 py-2 font-medium ${
                  align[index - 1] === "r" ? "text-right" : ""
                }`}
              >
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-sand-100">{children}</tbody>
      </table>
    </div>
  );
}

function Num({
  children,
  strong,
  muted,
}: {
  children: React.ReactNode;
  strong?: boolean;
  muted?: boolean;
}) {
  return (
    <td
      className={`px-4 py-2.5 text-right tabular-nums ${
        strong
          ? "font-medium text-sand-900"
          : muted
            ? "text-sand-500"
            : "text-sand-700"
      }`}
    >
      {children}
    </td>
  );
}
