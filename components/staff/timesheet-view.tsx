"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { startTransition, useOptimistic, useState, useTransition } from "react";
import type { TimesheetCell, TimesheetRow } from "@/lib/timesheet";
import type { DayMarkKind } from "@/lib/generated/prisma/enums";
import { MONTHS, WEEKDAYS_SHORT } from "@/lib/labels";
import { weekdayOf } from "@/lib/time";
import { setDayMark } from "@/app/(app)/timesheet/actions";
import { PageHeader } from "@/components/page-header";
import { Issues } from "@/components/ui/form";

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
  FUTURE: {
    // Хуваариар ажлын өдөр боловч хараахан болоогүй — сул саарал
    short: "·",
    className: "bg-sand-50 text-sand-300",
    label: "Ирээгүй өдөр",
  },
};

/** Цагийн чөлөө авсан өдөр — улаанаар, авсан цаг нь дотроо. */
const PARTIAL_CLASS = "bg-danger-50 text-danger-700 ring-1 ring-danger-200";

/**
 * Нүд дээр дарахад ямар төлөв рүү шилжих вэ.
 *
 * ✓ Ажилласан → А Амралт → Ч Чөлөө → ✓ ... гэж эргэлдэнэ. Салбар хаалттай
 * өдөр эргэлдэхгүй — тэр нь ажилтны хэрэг биш.
 */
const NEXT_MARK: Record<TimesheetCell["state"], DayMarkKind | null> = {
  WORK: "DAY_OFF",
  FUTURE: "DAY_OFF",
  DAY_OFF: "LEAVE",
  ABSENT: "WORK",
  CLOSED: null,
};

/**
 * Цалин 15 хоногоор олгогддог тул сарыг хоёр хуваана.
 * `"1"` = 1–15, `"2"` = 16-аас сарын эцэс, `null` = бүтэн сар.
 */
export type Half = "1" | "2" | null;

/** Тухайн өдөр сонгосон хугацаанд багтаж байна уу. */
function inHalf(dateKey: string, half: Half): boolean {
  if (half === null) return true;
  const day = Number(dateKey.slice(8));
  return half === "1" ? day <= 15 : day > 15;
}

type Stat = {
  full: number;
  partial: number;
  absent: number;
  /** Амарсан өдөр — цалин тооцох өдөрт ороогүй */
  dayOff: number;
  /** Хуваариар ажиллах ёстой боловч хараахан болоогүй өдөр */
  planned: number;
};

/** Сонгосон хугацааны нүднүүдээс ажилтны дүн. */
function statOf(cells: TimesheetCell[]): Stat {
  return {
    full: cells.filter((c) => c.state === "WORK" && c.offMinutes === 0).length,
    partial: cells.filter((c) => c.state === "WORK" && c.offMinutes > 0).length,
    absent: cells.filter((c) => c.state === "ABSENT").length,
    dayOff: cells.filter((c) => c.state === "DAY_OFF").length,
    planned: cells.filter((c) => c.state === "FUTURE").length,
  };
}

