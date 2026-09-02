"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { logout } from "@/app/login/actions";
import { ROLE_LABELS } from "@/lib/labels";
import type { CurrentUser } from "@/lib/session";

type NavItem = {
  href: string;
  label: string;
  icon: React.ReactNode;
};

const stroke = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

const CalendarIcon = (
  <svg viewBox="0 0 24 24" className="size-5 shrink-0" aria-hidden {...stroke}>
    <rect x="3" y="5" width="18" height="16" rx="2.5" />
    <path d="M3 10h18M8 3v4M16 3v4" />
  </svg>
);

const PersonIcon = (
  <svg viewBox="0 0 24 24" className="size-5 shrink-0" aria-hidden {...stroke}>
    <circle cx="12" cy="8" r="3.5" />
    <path d="M5 20c0-3.4 3.1-5.5 7-5.5s7 2.1 7 5.5" />
  </svg>
);

const PeopleIcon = (
  <svg viewBox="0 0 24 24" className="size-5 shrink-0" aria-hidden {...stroke}>
    <circle cx="9" cy="8" r="3.2" />
    <path d="M2.5 19.5c0-3.1 2.9-5 6.5-5s6.5 1.9 6.5 5" />
    <path d="M16.5 5.4a3.2 3.2 0 0 1 0 5.9M18 14.9c2.1.6 3.5 2.2 3.5 4.6" />
  </svg>
);

const ListIcon = (
  <svg viewBox="0 0 24 24" className="size-5 shrink-0" aria-hidden {...stroke}>
    <path d="M4 7h16M4 12h11M4 17h7" />
  </svg>
);

const ClockIcon = (
  <svg viewBox="0 0 24 24" className="size-5 shrink-0" aria-hidden {...stroke}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 1.8" />
  </svg>
);

const ChartIcon = (
  <svg viewBox="0 0 24 24" className="size-5 shrink-0" aria-hidden {...stroke}>
    <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
  </svg>
);

const GearIcon = (
  <svg viewBox="0 0 24 24" className="size-5 shrink-0" aria-hidden {...stroke}>
    <circle cx="12" cy="12" r="3.2" />
    <path d="M19.4 14a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1v.3a2 2 0 1 1-4 0v-.2a1.6 1.6 0 0 0-2.8-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3.5 15a2 2 0 1 1 0-4h.2a1.6 1.6 0 0 0 1.1-2.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 10 4.5a2 2 0 1 1 4 0v.2a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7h.3a2 2 0 1 1 0 4h-.2a1.6 1.6 0 0 0-1.3 1.1z" />
  </svg>
);

const LogoutIcon = (
  <svg viewBox="0 0 24 24" className="size-5 shrink-0" aria-hidden {...stroke}>
    <path d="M15 17v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v2" />
    <path d="M11 12h10m0 0-3-3m3 3-3 3" />
  </svg>
);

const NAV: NavItem[] = [
  { href: "/calendar", label: "Хуанли", icon: CalendarIcon },
  { href: "/clients", label: "Үйлчлүүлэгч", icon: PersonIcon },
  { href: "/staff", label: "Ажилтан", icon: PeopleIcon },
  { href: "/services", label: "Үйлчилгээ", icon: ListIcon },
];

