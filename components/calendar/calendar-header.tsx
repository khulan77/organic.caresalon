"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { startTransition, useOptimistic } from "react";
import type { BranchSummary } from "@/lib/queries";
import { formatDateNumeric } from "@/lib/labels";
import { addDays, todayKey } from "@/lib/time";
import { setPreviewRole } from "@/app/(app)/preview-actions";
import type { Role } from "@/lib/generated/prisma/enums";

type Props = {
  branches: BranchSummary[];
  activeBranchId: string;
  dateKey: string;
  /** Хэрэглэгчийн БОДИТ эрх — зөвхөн админд урьдчилан харах товч гарна */
  realRole: Role;
  /** Одоо харуулж буй эрх (админ «Ресепшн» горимд орж болно) */
  effectiveRole: Role;
};

export function CalendarHeader({
  branches,
  activeBranchId,
  dateKey,
  realRole,
  effectiveRole,
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
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2.5 pb-3 pl-16 pr-4 pt-4 md:gap-x-4 md:px-6 md:pt-5">
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

        {realRole === "ADMIN" ? (
          <div className="hidden lg:block">
            <RolePreview effectiveRole={effectiveRole} />
          </div>
        ) : null}

        <button
          type="button"
          onClick={() => navigate({}, { new: true })}
          className="shrink-0 rounded-xl bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-brand-700 md:px-5 md:py-2.5"
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

/**
 * Админ UI-г «Ресепшн» эрхээр харах горим.
 * Зөвхөн ХАРАГДАХ БАЙДЛЫГ өөрчилнө — серверийн эрхийн шалгалтад нөлөөлөхгүй.
 */
function RolePreview({ effectiveRole }: { effectiveRole: Role }) {
  const options: { value: Role; label: string }[] = [
    { value: "ADMIN", label: "Админ" },
    { value: "RECEPTION", label: "Ресепшн" },
  ];

  return (
    <div
      className="flex items-center gap-2 rounded-full border border-dashed border-sand-300 py-1 pl-3 pr-1"
      title="Зөвхөн харагдах байдлыг урьдчилан харна. Жинхэнэ эрх өөрчлөгдөхгүй."
    >
      <span className="text-xs text-sand-500">Эрх</span>
      {options.map((option) => {
        const active = effectiveRole === option.value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => startTransition(() => setPreviewRole(option.value))}
            className={`rounded-full px-3 py-1.5 text-sm transition ${
              active
                ? "bg-brand-600 font-medium text-white"
                : "text-sand-600 hover:text-sand-900"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
