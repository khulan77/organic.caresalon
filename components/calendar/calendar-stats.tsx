"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { startTransition, useOptimistic } from "react";

export type StatItem = { label: string; value: string };

const VIEWS = [
  { value: 0, label: "Өдөр", short: "Өдөр" },
  { value: 15, label: "15 хоног", short: "15х" },
  { value: 30, label: "30 хоног", short: "30х" },
];

export function CalendarStats({
  items,
  view,
}: {
  items: StatItem[];
  view: number;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [optimisticView, setOptimisticView] = useOptimistic(view);

  function changeView(next: number) {
    startTransition(() => {
      setOptimisticView(next);
      const params = new URLSearchParams(searchParams.toString());
      params.delete("new");
      if (next === 0) params.delete("view");
      else params.set("view", String(next));
      router.push(`/calendar?${params.toString()}`);
    });
  }

  return (
    <div className="no-print flex items-center gap-x-5 border-y border-sand-200 bg-sand-50 px-4 py-2.5 md:gap-x-8 md:px-6 md:py-2">
      <div className="scrollbar-slim flex min-w-0 flex-1 items-center gap-x-5 overflow-x-auto md:gap-x-8">
        {items.map((item) => (
          <p
            key={item.label}
            className="flex shrink-0 items-baseline gap-2 whitespace-nowrap text-sm"
          >
            <span className="text-sand-500">{item.label}</span>
            <span className="font-semibold text-sand-900">{item.value}</span>
          </p>
        ))}
      </div>

      <div className="flex shrink-0 items-center gap-0.5 rounded-full bg-sand-200/70 p-1">
        {VIEWS.map((item) => (
          <button
            key={item.value}
            type="button"
            onClick={() => changeView(item.value)}
            className={`whitespace-nowrap rounded-full px-2.5 py-1 text-xs transition md:px-3.5 ${
              optimisticView === item.value
                ? "bg-white font-medium text-sand-900 shadow-sm"
                : "text-sand-500 hover:text-sand-800"
            }`}
          >
            <span className="md:hidden">{item.short}</span>
            <span className="hidden md:inline">{item.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
