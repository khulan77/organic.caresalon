"use client";

import { useEffect } from "react";

/** Дэлгэцийн голд гарах цонх. Esc болон гадуур дарж хаана. */
export function Modal({
  title,
  onClose,
  children,
  footer,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-sand-900/40 sm:items-center sm:p-4">
      <button
        type="button"
        aria-label="Хаах"
        onClick={onClose}
        className="absolute inset-0"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`relative flex max-h-[92vh] w-full flex-col rounded-t-2xl bg-white shadow-xl sm:rounded-2xl ${
          wide ? "max-w-2xl" : "max-w-lg"
        }`}
      >
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-sand-200 px-5 py-4">
          <h2 className="font-serif text-lg text-sand-900">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Хаах"
            className="rounded-lg p-1.5 text-sand-500 transition hover:bg-sand-100 hover:text-sand-800"
          >
            ✕
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto scrollbar-slim px-5 py-4">
          {children}
        </div>

        {footer ? (
          <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-sand-200 px-5 py-3">
            {footer}
          </footer>
        ) : null}
      </div>
    </div>
  );
}
