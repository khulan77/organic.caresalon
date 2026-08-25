"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { startTransition, useOptimistic } from "react";

export type StatItem = { label: string; value: string };

const VIEWS = [
  { value: 0, label: "Өдөр" },
  { value: 15, label: "15 хоног" },
  { value: 30, label: "30 хоног" },
];

/** Хуанлийн толгойн доорх хураангуй мөр ба харагдацын сонголт. */
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
    <div className="no-print flex flex-wrap items-center gap-x-8 gap-y-2 border-y border-sand-200 bg-sand-50 px-6 py-3">
      {items.map((item) => (
        <p key={item.label} className="flex items-baseline gap-2 text-sm">
          <span className="text-sand-500">{item.label}</span>
          <span className="font-semibold text-sand-900">{item.value}</span>
        </p>
      ))}

      <div className="flex-1" />

      <div className="flex items-center gap-0.5 rounded-full bg-sand-200/70 p-1">
        {VIEWS.map((item) => (
          <button
            key={item.value}
            type="button"
            onClick={() => changeView(item.value)}
            className={`rounded-full px-3.5 py-1 text-sm transition ${
              optimisticView === item.value
                ? "bg-white font-medium text-sand-900 shadow-sm"
                : "text-sand-500 hover:text-sand-800"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
}
