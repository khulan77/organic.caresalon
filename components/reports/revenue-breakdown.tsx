"use client";

import { useState } from "react";
import type { ReportService, ReportStaff } from "@/lib/reports";
import { formatPrice } from "@/lib/labels";

/**
 * Орлогын задаргаа — үйлчилгээгээр эсвэл ажилтнаар.
 *
 * Хоёулаа НЭГ л хэмжигдэхүүнийг (орлого) их-бага дарааллаар харуулдаг тул
 * нэг өнгийн урт баганаар зурна. Ганц цуваа учир тайлбар (legend) хэрэггүй —
 * гарчиг нь юуг хэмжиж байгааг хэлж байна.
 */

/* Нэг л хэмжигдэхүүн (орлого) — өдрийн графиктай ИЖИЛ өнгө хэрэглэнэ. */
const BAR_COLOR = "#0d7350";

type Tab = "services" | "staff";

export function RevenueBreakdown({
  services,
  staff,
}: {
  services: ReportService[];
  staff: ReportStaff[];
}) {
  const [tab, setTab] = useState<Tab>("services");

  const rows =
    tab === "services"
      ? services.map((row) => ({
          key: row.name,
          name: row.name,
          note: `${row.count} удаа`,
          amount: row.amount,
          color: null as string | null,
        }))
      : staff.map((row) => ({
          key: row.id,
          name: row.name,
          note: `${row.visits} захиалга`,
          amount: row.total,
          color: row.color,
        }));

  const peak = Math.max(...rows.map((row) => row.amount), 1);
  const sum = rows.reduce((acc, row) => acc + row.amount, 0);

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h2 className="shrink-0 text-sm font-semibold text-sand-800">
          Задаргаа
        </h2>
        <div className="flex shrink-0 items-center gap-1 rounded-full bg-sand-200/70 p-1">
          <Tab active={tab === "services"} onClick={() => setTab("services")}>
            Үйлчилгээгээр
          </Tab>
          <Tab active={tab === "staff"} onClick={() => setTab("staff")}>
            Ажилтнаар
          </Tab>
        </div>
        <p className="text-xs text-sand-500">
          {rows.length} мөр · {formatPrice(sum)}
        </p>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-sand-300 px-4 py-8 text-center text-sm text-sand-500">
          Энэ хугацаанд өгөгдөл алга.
        </p>
      ) : (
        <ul className="divide-y divide-sand-100 overflow-hidden rounded-2xl border border-sand-200 bg-white">
          {rows.map((row) => (
            <li key={row.key} className="px-4 py-3 transition hover:bg-sand-50">
              <div className="flex items-baseline gap-3">
                <span className="flex min-w-0 flex-1 items-center gap-2">
                  {row.color ? (
                    <span
                      aria-hidden
                      className="size-2 shrink-0 rounded-full"
                      style={{ backgroundColor: row.color }}
                    />
                  ) : null}
                  <span className="truncate text-sm text-sand-900">
                    {row.name}
                  </span>
                  <span className="shrink-0 text-xs text-sand-400">
                    {row.note}
                  </span>
                </span>
                <span className="shrink-0 text-sm font-medium tabular-nums text-sand-900">
                  {formatPrice(row.amount)}
                </span>
              </div>

              {/* Харьцангуй хэмжээг нүдээр харуулах богино багана */}
              <span
                aria-hidden
                className="mt-2 block h-1.5 w-full overflow-hidden rounded-full bg-sand-100"
              >
                <span
                  className="block h-full rounded-full"
                  style={{
                    width: `${Math.max(1.5, (row.amount / peak) * 100)}%`,
                    backgroundColor: BAR_COLOR,
                  }}
                />
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Tab({
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
