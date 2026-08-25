"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { logout } from "@/app/login/actions";
import { ROLE_LABELS } from "@/lib/labels";
import type { CurrentUser } from "@/lib/session";
import type { Role } from "@/lib/generated/prisma/enums";

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

const PackageIcon = (
  <svg viewBox="0 0 24 24" className="size-5 shrink-0" aria-hidden {...stroke}>
    <path d="M12 3 4 7v10l8 4 8-4V7z" />
    <path d="M4 7l8 4 8-4M12 11v10" />
  </svg>
);

const GearIcon = (
  <svg viewBox="0 0 24 24" className="size-5 shrink-0" aria-hidden {...stroke}>
    <circle cx="12" cy="12" r="3.2" />
    <path d="M19.4 14a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1v.3a2 2 0 1 1-4 0v-.2a1.6 1.6 0 0 0-2.8-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3.5 15a2 2 0 1 1 0-4h.2a1.6 1.6 0 0 0 1.1-2.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 10 4.5a2 2 0 1 1 4 0v.2a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7h.3a2 2 0 1 1 0 4h-.2a1.6 1.6 0 0 0-1.3 1.1z" />
  </svg>
);

const NAV: NavItem[] = [
  { href: "/calendar", label: "Хуанли", icon: CalendarIcon },
  { href: "/clients", label: "Үйлчлүүлэгч", icon: PersonIcon },
  { href: "/staff", label: "Ажилтан", icon: PeopleIcon },
  { href: "/services", label: "Үйлчилгээ", icon: ListIcon },
  { href: "/packages", label: "Багц", icon: PackageIcon },
];

export function AppRail({
  user,
  effectiveRole,
}: {
  user: CurrentUser;
  effectiveRole: Role;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  // Задарсан эсэх — дарж нээсэн, эсвэл хэрэглэгчийн цэс нээлттэй
  const expanded = open || menuOpen;

  const items =
    effectiveRole === "ADMIN"
      ? [...NAV, { href: "/settings", label: "Тохиргоо", icon: GearIcon }]
      : NAV;

  const initial = user.name.trim().charAt(0).toUpperCase();

  return (
    <>
      {/* Гар утсанд цэс нээх товч — rail нь тэнд далд байдаг */}
      {!expanded ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Цэс нээх"
          className="no-print fixed left-3 top-3 z-30 flex size-10 items-center justify-center rounded-full bg-brand-700 text-white shadow-lg md:hidden"
        >
          <svg viewBox="0 0 24 24" className="size-5" aria-hidden {...stroke}>
            <path d="M4 7h16M4 12h16M4 17h16" />
          </svg>
        </button>
      ) : null}

      {/* Гар утсанд цэс нээлттэй үед арын бүрхүүл */}
      {expanded ? (
        <button
          type="button"
          aria-label="Цэс хаах"
          onClick={() => {
            setOpen(false);
            setMenuOpen(false);
          }}
          className="no-print fixed inset-0 z-40 cursor-default bg-sand-900/40 md:hidden"
        />
      ) : null}

      {/*
        Компьютерт: урсгал дотор өргөсөж агуулгыг баруун тийш шахна.
        Гар утсанд: агуулгын дээгүүр гарч ирэх drawer (зай хэмнэнэ).
      */}
      <nav
        aria-label="Үндсэн цэс"
        data-expanded={expanded ? "" : undefined}
        className={`no-print group fixed inset-y-0 left-0 z-50 flex w-[228px] flex-col overflow-hidden bg-brand-700 py-4 transition-transform duration-200 ease-out md:relative md:z-30 md:shrink-0 md:translate-x-0 md:transition-[width] ${
          expanded ? "translate-x-0" : "-translate-x-full"
        } ${expanded ? "md:w-[228px]" : "md:w-[68px]"}`}
      >
        {/* Лого дээр дарж цэсийг нээж хаана */}
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          aria-label={expanded ? "Цэс хураах" : "Цэс дэлгэх"}
          aria-expanded={expanded}
          className="mb-4 flex h-10 shrink-0 items-center gap-3 pl-[14px] text-left"
        >
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-50 font-serif text-sm text-brand-800 transition hover:brightness-95">
            OC
          </span>
          <span className="whitespace-nowrap font-serif text-lg text-brand-50 opacity-0 transition-opacity duration-150 group-data-[expanded]:opacity-100">
            Organic Care
          </span>
        </button>

        <div className="flex flex-1 flex-col gap-0.5">
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

        {/* Хэрэглэгч */}
        <button
          type="button"
          onClick={() => setMenuOpen((open) => !open)}
          aria-label={`${user.name} — хэрэглэгчийн цэс`}
          aria-expanded={menuOpen}
          className="mx-2 flex h-12 shrink-0 items-center gap-3 rounded-xl pl-[6px] transition-colors hover:bg-white/8"
        >
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-sand-300 text-sm font-medium text-sand-800">
            {initial}
          </span>
          <span className="min-w-0 text-left opacity-0 transition-opacity duration-150 group-data-[expanded]:opacity-100">
            <span className="block whitespace-nowrap text-sm text-white">
              {user.name}
            </span>
            <span className="block whitespace-nowrap text-xs text-white/50">
              {ROLE_LABELS[effectiveRole]}
            </span>
          </span>
        </button>
      </nav>

      {/* Хэрэглэгчийн цэс — nav-ын overflow-д таслагдахгүйн тулд гадна нь */}
      {menuOpen ? (
        <>
          <button
            type="button"
            aria-label="Цэс хаах"
            onClick={() => setMenuOpen(false)}
            className="no-print fixed inset-0 z-40 cursor-default"
          />
          <div className="no-print fixed bottom-4 left-[236px] z-50 w-56 rounded-xl border border-sand-200 bg-white p-1.5 shadow-xl">
            <div className="border-b border-sand-100 px-2.5 py-2">
              <p className="truncate text-sm font-medium text-sand-900">
                {user.name}
              </p>
              <p className="text-xs text-sand-500">
                {ROLE_LABELS[effectiveRole]} · {user.phone}
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
