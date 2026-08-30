"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { startTransition, useOptimistic } from "react";
import type { TimesheetCell, TimesheetRow } from "@/lib/timesheet";
import { MONTHS, WEEKDAYS_SHORT } from "@/lib/labels";
import { weekdayOf } from "@/lib/time";
import { PageHeader } from "@/components/page-header";

type BranchOption = { id: string; name: string };

/** 545 → "9.1". Excel рүү хуулахад тохиромжтой аравтын бутархай. */
function hours(minutes: number): string {
  return (Math.round((minutes / 60) * 10) / 10).toFixed(1);
}

/** Нүдэнд багтах богино хэлбэр: 120 → "2", 90 → "1.5". */
function shortHours(minutes: number): string {
  return String(Math.round((minutes / 60) * 10) / 10);
}

/**
 * Нүдний тэмдэглэгээ ба өнгө.
 *
 * Бүртгэл нь ЦАГААР биш ӨДРӨӨР бодогдоно: бүтэн ажилласан өдөр = ногоон ✓.
 * Амралтын өдөр шар, чөлөө авсан өдөр улаан. Цагийн чөлөө авсан өдөр бол
 * ✓ БИШ — авсан цагаа улаан нүдэнд шууд бичнэ (жишээ нь «−2ц»).
 */
const CELL_STYLE: Record<
  TimesheetCell["state"],
  { short: string; className: string; label: string }
> = {
  WORK: {
    short: "✓",
    className: "bg-ok-200 text-ok-700",
    label: "Ажилласан",
  },
  DAY_OFF: {
    short: "А",
    className: "bg-warn-200 text-warn-700",
    label: "Амралт",
  },
  ABSENT: {
    short: "Ч",
    className: "bg-danger-200 text-danger-700",
    label: "Бүтэн өдрийн чөлөө",
  },
  CLOSED: {
    // Салоны хаалт нь ажилтны буруу биш — саарлаар, төлөвийн өнгө эзлэхгүй
    short: "Х",
    className: "bg-sand-200 text-sand-500",
    label: "Салбар хаалттай",
  },
};

/** Цагийн чөлөө авсан өдөр — улаанаар, авсан цаг нь дотроо. */
const PARTIAL_CLASS = "bg-danger-50 text-danger-700 ring-1 ring-danger-200";

