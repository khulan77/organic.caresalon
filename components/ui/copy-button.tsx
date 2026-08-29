"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Текстийг санах ойд хуулах товч.
 *
 * `navigator.clipboard` нь ЗӨВХӨН аюулгүй холболтод (https эсвэл localhost)
 * ажилладаг. Салон дотоод сүлжээгээр http-ээр нээвэл тэр нь байхгүй тул
 * хуучин `execCommand` руу унана — ресепшний товч ямар ч тохиолдолд ажиллана.
 */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Доорх нөөц аргаар үргэлжлүүлнэ
  }

  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

export function CopyButton({
  /** Хуулах текст — дарах агшинд шинээр тооцно (өгөгдөл шинэчлэгдсэн байж болно) */
  getText,
  label = "Хуулах",
  title,
  className,
  compact,
}: {
  getText: () => string;
  label?: string;
  title?: string;
  className?: string;
  compact?: boolean;
}) {
  const [state, setState] = useState<"idle" | "done" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  async function handle(event: React.MouseEvent) {
    // Хуанлийн блок дотор байвал захиалгын цонх нээгдэхээс сэргийлнэ
    event.stopPropagation();
    event.preventDefault();
    const ok = await copyText(getText());
    setState(ok ? "done" : "failed");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), 2000);
  }

  // Хоосон шошготой (зөвхөн дүрстэй) товчинд текст гаргахгүй — зөвхөн дүрс солигдоно
  const text = !label
    ? null
    : state === "done"
      ? "Хуулагдлаа"
      : state === "failed"
        ? "Болсонгүй"
        : label;

  return (
    <button
      type="button"
      onClick={handle}
      title={title ?? "Захиалгын мэдээллийг хуулах"}
      aria-live="polite"
      className={
        className ??
        `inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 font-medium transition ${
          compact ? "text-[11px]" : "text-xs"
        } ${
          state === "done"
            ? "border-brand-300 bg-brand-50 text-brand-700"
            : state === "failed"
              ? "border-danger-200 bg-danger-50 text-danger-700"
              : "border-sand-300 bg-white text-sand-700 hover:bg-sand-100"
        }`
      }
    >
      <CopyIcon done={state === "done"} />
      {text}
      {!label ? (
        <span className="sr-only">
          {state === "done" ? "Хуулагдлаа" : "Хуулах"}
        </span>
      ) : null}
    </button>
  );
}

function CopyIcon({ done }: { done: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-3.5 shrink-0"
      aria-hidden
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {done ? (
        <path d="m5 13 4 4L19 7" />
      ) : (
        <>
          <rect x="9" y="9" width="11" height="11" rx="2" />
          <path d="M5 15V5a2 2 0 0 1 2-2h10" />
        </>
      )}
    </svg>
  );
}