export function AppRail({ user }: { user: CurrentUser }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  // Задарсан эсэх — дарж нээсэн, эсвэл хэрэглэгчийн цэс нээлттэй
  const expanded = open || menuOpen;

  const items =
    user.role === "ADMIN"
      ? [
          ...NAV,
          { href: "/timesheet", label: "Цагийн бүртгэл", icon: ClockIcon },
          { href: "/reports", label: "Тайлан", icon: ChartIcon },
          { href: "/settings", label: "Тохиргоо", icon: GearIcon },
        ]
      : NAV;

  const initial = user.name.trim().charAt(0).toUpperCase();

  return (
    <>
      {/* ══ Гар утас ══ Дээд мөр ба түүнээс доош задардаг цэс */}
      <div className="no-print fixed inset-x-0 top-0 z-40 md:hidden">
        <header className="flex h-14 items-center gap-2.5 border-b border-sand-200 bg-white px-3">
          <Image
            src="/logo.png"
            alt=""
            width={72}
            height={72}
            priority
            className="size-9 shrink-0 rounded-full bg-white"
          />
          <span className="min-w-0 truncate font-serif text-base text-sand-900">
            Organic Care
          </span>
          <span className="truncate text-xs text-sand-500">
            {ROLE_LABELS[user.role]}
          </span>

          <button
            type="button"
            onClick={() => setOpen((current) => !current)}
            aria-label={open ? "Цэс хаах" : "Цэс нээх"}
            aria-expanded={open}
            className="ml-auto flex size-10 shrink-0 items-center justify-center rounded-xl text-sand-700 transition active:scale-95 active:bg-sand-100"
          >
            <svg viewBox="0 0 24 24" className="size-6" aria-hidden {...stroke}>
              {open ? (
                <path d="M6 6l12 12M18 6 6 18" />
              ) : (
                <path d="M4 7h16M4 12h16M4 17h16" />
              )}
            </svg>
          </button>
        </header>

        {/*
          Задардаг самбар. `max-height`-ээр нээгддэг тул агуулгын өндөр
          хэдэн ч мөр байсан тааруулж болно; хаалттай үедээ огт зай эзлэхгүй.
        */}
        <div
          /* Хаалттай үед доторх холбоос Tab-аар онилогдохгүй */
          inert={!open}
          className={`overflow-hidden bg-white transition-[max-height,opacity] duration-200 ease-out ${
            open
              ? "max-h-[calc(100dvh-3.5rem)] border-b border-sand-200 opacity-100 shadow-xl"
              : "max-h-0 opacity-0"
          }`}
        >
          <nav
            aria-label="Үндсэн цэс"
            className="scrollbar-slim max-h-[calc(100dvh-3.5rem)] overflow-y-auto px-3 pb-3 pt-2"
          >
            <ul className="space-y-1">
              {items.map((item) => {
                const active =
                  pathname === item.href || pathname.startsWith(`${item.href}/`);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      onClick={() => setOpen(false)}
                      className={`flex h-12 items-center gap-3 rounded-2xl px-4 text-[15px] transition-colors ${
                        active
                          ? "bg-brand-600 font-medium text-white shadow-sm"
                          : "text-sand-700 active:bg-sand-100"
                      }`}
                    >
                      {item.icon}
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>

            {/* Хэн нэвтэрсэн ба гарах — жагсаалтын сүүлд */}
            <div className="mt-2 border-t border-sand-200 pt-2">
              <div className="flex h-12 items-center gap-3 px-2">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-sand-200 text-sm font-medium text-sand-700">
                  {initial}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm text-sand-900">
                    {user.name}
                  </span>
                  <span className="block truncate text-xs text-sand-500">
                    {user.phone}
                  </span>
                </span>
              </div>

              <form action={logout}>
                <button
                  type="submit"
                  className="flex h-12 w-full items-center gap-3 rounded-2xl px-4 text-left text-[15px] text-sand-600 transition-colors active:bg-sand-100"
                >
                  {LogoutIcon}
                  Гарах
                </button>
              </form>
            </div>
          </nav>
        </div>
      </div>

      {/* Самбар нээлттэй үед доорх агуулгыг бүдэгрүүлж, дарвал хаана */}
      {open ? (
        <button
          type="button"
          aria-label="Цэс хаах"
          onClick={() => setOpen(false)}
          className="no-print fixed inset-x-0 bottom-0 top-14 z-30 cursor-default bg-sand-900/30 md:hidden"
        />
      ) : null}

      {/* ══ Таблет ба нарийн цонх ══ Дээд талын хэвтээ цэс */}
      <header className="no-print fixed inset-x-0 top-0 z-40 hidden h-14 items-center gap-2 overflow-hidden bg-brand-700 px-3 md:max-rail:flex">
        <Link
          href="/calendar"
          className="flex shrink-0 items-center gap-2.5 rounded-xl pr-1 transition hover:opacity-90"
        >
          <Image
            src="/logo.png"
            alt="Organic Care"
            width={80}
            height={80}
            priority
            className="size-9 shrink-0 rounded-full bg-white object-cover"
          />
          {/* Нэр нь зөвхөн зай хүрэлцэхэд — нарийн таблетад цэс нь чухал */}
          <span className="hidden whitespace-nowrap font-serif text-lg text-brand-50 xl:inline">
            Organic Care
          </span>
        </Link>

        <nav
          aria-label="Үндсэн цэс"
          className="flex min-w-0 flex-1 items-center justify-center gap-0.5"
        >
          {items.map((item) => {
            const active =
              pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                title={item.label}
                aria-label={item.label}
                aria-current={active ? "page" : undefined}
                className={`flex h-10 shrink-0 items-center gap-2 rounded-xl px-2.5 text-sm transition-colors ${
                  active
                    ? "bg-white/12 text-white"
                    : "text-white/60 hover:bg-white/8 hover:text-white/90"
                }`}
              >
                {item.icon}
                {/*
                  Нарийн дэлгэцэд зөвхөн ИДЭВХТЭЙ хуудсын нэр гарна — хаана
                  байгаа нь тодорхой, гэхдээ бүх цэс нэг мөрөнд тухтай багтана.
                */}
                <span
                  className={`whitespace-nowrap ${active ? "" : "hidden xl:inline"}`}
                >
                  {item.label}
                </span>
              </Link>
            );
          })}
        </nav>

        <button
          type="button"
          onClick={() => setMenuOpen((current) => !current)}
          aria-label={`${user.name} — хэрэглэгчийн цэс`}
          aria-expanded={menuOpen}
          className="flex shrink-0 items-center gap-2 rounded-xl p-1 transition-colors hover:bg-white/8"
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-sand-300 text-sm font-medium text-sand-800">
            {initial}
          </span>
          <span className="hidden min-w-0 pr-1 text-left xl:block">
            <span className="block truncate whitespace-nowrap text-sm text-white">
              {user.name}
            </span>
            <span className="block whitespace-nowrap text-xs text-white/50">
              {ROLE_LABELS[user.role]}
            </span>
          </span>
        </button>
      </header>

      {/* Толгой мөрний хэрэглэгчийн цэс */}
      {menuOpen ? (
        <>
          <button
            type="button"
            aria-label="Цэс хаах"
            onClick={() => setMenuOpen(false)}
            className="no-print fixed inset-0 z-40 hidden cursor-default md:max-rail:block"
          />
          <div className="no-print fixed right-3 top-[52px] z-50 hidden w-56 rounded-xl border border-sand-200 bg-white p-1.5 shadow-xl md:max-rail:block">
            <div className="border-b border-sand-100 px-2.5 py-2">
              <p className="truncate text-sm font-medium text-sand-900">
                {user.name}
              </p>
              <p className="text-xs text-sand-500">
                {ROLE_LABELS[user.role]} · {user.phone}
              </p>
            </div>
            <form action={logout}>
              <button
                type="submit"
                className="mt-1 w-full rounded-lg px-2.5 py-2 text-left text-sm text-sand-700 transition hover:bg-sand-100"
              >
                Гарах
              </button>
            </form>
          </div>
        </>
      ) : null}

      {/* ══ Компьютер ══ Зүүн талын нарийн rail */}
      <nav
        aria-label="Үндсэн цэс"
        data-expanded={expanded ? "" : undefined}
        className={`no-print group relative z-30 hidden shrink-0 flex-col overflow-hidden bg-brand-700 py-4 transition-[width] duration-200 ease-out rail:flex ${
          expanded ? "w-[228px]" : "w-[68px]"
        }`}
      >
        {/* Лого дээр дарж цэсийг дэлгэж хураана */}
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          aria-label={expanded ? "Цэс хураах" : "Цэс дэлгэх"}
          aria-expanded={expanded}
          className="mb-4 flex h-10 shrink-0 items-center gap-3 pl-[14px] text-left"
        >
          {/* Лого нь дугуй, буланд нь дэвсгэргүй — ногоон дээр цагаан тэмдэг болж суудаг */}
          <Image
            src="/logo.png"
            alt="Organic Care"
            width={80}
            height={80}
            priority
            className="size-10 shrink-0 rounded-full bg-white object-cover transition hover:brightness-95"
          />
          <span className="whitespace-nowrap font-serif text-lg text-brand-50 opacity-0 transition-opacity duration-150 group-data-[expanded]:opacity-100">
            Organic Care
          </span>
        </button>

        <div className="scrollbar-slim flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto overflow-x-hidden">
          {items.map((item) => {
            const active =
              pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-label={item.label}
                aria-current={active ? "page" : undefined}
                className={`mx-2 flex h-11 shrink-0 items-center gap-3.5 rounded-xl pl-4 transition-colors ${
                  active
                    ? "bg-white/12 text-white"
                    : "text-white/55 hover:bg-white/8 hover:text-white/90"
                }`}
              >
                {item.icon}
                <span className="whitespace-nowrap text-sm opacity-0 transition-opacity duration-150 group-data-[expanded]:opacity-100">
                  {item.label}
                </span>
              </Link>
            );
          })}
        </div>

        {/* Хэрэглэгч — дарвал гарах цэс нээгдэнэ */}
        <button
          type="button"
          onClick={() => setMenuOpen((current) => !current)}
          aria-label={`${user.name} — хэрэглэгчийн цэс`}
          aria-expanded={menuOpen}
          className="mx-2 mt-2 flex h-12 shrink-0 items-center gap-3 rounded-xl pl-[6px] transition-colors hover:bg-white/8"
        >
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-sand-300 text-sm font-medium text-sand-800">
            {initial}
          </span>
          <span className="min-w-0 text-left opacity-0 transition-opacity duration-150 group-data-[expanded]:opacity-100">
            <span className="block truncate whitespace-nowrap text-sm text-white">
              {user.name}
            </span>
            <span className="block whitespace-nowrap text-xs text-white/50">
              {ROLE_LABELS[user.role]}
            </span>
          </span>
        </button>
      </nav>

      {/* Хэрэглэгчийн цэс — rail-ийн overflow-д таслагдахгүйн тулд гадна нь */}
      {menuOpen ? (
        <>
          <button
            type="button"
            aria-label="Цэс хаах"
            onClick={() => setMenuOpen(false)}
            className="no-print fixed inset-0 z-40 hidden cursor-default rail:block"
          />
          <div className="no-print fixed bottom-4 left-[236px] z-50 hidden w-56 rounded-xl border border-sand-200 bg-white p-1.5 shadow-xl rail:block">
            <div className="border-b border-sand-100 px-2.5 py-2">
              <p className="truncate text-sm font-medium text-sand-900">
                {user.name}
              </p>
              <p className="text-xs text-sand-500">
                {ROLE_LABELS[user.role]} · {user.phone}
              </p>
            </div>
            <form action={logout}>
              <button
                type="submit"
                className="mt-1 w-full rounded-lg px-2.5 py-2 text-left text-sm text-sand-700 transition hover:bg-sand-100"
              >
                Гарах
              </button>
            </form>
          </div>
        </>
      ) : null}
    </>
  );
}
