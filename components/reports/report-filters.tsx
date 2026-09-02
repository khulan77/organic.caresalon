"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { startTransition, useOptimistic } from "react";
import type { BranchSummary } from "@/lib/queries";
import { addDays, todayKey } from "@/lib/time";
import { inputClass } from "@/components/ui/form";

type Preset = { key: string; label: string; range: () => [string, string] };

function monthStart(dateKey: string): string {
  return `${dateKey.slice(0, 7)}-01`;
}

function monthEnd(dateKey: string): string {
  const [year, month] = dateKey.split("-").map(Number);

  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${dateKey.slice(0, 7)}-${String(last).padStart(2, "0")}`;
}

const PRESETS: Preset[] = [
  {
    key: "today",
    label: "Өнөөдөр",
    range: () => [todayKey(), todayKey()],
  },
  {
    key: "week",
    label: "7 хоног",
    range: () => [addDays(todayKey(), -6), todayKey()],
  },
  {
    key: "month",
    label: "Энэ сар",
    range: () => [monthStart(todayKey()), todayKey()],
  },
  {
    key: "prev",
    label: "Өнгөрсөн сар",
    range: () => {
      const firstOfThis = monthStart(todayKey());
      const lastOfPrev = addDays(firstOfThis, -1);
      return [monthStart(lastOfPrev), monthEnd(lastOfPrev)];
    },
  },
];

export function ReportFilters({
  branches,
  fromKey,
  toKey,
  branchId,
}: {
  branches: BranchSummary[];
  fromKey: string;
  toKey: string;
  /** null бол бүх салбар */
  branchId: string | null;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Сервер шинэ хуудсыг буцаах хүртэл сонголтыг шууд харуулна
  const [optimistic, setOptimistic] = useOptimistic({
    fromKey,
    toKey,
    branchId: branchId ?? "all",
  });

  function navigate(next: Partial<typeof optimistic>) {
    const merged = { ...optimistic, ...next };
    startTransition(() => {
      setOptimistic(merged);
      const params = new URLSearchParams(searchParams.toString());
      params.set("from", merged.fromKey);
      params.set("to", merged.toKey);
      params.set("branch", merged.branchId);
      router.push(`/reports?${params.toString()}`);
    });
  }

  return (
    <div className="no-print flex flex-col gap-3 border-b border-sand-200 bg-sand-50 px-4 py-3 md:flex-row md:flex-wrap md:items-end md:gap-x-3 md:px-6">
      <div className="scrollbar-slim -mx-4 overflow-x-auto px-4 md:mx-0 md:overflow-visible md:px-0">
        <div className="flex w-max items-center gap-1 rounded-full bg-sand-200/70 p-1">
          {PRESETS.map((preset) => {
            const [presetFrom, presetTo] = preset.range();
            const active =
              optimistic.fromKey === presetFrom && optimistic.toKey === presetTo;
            return (
              <button
                key={preset.key}
                type="button"
                onClick={() => navigate({ fromKey: presetFrom, toKey: presetTo })}
                aria-current={active ? "true" : undefined}
                className={`whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm transition ${
                  active
                    ? "bg-white font-medium text-sand-900 shadow-sm"
                    : "text-sand-500 hover:text-sand-800"
                }`}
              >
                {preset.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Хоёр огноо — гар утсанд хагас хагасаараа зэрэгцэнэ */}
      <div className="grid grid-cols-2 gap-3 md:contents">
        <label className="block">
          <span className="mb-1 block text-xs text-sand-500">Эхлэх</span>
          <input
            type="date"
            value={optimistic.fromKey}
            max={optimistic.toKey}
            onChange={(event) => {
              if (event.target.value) navigate({ fromKey: event.target.value });
            }}
            className={`${inputClass} md:w-auto`}
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs text-sand-500">Дуусах</span>
          <input
            type="date"
            value={optimistic.toKey}
            min={optimistic.fromKey}
            onChange={(event) => {
              if (event.target.value) navigate({ toKey: event.target.value });
            }}
            className={`${inputClass} md:w-auto`}
          />
        </label>
      </div>

      <label className="block">
        <span className="mb-1 block text-xs text-sand-500">Салбар</span>
        <select
          value={optimistic.branchId}
          onChange={(event) => navigate({ branchId: event.target.value })}
          className={`${inputClass} md:w-auto`}
        >
          <option value="all">Бүх салбар</option>
          {branches.map((branch) => (
            <option key={branch.id} value={branch.id}>
              {branch.name}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
