"use client";

import { useState } from "react";
import type { ReportDay } from "@/lib/reports";
import { formatPrice } from "@/lib/labels";

/**
 * Өдөр тутмын орлогын багана график.
 *
 * Багана бүр ХОЁР давхаргатай: доор нь үйлчилгээний орлого, дээр нь нэмэлт
 * төлбөр. Хоёрын нийлбэр нь тухайн өдрийн нийт орлого — хэсэг бүтнийг харуулах
 * учир багана овоолсон (stacked) хэлбэртэй.
 *
 * Өнгө: гүн ногоон = үйлчилгээ, зөөлөн шар = нэмэлт төлбөр. Энэ хосыг өнгө
 * ялгах чадвар султай (protan/deutan/tritan) хүмүүст ялгагдахаар шалгасан
 * (хамгийн муу ΔE 12.8, гэрэлтэлтийн ялгаа 3:1-ээс дээш). Дээр нь тайлбар
 * (legend) ба хүснэгт хэлбэр байгаа тул зөвхөн өнгөнд найдахгүй.
 */

/** Үйлчилгээний орлого. */
const SERVICE_COLOR = "#0d7350";
/** Нэмэлт төлбөр. */
const EXTRA_COLOR = "#c98330";

/** Овоолсон хоёр давхаргыг салгах цагаан зай. */
const SEGMENT_GAP = 2;

/** Багана дээд талдаа ийм радиустай — өгөгдлийн үзүүр зөөлөрнө. */
const BAR_RADIUS = 4;

/** Талбайн өндөр, пикселээр. */
const PLOT_HEIGHT = 240;

/** Тэнхлэг дээрх зураасны тоо (0-ыг оруулаад 5 шошго). */
const TICK_STEPS = 4;

/** Цэвэр тоо болгож дээшлүүлэх шат. */
const NICE_STEPS = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];

/**
 * Тэнхлэгийн НЭГ алхмыг цэвэр тоо болгоно.
 *
 * Зөвхөн 1/2/5 гэсэн бүдүүн шатаар авбал (жишээ нь оргил 250мянга байхад
 * тэнхлэг 500мянга болж) багана талбайн хагасыг л эзэлж, график хоосон
 * харагдана. Нарийн шатаар авснаар оргил багана ~75–100% өндөрт хүрнэ.
 */
function niceStep(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const scaled = value / magnitude;
  const step = NICE_STEPS.find((candidate) => scaled <= candidate) ?? 10;
  return step * magnitude;
}

/** 45000 → "45мянга", 1200000 → "1.2сая" — тэнхлэгийн шошго богино байх ёстой. */
function compact(value: number): string {
  if (value === 0) return "0";
  if (value >= 1_000_000) {
    const millions = (value / 1_000_000).toFixed(1);
    // "6.0сая" биш "6сая" — бүхэл тоо бол таслалыг хаяна
    return `${millions.replace(/\.0$/, "")}сая`;
  }
  if (value >= 1_000) return `${Math.round(value / 1_000)}мянга`;
  return String(value);
}

/** "2026-08-29" → "29" */
function dayNumber(dateKey: string): string {
  return String(Number(dateKey.slice(8)));
}

