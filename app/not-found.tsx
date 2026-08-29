import Link from "next/link";

export const metadata = { title: "Хуудас олдсонгүй" };

export default function NotFound() {
  return (
    <div className="grid min-h-screen place-items-center bg-shell p-6">
      <div className="w-full max-w-md rounded-2xl border border-sand-200 bg-white p-6 text-center shadow-sm">
        <p className="font-mono text-3xl text-sand-300">404</p>
        <h1 className="mt-2 font-serif text-lg text-sand-900">
          Хуудас олдсонгүй
        </h1>
        <p className="mt-1.5 text-sm text-sand-600">
          Хаяг буруу эсвэл энэ хуудас устсан байна.
        </p>
        <Link
          href="/calendar"
          className="mt-5 inline-block rounded-xl bg-brand-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-700"
        >
          Хуанли руу буцах
        </Link>
      </div>
    </div>
  );
}
