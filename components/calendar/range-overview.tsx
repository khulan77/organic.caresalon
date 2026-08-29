"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMemo } from "react";
import { WEEKDAYS_SHORT, formatPrice } from "@/lib/labels";
import { addDays, toDateKey, todayKey, weekdayOf } from "@/lib/time";

type RangeAppointment = {
  startAt: Date;
  endAt: Date;
  totalPrice: number;
};

type Props = {
  fromKey: string;
  days: number;
  appointments: RangeAppointment[];
  staffCount: number;
};

/**
 * 15 / 30 хоногийн ачааллын тойм.
 * Ресепшн ойрын хугацааны завыг нэг харцаар олж, өдөр рүү нь шилжинэ.
 */
export function RangeOverview({
  fromKey,
  days,
  appointments,
  staffCount,
}: Props) {
  const searchParams = useSearchParams();
  const branchId = searchParams.get("branch");
  const today = todayKey();

  const byDay = useMemo(() => {
    const map = new Map<string, { count: number; revenue: number; minutes: number }>();
    for (const appt of appointments) {
      const key = toDateKey(appt.startAt);
      const entry = map.get(key) ?? { count: 0, revenue: 0, minutes: 0 };
      entry.count += 1;
      entry.revenue += appt.totalPrice;
      entry.minutes += (appt.endAt.getTime() - appt.startAt.getTime()) / 60_000;
      map.set(key, entry);
    }
    return map;
  }, [appointments]);

  const dayKeys = useMemo(
    () => Array.from({ length: days }, (_, index) => addDays(fromKey, index)),
    [fromKey, days],
  );

  // Ачааллын хувь — ажилтны тоо × 9 цагийн багтаамжаас
  const capacityMinutes = staffCount * 9 * 60;

  function hrefFor(dateKey: string) {
    const params = new URLSearchParams();
    if (branchId) params.set("branch", branchId);
    params.set("date", dateKey);
    return `/calendar?${params.toString()}`;
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto scrollbar-slim p-4 md:p-6">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-7">
        {dayKeys.map((dateKey) => {
          const stats = byDay.get(dateKey);
          const weekday = weekdayOf(dateKey);
          const isToday = dateKey === today;
          const isSunday = weekday === 0;
          const load =
            capacityMinutes > 0 && stats
              ? Math.min(100, Math.round((stats.minutes / capacityMinutes) * 100))
              : 0;
          const day = Number(dateKey.split("-")[2]);

          return (
            <Link
              key={dateKey}
              href={hrefFor(dateKey)}
              className={`group rounded-xl border p-3 transition hover:border-brand-400 hover:shadow-sm ${
                isToday
                  ? "border-brand-500 bg-brand-50"
                  : isSunday
                    ? "border-sand-200 bg-sand-50"
                    : "border-sand-200 bg-white"
              }`}
            >
              <div className="flex items-baseline justify-between">
                <span className="text-lg font-semibold text-sand-900">{day}</span>
                <span
                  className={`text-xs ${isSunday ? "text-danger-600" : "text-sand-500"}`}
                >
                  {WEEKDAYS_SHORT[weekday]}
                </span>
              </div>

              {stats ? (
                <>
                  <p className="mt-1.5 text-sm text-sand-700">
                    {stats.count} захиалга
                  </p>
                  <p className="text-xs text-sand-500">
                    {formatPrice(stats.revenue)}
                  </p>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-sand-200">
                    <div
                      className="h-full rounded-full bg-brand-500"
                      style={{ width: `${load}%` }}
                      aria-label={`Ачаалал ${load} хувь`}
                    />
                  </div>
                </>
              ) : (
                <p className="mt-1.5 text-sm text-sand-400">Захиалгагүй</p>
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