/** Өмнөх / дараагийн сар. */
function shiftMonth(monthKey: string, amount: number): string {
  const [year, month] = monthKey.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1 + amount, 1));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function TimesheetView({
  monthKey,
  branchId,
  half,
  branches,
  rows,
  writableBranchIds,
}: {
  monthKey: string;
  branchId: string | null;
  half: Half;
  branches: BranchOption[];
  rows: TimesheetRow[];
  /** Аль салбарын бүртгэлийг тэмдэглэж болох вэ — ресепшнд зөвхөн харьяа нь */
  writableBranchIds: string[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [optimistic, setOptimistic] = useOptimistic({
    monthKey,
    branchId,
    half,
  });

  /**
   * Нүд дээр дарж тэмдэглэх.
   *
   * Тэмдэг нь ТЭР ДОРОО солигдоно (`useOptimistic`), сервер ард нь бичнэ —
   * ресепшн сарын турш олон нүд дардаг тул хүлээлгэж болохгүй. Сервер
   * татгалзвал шинэ өгөгдөл ирэхэд өөрөө хуучин байдалдаа эргэнэ.
   */
  const [markError, setMarkError] = useState<string[] | null>(null);
  const [, startMark] = useTransition();
  const [markPatch, patchMark] = useOptimistic(
    {} as Record<string, DayMarkKind>,
    (
      current: Record<string, DayMarkKind>,
      next: { key: string; kind: DayMarkKind },
    ) => ({ ...current, [next.key]: next.kind }),
  );

  /** Энэ ажилтны бүртгэлийг тэмдэглэж болох уу. */
  function canEdit(row: TimesheetRow): boolean {
    return writableBranchIds.includes(row.branchId);
  }

  /** Ядаж нэг мөрийг тэмдэглэж чадах эсэх — тайлбар харуулах эсэхэд. */
  const canEditAny = rows.some((row) => canEdit(row));

  function cycle(row: TimesheetRow, cell: TimesheetCell) {
    if (!canEdit(row)) return;
    const kind = NEXT_MARK[cell.state];
    if (!kind) return;

    setMarkError(null);
    startMark(async () => {
      patchMark({ key: `${row.staffId}|${cell.dateKey}`, kind });
      const outcome = await setDayMark({
        staffId: row.staffId,
        dateKey: cell.dateKey,
        kind,
      });
      if (!outcome.ok) setMarkError(outcome.issues);
    });
  }

  /** Дөнгөж дарсан нүдийг сервер бичиж амжаагүй байхад нь харуулна. */
  function patched(row: TimesheetRow, cell: TimesheetCell): TimesheetCell {
    const kind = markPatch[`${row.staffId}|${cell.dateKey}`];
    if (!kind) return cell;
    if (kind === "WORK") {
      return {
        ...cell,
        state: "WORK",
        minutes: cell.scheduledMinutes - cell.offMinutes,
        marked: true,
      };
    }
    return {
      ...cell,
      state: kind === "DAY_OFF" ? "DAY_OFF" : "ABSENT",
      minutes: 0,
      offMinutes: 0,
      marked: true,
    };
  }

  function navigate(next: Partial<typeof optimistic>) {
    const merged = { ...optimistic, ...next };
    startTransition(() => {
      setOptimistic(merged);
      const params = new URLSearchParams(searchParams.toString());
      params.set("month", merged.monthKey);
      if (merged.branchId) params.set("branch", merged.branchId);
      else params.delete("branch");
      if (merged.half) params.set("half", merged.half);
      else params.delete("half");
      router.push(`/timesheet?${params.toString()}`);
    });
  }

  const [year, month] = optimistic.monthKey.split("-").map(Number);
  const monthLength = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const mm = String(month).padStart(2, "0");

  /** Цалингийн хагас сар — сонгосон хугацаанд багтах өдрүүд л үлдэнэ. */
  const viewRows = rows.map((row) => ({
    ...row,
    cells: row.cells
      .filter((cell) => inHalf(cell.dateKey, optimistic.half))
      .map((cell) => patched(row, cell)),
  }));

  const days = viewRows[0]?.cells.map((cell) => cell.dateKey) ?? [];

  /** Тайлангийн хамрах хугацаа: «2026.08.01 – 08.15». */
  const firstDay = optimistic.half === "2" ? 16 : 1;
  const lastDay = optimistic.half === "1" ? 15 : monthLength;
  const rangeLabel = `${year}.${mm}.${String(firstDay).padStart(2, "0")} – ${mm}.${lastDay}`;

  /**
   * Ажилтан бүрийн БҮТЭН ажилласан өдөр, цагийн чөлөөтэй өдөр, бүтэн чөлөө.
   * Чөлөө авсан өдрийг бүтэн өдөрт тоолохгүй — тусад нь харуулна.
   */
  const stats = new Map<string, Stat>(
    viewRows.map((row) => [row.staffId, statOf(row.cells)]),
  );
  const statOfRow = (staffId: string): Stat =>
    stats.get(staffId) ?? {
      full: 0,
      partial: 0,
      absent: 0,
      dayOff: 0,
      planned: 0,
    };

  /** Ирээгүй өдөр байвал л тайлбарт нэмнэ — өнгөрсөн сард хэрэггүй. */
  const hasFuture = viewRows.some((row) =>
    row.cells.some((cell) => cell.state === "FUTURE"),
  );

  const totalFullDays = [...stats.values()].reduce((sum, s) => sum + s.full, 0);
  const totalPartialDays = [...stats.values()].reduce(
    (sum, s) => sum + s.partial,
    0,
  );

  /** Ажилтан бүрийн чөлөө авсан өдрүүд — хүснэгтийн доор жагсаана. */
  const leaveRows = viewRows
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
        subtitle={`${rangeLabel} · ${totalFullDays} бүтэн өдөр${
          totalPartialDays > 0 ? ` · ${totalPartialDays} чөлөөтэй` : ""
        }`}
        action={
          <button
            type="button"
            onClick={() =>
              downloadCsv(optimistic.monthKey, optimistic.half, days, viewRows)
            }
            disabled={rows.length === 0}
            className="shrink-0 rounded-xl border border-sand-300 bg-white px-3.5 py-2 text-sm font-medium text-sand-700 transition hover:bg-sand-100 disabled:opacity-50"
          >
            Excel (CSV) татах
          </button>
        }
      />

      {/* ── Сар ба салбар сонгох ── */}
      <div className="shrink-0 border-b border-sand-200 bg-sand-50 px-3 py-2 md:px-6 md:py-2.5">
        <div className="flex flex-col gap-1.5 md:flex-row md:flex-wrap md:items-center md:gap-x-3 md:gap-y-2">
          <div className="flex w-full shrink-0 items-center justify-between gap-1 md:w-auto md:justify-start">
            <MonthArrow
              direction="prev"
              onClick={() =>
                navigate({ monthKey: shiftMonth(optimistic.monthKey, -1) })
              }
            />
            <label className="relative flex cursor-pointer flex-col items-center px-2 leading-tight">
              <span className="whitespace-nowrap text-sm font-medium text-sand-900">
                {year} оны {MONTHS[month - 1]}
              </span>
              <span className="whitespace-nowrap font-mono text-[11px] tabular-nums text-sand-500">
                {rangeLabel}
              </span>
              <input
                type="month"
                value={optimistic.monthKey}
                onChange={(event) => {
                  if (event.target.value)
                    navigate({ monthKey: event.target.value });
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

          {/* Утсанд хоёр бүлэг нэг мөрөнд хэвтээ гүйнэ, дэлгэцэнд салж байрлана */}
          <div className="scrollbar-slim -mx-3 flex gap-2 overflow-x-auto px-3 md:mx-0 md:contents md:overflow-visible md:px-0">
            {/* Цалин 15 хоногоор олгогддог тул хагас сараар шүүнэ */}
            <div className="inline-flex shrink-0 items-center gap-1 rounded-full bg-sand-200/70 p-1">
              {(
                [
                  [null, "Бүтэн сар"],
                  ["1", "1–15"],
                  ["2", `16–${monthLength}`],
                ] as const
              ).map(([value, label]) => (
                <Pill
                  key={label}
                  active={optimistic.half === value}
                  onClick={() => navigate({ half: value })}
                >
                  {label}
                </Pill>
              ))}
            </div>

            {branches.length > 1 ? (
              <div className="inline-flex shrink-0 items-center gap-1 rounded-full bg-sand-200/70 p-1">
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
          </div>

          <div className="hidden flex-1 md:block" />

          {/* Утсанд толгойг цэвэрхэн байлгахаар тайлбарыг доор нь буулгав */}
          <Legend
            hasFuture={hasFuture}
            className="hidden md:flex md:flex-wrap md:items-center md:gap-x-3 md:gap-y-1"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto scrollbar-slim p-3 md:p-6">
        {markError ? (
          <div className="mb-3">
            <Issues issues={markError} />
          </div>
        ) : null}

        {rows.length === 0 ? (
          <p className="rounded-xl border border-sand-200 bg-white px-4 py-10 text-center text-sand-500">
            Энэ сард бүртгэлтэй идэвхтэй ажилтан алга.
          </p>
        ) : (
          /* ── Гар утас: ажилтан тус бүр нэг карт, дэлгэрэнгүй нь дарахад нээгдэнэ ── */
          <div className="space-y-1.5 md:hidden">
            {viewRows.map((row) => (
              <StaffCard
                key={row.staffId}
                row={row}
                stat={statOfRow(row.staffId)}
                onPick={
                  canEdit(row) ? (cell) => cycle(row, cell) : null
                }
              />
            ))}
          </div>
        )}

        {/* ── Таблет ба компьютер: бүтэн хүснэгт ── */}
        {rows.length > 0 ? (
          <div className="scrollbar-slim hidden overflow-x-auto rounded-xl border border-sand-200 bg-white md:block">
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
                {viewRows.map((row) => (
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
                      const editable =
                        canEdit(row) && NEXT_MARK[cell.state] !== null;
                      return (
                        <td
                          key={cell.dateKey}
                          className="border-b border-sand-100 px-1 py-1.5 text-center"
                        >
                          <button
                            type="button"
                            disabled={!editable}
                            onClick={() => cycle(row, cell)}
                            title={describeCell(cell, editable)}
                            className={`mx-auto flex h-7 min-w-7 items-center justify-center rounded-lg px-1 text-xs font-semibold transition ${
                              partial
                                ? `text-[10px] tabular-nums ${PARTIAL_CLASS}`
                                : style.className
                            } ${
                              editable
                                ? "cursor-pointer hover:brightness-95 active:scale-95"
                                : "cursor-default"
                            } ${cell.marked ? "ring-1 ring-sand-900/20" : ""}`}
                          >
                            {partial
                              ? `−${shortHours(cell.offMinutes)}ц`
                              : style.short}
                          </button>
                        </td>
                      );
                    })}

                    <td className="sticky right-0 z-10 border-b border-l border-sand-100 bg-white px-3 py-2 text-right">
                      <span className="block whitespace-nowrap font-semibold tabular-nums text-sand-900">
                        {statOfRow(row.staffId).full} өдөр
                      </span>
                      {/* Чөлөөтэй өдөр байвал л нэмж бичнэ */}
                      {leaveNote(statOfRow(row.staffId)) ? (
                        <span className="block whitespace-nowrap text-xs text-danger-600">
                          {leaveNote(statOfRow(row.staffId))}
                        </span>
                      ) : null}
                      {statOfRow(row.staffId).dayOff > 0 ? (
                        <span className="block whitespace-nowrap text-xs text-warn-600">
                          {statOfRow(row.staffId).dayOff} амралт
                        </span>
                      ) : null}
                      {statOfRow(row.staffId).planned > 0 ? (
                        <span className="block whitespace-nowrap text-xs text-sand-400">
                          {statOfRow(row.staffId).planned} хуваарьтай
                        </span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        <Legend
          hasFuture={hasFuture}
          className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 md:hidden"
        />

        <p className="mt-3 text-xs text-sand-500">
          {canEditAny ? (
            <>
              <strong className="font-medium text-sand-700">
                Нүд дээр дарж солино:
              </strong>{" "}
              ✓ Ажилласан → А Амралт → Ч Чөлөө → ✓. Амралтын өдөр долоо хоног
              бүр өөр байдаг тул гараар тэмдэглэсэн нь долоо хоногийн хуваарийг
              дардаг — хүрээтэй нүд нь гараар тавьсныг заана.{" "}
            </>
          ) : null}
          «Өдөр» гэдэг нь ЦАГИЙН ЧӨЛӨӨГҮЙ бүтэн ажилласан өдөр. Цагийн чөлөө
          авсан өдөр тусдаа тоологдож, авсан цаг нь нүдэн дээрээ бичигдэнэ.
          Амралт, салбарын хаалттай өдөр тоонд орохгүй.
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

/**
 * Гар утасны карт: нэр, салбар, нийт өдөр нь шууд харагдана.
 * Өдөр бүрийн бүртгэлийг дарж нээвэл сарын жижиг хуанли гарч ирнэ.
 */
function StaffCard({
  row,
  stat,
  onPick,
}: {
  row: TimesheetRow;
  stat: Stat;
  onPick: ((cell: TimesheetCell) => void) | null;
}) {
  const note = leaveNote(stat);

  return (
    <details className="group overflow-hidden rounded-2xl border border-sand-200 bg-white">
      <summary className="flex cursor-pointer list-none items-center gap-3 px-3.5 py-3 [&::-webkit-details-marker]:hidden">
        <span
          aria-hidden
          className="size-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: row.color }}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium text-sand-900">
            {row.name}
          </span>
          <span className="block truncate text-xs text-sand-500">
            {row.branchName}
            {row.position ? ` · ${row.position}` : ""}
          </span>
        </span>
        <span className="shrink-0 text-right">
          <span className="block whitespace-nowrap font-semibold tabular-nums text-sand-900">
            {stat.full} өдөр
          </span>
          {note ? (
            <span className="block whitespace-nowrap text-[11px] text-danger-600">
              {note}
            </span>
          ) : null}
          {stat.dayOff > 0 ? (
            <span className="block whitespace-nowrap text-[11px] text-warn-600">
              {stat.dayOff} амралт
            </span>
          ) : null}
          {stat.planned > 0 ? (
            <span className="block whitespace-nowrap text-[11px] text-sand-400">
              {stat.planned} хуваарьтай
            </span>
          ) : null}
        </span>
        <span
          aria-hidden
          className="shrink-0 text-lg text-sand-300 transition group-open:rotate-90"
        >
          ›
        </span>
      </summary>

      <div className="border-t border-sand-100 px-3 pb-3 pt-2">
        <MonthGrid cells={row.cells} onPick={onPick} />
      </div>
    </details>
  );
}

/** Сарын өдрүүд 7 баганаар — гарагийн байрандаа тааруулж эхэлнэ. */
function MonthGrid({
  cells,
  onPick,
}: {
  cells: TimesheetCell[];
  /** Тэмдэглэх эрхгүй бол `null` */
  onPick: ((cell: TimesheetCell) => void) | null;
}) {
  const lead = cells.length > 0 ? weekdayOf(cells[0].dateKey) : 0;

  return (
    <div className="grid grid-cols-7 gap-1 text-center">
      {WEEKDAYS_SHORT.map((label) => (
        <span key={label} className="pb-0.5 text-[10px] text-sand-400">
          {label}
        </span>
      ))}
      {Array.from({ length: lead }, (_, index) => (
        <span key={`lead-${index}`} aria-hidden />
      ))}
      {cells.map((cell) => {
        const style = CELL_STYLE[cell.state];
        const partial = cell.state === "WORK" && cell.offMinutes > 0;
        const editable = Boolean(onPick) && NEXT_MARK[cell.state] !== null;
        return (
          <button
            key={cell.dateKey}
            type="button"
            disabled={!editable}
            onClick={() => onPick?.(cell)}
            title={describeCell(cell, editable)}
            className={`flex h-9 flex-col items-center justify-center rounded-lg text-[11px] font-semibold leading-tight transition ${
              partial ? PARTIAL_CLASS : style.className
            } ${editable ? "active:scale-95" : ""} ${
              cell.marked ? "ring-1 ring-sand-900/20" : ""
            }`}
          >
            <span className="text-[9px] font-normal tabular-nums opacity-60">
              {Number(cell.dateKey.slice(8))}
            </span>
            <span className="tabular-nums">
              {partial ? `−${shortHours(cell.offMinutes)}ц` : style.short}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Нүдний тэмдэглэгээний тайлбар. */
function Legend({
  hasFuture,
  className,
}: {
  hasFuture: boolean;
  className: string;
}) {
  const states = hasFuture
    ? (["WORK", "DAY_OFF", "ABSENT", "CLOSED", "FUTURE"] as const)
    : (["WORK", "DAY_OFF", "ABSENT", "CLOSED"] as const);

  return (
    <div className={`text-[11px] text-sand-500 md:text-xs ${className}`}>
      {states.map((state) => (
        <span key={state} className="flex items-center gap-1.5">
          <span
            aria-hidden
            className={`flex size-4 shrink-0 items-center justify-center rounded text-[10px] font-semibold ${CELL_STYLE[state].className}`}
          >
            {CELL_STYLE[state].short}
          </span>
          {CELL_STYLE[state].label}
        </span>
      ))}
      <span className="flex items-center gap-1.5">
        <span
          aria-hidden
          className={`flex h-4 shrink-0 items-center justify-center rounded px-1 text-[9px] font-semibold ${PARTIAL_CLASS}`}
        >
          −2ц
        </span>
        Цагийн чөлөө авсан
      </span>
    </div>
  );
}

/** «1 цагийн чөлөө · 2 бүтэн чөлөө» — байхгүй бол хоосон мөр. */
function leaveNote(stat: Stat): string {
  return [
    stat.partial > 0 ? `${stat.partial} цагийн чөлөө` : null,
    stat.absent > 0 ? `${stat.absent} бүтэн чөлөө` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

function describeCell(cell: TimesheetCell, editable = false): string {
  const style = CELL_STYLE[cell.state];
  const hint = editable ? " · дарж солино" : "";
  const marked = cell.marked ? " (гараар)" : "";

  if (cell.state === "FUTURE") {
    return `${cell.note ? `Ирээгүй өдөр — ${cell.note}` : "Ирээгүй өдөр"}${hint}`;
  }
  if (cell.state === "WORK") {
    if (cell.offMinutes === 0) return `Ажилласан өдөр${marked}${hint}`;
    return `Ажилласан өдөр · ${hours(cell.offMinutes)} цагийн чөлөө${
      cell.note ? ` (${cell.note})` : ""
    }${hint}`;
  }
  return `${cell.note ? `${style.label} — ${cell.note}` : style.label}${marked}${hint}`;
}

/** Хүснэгтийг CSV болгож татаж авна — Excel-д шууд нээгдэнэ. */
function downloadCsv(
  monthKey: string,
  half: Half,
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
    const { full, partial, absent } = statOf(row.cells);
    const dayOff = row.cells.filter((cell) => cell.state === "DAY_OFF").length;
    const offMinutes = row.cells.reduce((sum, cell) => sum + cell.offMinutes, 0);

    return [
      row.name,
      row.branchName,
      ...row.cells.map((cell) => {
        // Ирээгүй өдрийг Excel дээр хоосон үлдээнэ — нийлбэрт нөлөөлөхгүй
        if (cell.state === "FUTURE") return "";
        if (cell.state !== "WORK") return CELL_STYLE[cell.state].short;
        return cell.offMinutes > 0 ? `−${shortHours(cell.offMinutes)}ц` : "1";
      }),
      String(full),
      String(partial),
      String(absent),
      String(dayOff),
      hours(offMinutes),
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
  link.download = `tsagiin-burtgel-${monthKey}${half ? `-${half}-hagas` : ""}.csv`;
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
      className={`whitespace-nowrap rounded-full px-3 py-1 text-[13px] transition md:px-3.5 md:py-1.5 md:text-sm ${
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
      className="flex size-8 shrink-0 items-center justify-center rounded-full text-lg text-sand-400 transition hover:bg-sand-200 hover:text-sand-800"
    >
      {direction === "prev" ? "‹" : "›"}
    </button>
  );
}