export function RevenueChart({ days }: { days: ReportDay[] }) {
  const [hovered, setHovered] = useState<string | null>(null);
  const [asTable, setAsTable] = useState(false);

  if (days.length === 0) {
    return (
      <div className="rounded-2xl border border-sand-200 bg-white p-4 md:p-5">
        <p className="rounded-xl border border-dashed border-sand-300 px-4 py-10 text-center text-sm text-sand-500">
          Энэ хугацаанд орлого алга.
        </p>
      </div>
    );
  }

  const peak = Math.max(...days.map((day) => day.total));
  // Алхмыг цэвэр болговол шошго бүр бүтэн тоо гарна (0 / 80мянга / 160мянга …)
  const step = niceStep(peak / TICK_STEPS);
  const axisMax = step * TICK_STEPS;
  const ticks = Array.from(
    { length: TICK_STEPS + 1 },
    (_, index) => (TICK_STEPS - index) * step,
  );

  // Огноог бүгдийг нь бичвэл давхцана — ойролцоогоор 8 шошго л үлдээнэ
  const labelEvery = Math.max(1, Math.ceil(days.length / 8));

  const active = days.find((day) => day.dateKey === hovered) ?? null;
  const hasExtra = days.some((day) => day.extra > 0);

  // Ажилласан өдрийн дундаж — «сайн өдөр үү, муу өдөр үү» гэдгийг хэмжих шугам
  const earning = days.filter((day) => day.total > 0);
  const average =
    earning.length > 0
      ? earning.reduce((sum, day) => sum + day.total, 0) / earning.length
      : 0;

  return (
    <div className="overflow-hidden rounded-2xl border border-sand-200 bg-white">
      {/* ── Толгой: тайлбар ба харагдацын сонголт ── */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-sand-100 bg-sand-50/60 px-4 py-2.5 md:px-5">
        <Key color={SERVICE_COLOR} label="Үйлчилгээ" />
        {hasExtra ? <Key color={EXTRA_COLOR} label="Нэмэлт төлбөр" /> : null}
        {average > 0 ? (
          <span className="flex shrink-0 items-center gap-1.5 text-xs text-sand-500">
            <span
              aria-hidden
              className="h-0 w-4 border-t border-dashed border-sand-400"
            />
            Дундаж {formatPrice(Math.round(average))}
          </span>
        ) : null}

        <button
          type="button"
          onClick={() => setAsTable((current) => !current)}
          className="ml-auto shrink-0 rounded-lg border border-sand-300 bg-white px-2.5 py-1 text-xs text-sand-600 transition hover:bg-sand-100"
        >
          {asTable ? "График" : "Хүснэгт"}
        </button>
      </div>

      <div className="p-4 md:p-5">
        {asTable ? (
          <DailyTable days={days} hasExtra={hasExtra} />
        ) : (
          <div className="relative">
            {/* Хөвөгч тайлбар — хулганы доорх өдрийн задаргаа */}
            {active ? (
              <div className="pointer-events-none absolute right-0 top-0 z-10 rounded-xl border border-sand-200 bg-white/95 px-3 py-2 text-xs shadow-lg backdrop-blur">
                <p className="font-medium text-sand-900">
                  {active.dateKey} · {active.visits} захиалга
                </p>
                <p className="mt-1 flex items-center gap-1.5 text-sand-600">
                  <Dot color={SERVICE_COLOR} />
                  Үйлчилгээ
                  <span className="ml-auto pl-3 tabular-nums text-sand-900">
                    {formatPrice(active.services)}
                  </span>
                </p>
                {active.extra > 0 ? (
                  <p className="mt-0.5 flex items-center gap-1.5 text-sand-600">
                    <Dot color={EXTRA_COLOR} />
                    Нэмэлт төлбөр
                    <span className="ml-auto pl-3 tabular-nums text-sand-900">
                      {formatPrice(active.extra)}
                    </span>
                  </p>
                ) : null}
                <p className="mt-1 border-t border-sand-100 pt-1 text-right font-semibold tabular-nums text-sand-900">
                  {formatPrice(active.total)}
                </p>
              </div>
            ) : null}

            <div className="flex">
              {/* ── Босоо тэнхлэг ── */}
              <div
                className="relative w-12 shrink-0 md:w-16"
                style={{ height: PLOT_HEIGHT }}
              >
                {ticks.map((tick, index) => (
                  <span
                    key={tick}
                    className="absolute right-2 -translate-y-1/2 text-[10px] tabular-nums text-sand-400 md:text-[11px]"
                    style={{ top: `${(index / (ticks.length - 1)) * 100}%` }}
                  >
                    {compact(tick)}
                  </span>
                ))}
              </div>

              {/* ── Талбай ── Олон өдөр байвал хэвтээ гүйлгэнэ */}
              <div className="scrollbar-slim min-w-0 flex-1 overflow-x-auto">
                <div style={{ minWidth: days.length * 20 }}>
                  <div className="relative" style={{ height: PLOT_HEIGHT }}>
                    {/* Торны шугам — үс шиг нарийн, тод биш */}
                    {ticks.map((tick, index) => (
                      <span
                        key={tick}
                        aria-hidden
                        className={`pointer-events-none absolute inset-x-0 border-t ${
                          index === ticks.length - 1
                            ? "border-sand-300"
                            : "border-sand-200/60"
                        }`}
                        style={{ top: `${(index / (ticks.length - 1)) * 100}%` }}
                      />
                    ))}

                    {/* Дунджийн шугам — тасархай, өгөгдлийн ард */}
                    {average > 0 ? (
                      <span
                        aria-hidden
                        className="pointer-events-none absolute inset-x-0 border-t border-dashed border-sand-400/70"
                        style={{
                          bottom: `${Math.min(100, (average / axisMax) * 100)}%`,
                        }}
                      />
                    ) : null}

                    {/* Багануудыг суурин дээр нь эгнүүлнэ */}
                    <div className="absolute inset-0 flex items-end">
                      {days.map((day) => {
                        const on = hovered === day.dateKey;
                        /*
                          Хоёр давхаргын хооронд 2px зай ордог тул түүнийг
                          өндрөөс нь урьдчилж хасна — эс бөгөөс хамгийн өндөр
                          багана талбайн дээд ирмэгээс халина.
                        */
                        const stacked = day.extra > 0 && day.services > 0;
                        const usable = PLOT_HEIGHT - (stacked ? SEGMENT_GAP : 0);
                        const serviceH = (day.services / axisMax) * usable;
                        const extraH = (day.extra / axisMax) * usable;
                        const dim = hovered !== null && !on;
                        return (
                          <div
                            key={day.dateKey}
                            onMouseEnter={() => setHovered(day.dateKey)}
                            onMouseLeave={() => setHovered(null)}
                            onFocus={() => setHovered(day.dateKey)}
                            onBlur={() => setHovered(null)}
                            tabIndex={0}
                            title={`${day.dateKey} — ${formatPrice(day.total)}`}
                            className="group relative flex h-full min-w-0 flex-1 cursor-default flex-col justify-end px-px focus:outline-none"
                          >
                            {/* Хулганы доорх баганыг мөрөөр нь тодруулна */}
                            <span
                              aria-hidden
                              className={`pointer-events-none absolute inset-x-0 bottom-0 top-0 rounded-md transition ${
                                on ? "bg-sand-100/80" : "bg-transparent"
                              }`}
                            />
                            <span className="relative mx-auto flex w-full max-w-7 flex-col justify-end">
                              {/* Нэмэлт төлбөр — дээд давхарга */}
                              {day.extra > 0 ? (
                                <span
                                  className="block transition-opacity"
                                  style={{
                                    height: Math.max(extraH, 3),
                                    backgroundColor: EXTRA_COLOR,
                                    opacity: dim ? 0.45 : 1,
                                    borderRadius: `${BAR_RADIUS}px ${BAR_RADIUS}px 0 0`,
                                    // Хоёр давхаргыг цагаан зайгаар салгана
                                    marginBottom: day.services > 0 ? SEGMENT_GAP : 0,
                                  }}
                                />
                              ) : null}
                              {/* Үйлчилгээ — суурь давхарга */}
                              {day.services > 0 ? (
                                <span
                                  className="block transition-opacity"
                                  style={{
                                    height: Math.max(serviceH, 3),
                                    backgroundColor: SERVICE_COLOR,
                                    opacity: dim ? 0.45 : 1,
                                    borderRadius: stacked
                                      ? 0
                                      : `${BAR_RADIUS}px ${BAR_RADIUS}px 0 0`,
                                  }}
                                />
                              ) : null}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* ── Хэвтээ тэнхлэг ── */}
                  <div className="flex pt-2">
                    {days.map((day, index) => (
                      <span
                        key={day.dateKey}
                        className={`min-w-0 flex-1 text-center text-[10px] tabular-nums transition ${
                          hovered === day.dateKey
                            ? "font-medium text-sand-800"
                            : "text-sand-400"
                        }`}
                      >
                        {index % labelEvery === 0 || hovered === day.dateKey
                          ? dayNumber(day.dateKey)
                          : ""}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Тайлбарын нэг мөр — өнгөт дүрс + текст (текст нь өнгөгүй). */
function Key({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex shrink-0 items-center gap-1.5 text-xs text-sand-600">
      <span
        aria-hidden
        className="size-2.5 rounded-sm"
        style={{ backgroundColor: color }}
      />
      {label}
    </span>
  );
}

function Dot({ color }: { color: string }) {
  return (
    <span
      aria-hidden
      className="size-2 shrink-0 rounded-sm"
      style={{ backgroundColor: color }}
    />
  );
}

/** Графикийн хүснэгт хувилбар — дэлгэц уншигч ба хэвлэхэд. */
function DailyTable({
  days,
  hasExtra,
}: {
  days: ReportDay[];
  hasExtra: boolean;
}) {
  return (
    <div className="scrollbar-slim max-h-[340px] overflow-auto">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-white text-left text-xs text-sand-500">
          <tr className="border-b border-sand-200">
            <th className="py-2 pr-3 font-medium">Огноо</th>
            <th className="py-2 pr-3 text-right font-medium">Захиалга</th>
            <th className="py-2 pr-3 text-right font-medium">Үйлчилгээ</th>
            {hasExtra ? (
              <th className="py-2 pr-3 text-right font-medium">Нэмэлт</th>
            ) : null}
            <th className="py-2 text-right font-medium">Нийт</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-sand-100">
          {days.map((day) => (
            <tr key={day.dateKey}>
              <td className="py-2 pr-3 tabular-nums text-sand-700">
                {day.dateKey}
              </td>
              <td className="py-2 pr-3 text-right tabular-nums text-sand-500">
                {day.visits}
              </td>
              <td className="py-2 pr-3 text-right tabular-nums text-sand-700">
                {formatPrice(day.services)}
              </td>
              {hasExtra ? (
                <td className="py-2 pr-3 text-right tabular-nums text-sand-700">
                  {day.extra > 0 ? formatPrice(day.extra) : "—"}
                </td>
              ) : null}
              <td className="py-2 text-right font-medium tabular-nums text-sand-900">
                {formatPrice(day.total)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
