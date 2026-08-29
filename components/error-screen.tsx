"use client";

/**
 * Алдаа гарсан үед харагдах дэлгэц.
 *
 * Зорилго: хуудас «цагаан» болж уначихгүй байх. React-ийн алдааны хил
 * хязгаар (error.tsx) энэ бүрдлийг харуулж, ресепшн ажлаа үргэлжлүүлэх
 * замыг санал болгоно.
 */
export function ErrorScreen({
  title = "Алдаа гарлаа",
  description = "Түр саатал үүслээ. Дахин оролдоод үзнэ үү — өгөгдөл тань хэвээр байгаа.",
  error,
  retry,
}: {
  title?: string;
  description?: string;
  error?: Error & { digest?: string };
  retry?: () => void;
}) {
  return (
    <div className="grid min-h-0 flex-1 place-items-center bg-sand-50 p-6">
      <div className="w-full max-w-md rounded-2xl border border-sand-200 bg-white p-6 text-center shadow-sm">
        <span
          aria-hidden
          className="mx-auto flex size-12 items-center justify-center rounded-full bg-danger-50 text-2xl text-danger-600"
        >
          !
        </span>

        <h1 className="mt-4 font-serif text-lg text-sand-900">{title}</h1>
        <p className="mt-1.5 text-sm text-sand-600">{description}</p>

        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {retry ? (
            <button
              type="button"
              onClick={retry}
              className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-700"
            >
              Дахин оролдох
            </button>
          ) : null}
          <a
            href="/calendar"
            className="rounded-xl border border-sand-300 px-4 py-2 text-sm text-sand-700 transition hover:bg-sand-100"
          >
            Хуанли руу буцах
          </a>
        </div>

        {/* Алдааны дугаарыг харуулна — хөгжүүлэгчид мэдээлэхэд хэрэгтэй */}
        {error?.digest ? (
          <p className="mt-4 font-mono text-[11px] text-sand-400">
            Алдааны дугаар: {error.digest}
          </p>
        ) : null}
      </div>
    </div>
  );
}