/** Өмнөх / дараагийн сар. */
function shiftMonth(monthKey: string, amount: number): string {
  const [year, month] = monthKey.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1 + amount, 1));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function TimesheetView({
  monthKey,
  branchId,
  branches,
  rows,
}: {
  monthKey: string;
  branchId: string | null;
  branches: BranchOption[];
  rows: TimesheetRow[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [optimistic, setOptimistic] = useOptimistic({ monthKey, branchId });

  function navigate(next: Partial<typeof optimistic>) {
    const merged = { ...optimistic, ...next };
    startTransition(() => {
      setOptimistic(merged);
      const params = new URLSearchParams(searchParams.toString());
      params.set("month", merged.monthKey);
      if (merged.branchId) params.set("branch", merged.branchId);
      else params.delete("branch");
      router.push(`/timesheet?${params.toString()}`);
    });
  }

  const days = rows[0]?.cells.map((cell) => cell.dateKey) ?? [];
  const [year, month] = optimistic.monthKey.split("-").map(Number);

  /**
   * Ажилтан бүрийн БҮТЭН ажилласан өдөр ба цагийн чөлөөтэй өдөр.
   * Чөлөө авсан өдрийг бүтэн өдөрт тоолохгүй — тусад нь харуулна.
   */
  const dayCount = new Map<string, { full: number; partial: number }>(
    rows.map((row) => [
      row.staffId,
      {
        full: row.cells.filter(
          (cell) => cell.state === "WORK" && cell.offMinutes === 0,
        ).length,
        partial: row.cells.filter(
          (cell) => cell.state === "WORK" && cell.offMinutes > 0,
        ).length,
      },
    ]),
  );

  const totalFullDays = [...dayCount.values()].reduce(
    (sum, entry) => sum + entry.full,
    0,
  );
  const totalPartialDays = [...dayCount.values()].reduce(
    (sum, entry) => sum + entry.partial,
    0,
  );

  /** Ажилтан бүрийн чөлөө авсан өдрүүд — хүснэгтийн доор жагсаана. */
  const leaveRows = rows
    .map((row) => ({
      row,
      leaves: row.cells.filter(
        (cell) =>
          cell.state === "ABSENT" ||
          (cell.state === "WORK" && cell.offMinutes > 0),
      ),
    }))
    .filter((entry) => entry.leaves.length > 0);

  return (
    <>
      <PageHeader
        title="Цагийн бүртгэл"
        subtitle={`${year} оны ${MONTHS[month - 1]} · ${totalFullDays} бүтэн өдөр${
          totalPartialDays > 0 ? ` · ${totalPartialDays} өдөр цагийн чөлөөтэй` : ""
        }`}
        action={
          <button
            type="button"
            onClick={() => downloadCsv(optimistic.monthKey, days, rows)}
            disabled={rows.length === 0}
            className="shrink-0 rounded-xl border border-sand-300 bg-white px-3.5 py-2 text-sm font-medium text-sand-700 transition hover:bg-sand-100 disabled:opacity-50"
          >
            Excel (CSV) татах
          </button>
        }
      />

      {/* ── Сар ба салбар сонгох ── */}
      <div className="scrollbar-slim flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-sand-200 bg-sand-50 px-4 py-2.5 md:px-6">
        <div className="flex shrink-0 items-center gap-1">
          <MonthArrow
            direction="prev"
            onClick={() =>
              navigate({ monthKey: shiftMonth(optimistic.monthKey, -1) })
            }
          />
          <label className="relative cursor-pointer px-2">
            <span className="whitespace-nowrap font-mono text-sm tabular-nums text-sand-900">
              {optimistic.monthKey}
            </span>
            <input
              type="month"
              value={optimistic.monthKey}
              onChange={(event) => {
                if (event.target.value) navigate({ monthKey: event.target.value });
              }}
              aria-label="Сар сонгох"
              className="absolute inset-0 cursor-pointer opacity-0"
            />
          </label>
          <MonthArrow
            direction="next"
            onClick={() =>
              navigate({ monthKey: shiftMonth(optimistic.monthKey, 1) })
            }
          />
        </div>

        {branches.length > 1 ? (
          <div className="flex shrink-0 items-center gap-1 rounded-full bg-sand-200/70 p-1">
            <Pill
              active={optimistic.branchId === null}
              onClick={() => navigate({ branchId: null })}
            >
              Бүх салбар
            </Pill>
            {branches.map((branch) => (
              <Pill
                key={branch.id}
                active={optimistic.branchId === branch.id}
                onClick={() => navigate({ branchId: branch.id })}
              >
                {branch.name}
              </Pill>
            ))}
          </div>
        ) : null}

        <div className="flex-1" />

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-sand-500">
          {(["WORK", "DAY_OFF", "ABSENT", "CLOSED"] as const).map((state) => (
            <span key={state} className="flex items-center gap-1.5">
              <span
                aria-hidden
                className={`flex size-4 items-center justify-center rounded text-[10px] font-semibold ${CELL_STYLE[state].className}`}
              >
                {CELL_STYLE[state].short}
              </span>
              {CELL_STYLE[state].label}
            </span>
          ))}
          <span className="flex items-center gap-1.5">
            <span
              aria-hidden
              className={`flex h-4 items-center justify-center rounded px-1 text-[9px] font-semibold ${PARTIAL_CLASS}`}
            >
              −2ц
            </span>
            Цагийн чөлөө авсан
          </span>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto scrollbar-slim p-4 md:p-6">
        {rows.length === 0 ? (
          <p className="rounded-xl border border-sand-200 bg-white px-4 py-10 text-center text-sand-500">
            Энэ сард бүртгэлтэй идэвхтэй ажилтан алга.
          </p>
        ) : (
          <div className="scrollbar-slim overflow-x-auto rounded-xl border border-sand-200 bg-white">
            <table className="w-max min-w-full border-separate border-spacing-0 text-sm">
              <thead>
                <tr>
                  {/* Нэрийн багана хэвтээ гүйлгэхэд наалдана */}
                  <th className="sticky left-0 z-20 border-b border-r border-sand-200 bg-sand-100/90 px-3 py-2 text-left text-xs font-medium text-sand-600 backdrop-blur">
                    Ажилтан
                  </th>
                  {days.map((dateKey) => {
                    const day = Number(dateKey.slice(8));
                    const weekday = weekdayOf(dateKey);
                    const weekend = weekday === 0 || weekday === 6;
                    return (
                      <th
                        key={dateKey}
                        className={`w-11 border-b border-sand-200 px-1 py-1.5 text-center text-[11px] font-medium ${
                          weekend ? "bg-sand-100 text-sand-500" : "text-sand-600"
                        }`}
                      >
                        <span className="block tabular-nums">{day}</span>
                        <span className="block text-[10px] font-normal text-sand-400">
                          {WEEKDAYS_SHORT[weekday]}
                        </span>
                      </th>
                    );
                  })}
                  <th className="sticky right-0 z-20 border-b border-l border-sand-200 bg-sand-100/90 px-3 py-2 text-right text-xs font-medium text-sand-600 backdrop-blur">
                    Нийт
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.staffId} className="hover:bg-sand-50/60">
                    <td className="sticky left-0 z-10 border-b border-r border-sand-100 bg-white px-3 py-2">
                      <span className="flex items-center gap-2">
                        <span
                          aria-hidden
                          className="size-2 shrink-0 rounded-full"
                          style={{ backgroundColor: row.color }}
                        />
                        <span className="whitespace-nowrap font-medium text-sand-900">
                          {row.name}
                        </span>
                      </span>
                      <span className="block whitespace-nowrap pl-4 text-xs text-sand-500">
                        {row.branchName}
                        {row.position ? ` · ${row.position}` : ""}
                      </span>
                    </td>

                    {row.cells.map((cell) => {
                      const style = CELL_STYLE[cell.state];
                      const partial =
                        cell.state === "WORK" && cell.offMinutes > 0;
                      return (
                        <td
                          key={cell.dateKey}
                          title={describeCell(cell)}
                          className="border-b border-sand-100 px-1 py-1.5 text-center"
                        >
                          {partial ? (
                            /* Цагийн чөлөө — авсан цаг нь нүдэн дотроо */
                            <span
                              className={`mx-auto flex h-7 min-w-7 items-center justify-center rounded-lg px-1 text-[10px] font-semibold tabular-nums ${PARTIAL_CLASS}`}
                            >
                              −{shortHours(cell.offMinutes)}ц
                            </span>
                          ) : (
                            <span
                              className={`mx-auto flex size-7 items-center justify-center rounded-lg text-xs font-semibold ${style.className}`}
                            >
                              {style.short}
                            </span>
                          )}
                        </td>
                      );
                    })}

                    <td className="sticky right-0 z-10 border-b border-l border-sand-100 bg-white px-3 py-2 text-right">
                      <span className="block whitespace-nowrap font-semibold tabular-nums text-sand-900">
                        {dayCount.get(row.staffId)?.full ?? 0} өдөр
                      </span>
                      {/* Чөлөөтэй өдөр байвал л нэмж бичнэ */}
                      {(dayCount.get(row.staffId)?.partial ?? 0) > 0 ||
                      row.totals.absentDays > 0 ? (
                        <span className="block whitespace-nowrap text-xs text-danger-600">
                          {[
                            (dayCount.get(row.staffId)?.partial ?? 0) > 0
                              ? `${dayCount.get(row.staffId)?.partial} цагийн чөлөө`
                              : null,
                            row.totals.absentDays > 0
                              ? `${row.totals.absentDays} бүтэн чөлөө`
                              : null,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="mt-3 text-xs text-sand-500">
          «Өдөр» гэдэг нь ЦАГИЙН ЧӨЛӨӨГҮЙ бүтэн ажилласан өдөр. Цагийн чөлөө
          авсан өдөр тусдаа тоологдож, авсан цаг нь нүдэн дээрээ бичигдэнэ.
          Долоо хоногийн амралт, салбарын хаалттай өдөр тоонд орохгүй.
        </p>

        {/* ── Чөлөө авсан өдрүүд ── */}
        {leaveRows.length > 0 ? (
          <section className="mt-5">
            <h2 className="mb-2 text-sm font-semibold text-sand-800">
              Чөлөө авсан өдрүүд
            </h2>
            <ul className="divide-y divide-sand-100 overflow-hidden rounded-2xl border border-sand-200 bg-white">
              {leaveRows.map(({ row, leaves }) => (
                <li
                  key={row.staffId}
                  className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:gap-4"
                >
                  <span className="flex shrink-0 items-center gap-2 sm:w-44">
                    <span
                      aria-hidden
                      className="size-2 shrink-0 rounded-full"
                      style={{ backgroundColor: row.color }}
                    />
                    <span className="truncate font-medium text-sand-900">
                      {row.name}
                    </span>
                    <span className="shrink-0 text-xs text-sand-400">
                      {leaves.length}
                    </span>
                  </span>

                  <span className="flex min-w-0 flex-wrap gap-1.5">
                    {leaves.map((cell) => {
                      const day = Number(cell.dateKey.slice(8));
                      const full = cell.state === "ABSENT";
                      return (
                        <span
                          key={cell.dateKey}
                          className={`inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs ${
                            full
                              ? "bg-danger-200 text-danger-700"
                              : "bg-danger-50 text-danger-700"
                          }`}
                        >
                          <span className="font-medium tabular-nums">
                            {month}/{day}
                          </span>
                          <span className="text-danger-600/80">
                            {WEEKDAYS_SHORT[weekdayOf(cell.dateKey)]}
                          </span>
                          <span>
                            {full ? "бүтэн өдөр" : `${hours(cell.offMinutes)} цаг`}
                          </span>
                          {cell.note ? (
                            <span className="truncate text-danger-600/80">
                              · {cell.note}
                            </span>
                          ) : null}
                        </span>
                      );
                    })}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </>
  );
}

function describeCell(cell: TimesheetCell): string {
  const style = CELL_STYLE[cell.state];
  if (cell.state === "WORK") {
    if (cell.offMinutes === 0) return "Ажилласан өдөр";
    return `Ажилласан өдөр · ${hours(cell.offMinutes)} цагийн чөлөө${
      cell.note ? ` (${cell.note})` : ""
    }`;
  }
  return cell.note ? `${style.label} — ${cell.note}` : style.label;
}

/** Хүснэгтийг CSV болгож татаж авна — Excel-д шууд нээгдэнэ. */
function downloadCsv(
  monthKey: string,
  days: string[],
  rows: TimesheetRow[],
): void {
  const escape = (value: string) => `"${value.replace(/"/g, '""')}"`;

  const header = [
    "Ажилтан",
    "Салбар",
    ...days.map((dateKey) => String(Number(dateKey.slice(8)))),
    "Бүтэн өдөр",
    "Цагийн чөлөөтэй өдөр",
    "Бүтэн чөлөө",
    "Амарсан өдөр",
    "Цагийн чөлөө (цаг)",
  ];

  // Бүтэн ажилласан өдөр = 1 (Excel дээр мөрөө шууд нийлүүлнэ),
  // цагийн чөлөөтэй өдөр «−2ц», бусад нь үсгээр
  const body = rows.map((row) => {
    const full = row.cells.filter(
      (cell) => cell.state === "WORK" && cell.offMinutes === 0,
    ).length;
    const partial = row.cells.filter(
      (cell) => cell.state === "WORK" && cell.offMinutes > 0,
    ).length;

    return [
      row.name,
      row.branchName,
      ...row.cells.map((cell) => {
        if (cell.state !== "WORK") return CELL_STYLE[cell.state].short;
        return cell.offMinutes > 0 ? `−${shortHours(cell.offMinutes)}ц` : "1";
      }),
      String(full),
      String(partial),
      String(row.totals.absentDays),
      String(row.totals.dayOffDays),
      hours(row.totals.offMinutes),
    ];
  });

  // BOM — Excel кирилл үсгийг зөв уншихад заавал хэрэгтэй
  const csv =
    "﻿" +
    [header, ...body].map((line) => line.map(escape).join(",")).join("\r\n");

  const url = URL.createObjectURL(
    new Blob([csv], { type: "text/csv;charset=utf-8;" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = `tsagiin-burtgel-${monthKey}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function Pill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm transition ${
        active
          ? "bg-white font-medium text-sand-900 shadow-sm"
          : "text-sand-500 hover:text-sand-800"
      }`}
    >
      {children}
    </button>
  );
}

function MonthArrow({
  direction,
  onClick,
}: {
  direction: "prev" | "next";
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={direction === "prev" ? "Өмнөх сар" : "Дараагийн сар"}
      className="flex size-8 items-center justify-center rounded-full text-lg text-sand-400 transition hover:bg-sand-200 hover:text-sand-800"
    >
      {direction === "prev" ? "‹" : "›"}
    </button>
  );
}
