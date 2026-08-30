"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { startTransition, useOptimistic } from "react";
import type { BranchSummary } from "@/lib/queries";
import { formatDateNumeric } from "@/lib/labels";
import { addDays, todayKey } from "@/lib/time";

type Props = {
  branches: BranchSummary[];
  activeBranchId: string;
  dateKey: string;
  /** Идэвхтэй салбарт захиалга бүртгэх эрхтэй эсэх */
  canWrite: boolean;
};

export function CalendarHeader({
  branches,
  activeBranchId,
  dateKey,
  canWrite,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Сервер шинэ хуудсыг буцаах хүртэл сонголтыг шууд харуулна
  const [optimistic, setOptimistic] = useOptimistic({
    branchId: activeBranchId,
    dateKey,
  });

  function navigate(next: Partial<typeof optimistic>, extra?: { new?: true }) {
    const merged = { ...optimistic, ...next };
    startTransition(() => {
      setOptimistic(merged);
      const params = new URLSearchParams(searchParams.toString());
      params.set("branch", merged.branchId);
      params.set("date", merged.dateKey);
      if (extra?.new) {
        // Шинэ захиалгын цонх нээх — өдрийн харагдац руу шилжинэ
        params.delete("view");
        params.set("new", "1");
      } else {
        params.delete("new");
      }
      router.push(`/calendar?${params.toString()}`);
    });
  }

  const today = todayKey();
  const isToday = optimistic.dateKey === today;
  const { date, weekday } = formatDateNumeric(optimistic.dateKey);

  return (
    <header className="no-print shrink-0 bg-sand-50">
      {/* ── Мөр 1: огноо ба үйлдэл ── */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2.5 px-4 pb-3 pt-4 md:gap-x-4 md:px-6 md:pt-5">
        <button
          type="button"
          onClick={() => navigate({ dateKey: today })}
          className={`shrink-0 rounded-full border px-3.5 py-1.5 text-sm transition hover:bg-sand-100 md:px-5 md:py-2 ${
            isToday
              ? "border-sand-200 text-sand-400"
              : "border-sand-300 text-sand-700"
          }`}
        >
          Өнөөдөр
        </button>

        <div className="order-last flex w-full items-center justify-center gap-2 md:order-none md:w-auto md:justify-start">
          <ArrowButton
            direction="prev"
            onClick={() => navigate({ dateKey: addDays(optimistic.dateKey, -1) })}
          />

          {/* Огноон дээр дарж хуанлиас сонгоно */}
          <label className="relative cursor-pointer">
            <span className="whitespace-nowrap font-mono text-base tracking-tight text-sand-900 md:text-xl">
              {date}
            </span>
            <span className="ml-2 hidden text-lg text-sand-400 sm:inline">
              {weekday}
            </span>
            <input
              type="date"
              value={optimistic.dateKey}
              onChange={(event) => {
                if (event.target.value) navigate({ dateKey: event.target.value });
              }}
              aria-label="Огноо сонгох"
              className="absolute inset-0 cursor-pointer opacity-0"
            />
          </label>

          <ArrowButton
            direction="next"
            onClick={() => navigate({ dateKey: addDays(optimistic.dateKey, 1) })}
          />
        </div>

        <div className="flex-1" />

        <button
          type="button"
          onClick={() => navigate({}, { new: true })}
          disabled={!canWrite}
          title={
            canWrite
              ? undefined
              : "Энэ салбарт захиалга бүртгэх эрхгүй — зөвхөн харна"
          }
          className="shrink-0 rounded-xl bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-sand-300 disabled:text-sand-500 disabled:shadow-none md:px-5 md:py-2.5"
        >
          <span aria-hidden className="mr-1.5">
            +
          </span>
          Захиалга<span className="hidden sm:inline"> нэмэх</span>
        </button>
      </div>

      {/* ── Мөр 2: салбарууд ── */}
      <div className="scrollbar-slim flex items-center gap-3 overflow-x-auto px-4 pb-4 md:px-6">
        <div className="flex shrink-0 items-center gap-1 rounded-full bg-sand-200/70 p-1">
          {branches.map((branch) => {
            const active = branch.id === optimistic.branchId;
            return (
              <button
                key={branch.id}
                type="button"
                onClick={() => navigate({ branchId: branch.id })}
                aria-current={active ? "true" : undefined}
                title={branch.address}
                className={`flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full px-4 py-1.5 text-sm transition md:gap-2.5 md:px-5 md:py-2 md:text-[15px] ${
                  active
                    ? "bg-white font-medium text-sand-900 shadow-sm"
                    : "text-sand-500 hover:text-sand-800"
                }`}
              >
                <span
                  aria-hidden
                  className={`size-1.5 rounded-full ${
                    active ? "bg-brand-500" : "bg-sand-400"
                  }`}
                />
                {branch.name}
              </button>
            );
          })}
        </div>

        {!canWrite ? (
          <span className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-warn-50 px-3 py-1.5 text-xs text-warn-700 ring-1 ring-warn-200">
            <span aria-hidden>👁</span>
            Зөвхөн харах — өөр салбарын хуанли
          </span>
        ) : null}
      </div>
    </header>
  );
}

function ArrowButton({
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
      aria-label={direction === "prev" ? "Өмнөх өдөр" : "Дараагийн өдөр"}
      className="flex size-8 items-center justify-center rounded-full text-lg text-sand-400 transition hover:bg-sand-200 hover:text-sand-800"
    >
      {direction === "prev" ? "‹" : "›"}
    </button>
  );
}
