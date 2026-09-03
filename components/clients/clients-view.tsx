"use client";

import {
  useActionState,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from "react";
import {
  createClient,
  deleteClient,
  updateClient,
} from "@/app/(app)/clients/actions";
import { formatDateLong, formatPrice } from "@/lib/labels";
import { todayKey } from "@/lib/time";
import type { ActionResult } from "@/lib/action-result";
import { PageHeader } from "@/components/page-header";
import { Modal } from "@/components/ui/modal";
import {
  Field,
  GhostButton,
  Issues,
  PrimaryButton,
  inputClass,
} from "@/components/ui/form";

export type ClientRow = {
  id: string;
  name: string;
  phone: string;
  note: string | null;
  /** Бүртгүүлсэн өдөр */
  registeredAt: string;
  /** Цуцлагдаагүй нийт ирэлт — хамтарсан захиалга нэгээр тоологдоно */
  visits: number;
  /** Нийт зарцуулсан дүн */
  spent: number;
  /** Сүүлд ирсэн өдөр — хараахан ирээгүй бол null */
  lastVisit: string | null;
  /** Сүүлийн ирэлтийн үйлчилгээнүүд */
  services: { name: string; color: string }[];
};

/** Хэдэн удаа ирснээр «байнгын» гэж үзэх босго. */
const REGULAR_FROM = 5;

/**
 * Аватарын өнгө — нэрнээс тогтмол сонгогдоно.
 * Ижил хүн үргэлж ижил өнгөтэй байх нь жагсаалтыг нүдээр тогтооход тусална.
 */
const AVATAR_COLORS = [
  "#c0798c",
  "#c09b5c",
  "#4f7355",
  "#6b8f70",
  "#8b7ba8",
  "#7fa2c0",
  "#6ba39b",
  "#c08a5e",
];

function avatarColor(seed: string): string {
  let sum = 0;
  for (const char of seed) sum += char.codePointAt(0) ?? 0;
  return AVATAR_COLORS[sum % AVATAR_COLORS.length];
}

/** Нэрний эхний үсэг — хоосон нэрэнд «?» */
function initial(name: string): string {
  return name.trim().slice(0, 1).toLocaleUpperCase("mn-MN") || "?";
}

/** 99104657 → 9910 4657 */
function formatPhone(phone: string): string {
  return phone.length === 8 ? `${phone.slice(0, 4)} ${phone.slice(4)}` : phone;
}

/** Хоёр өдрийн хоорондох хоногийн зөрүү. */
function dayDiff(from: string, to: string): number {
  const [y1, m1, d1] = from.split("-").map(Number);
  const [y2, m2, d2] = to.split("-").map(Number);
  return Math.round(
    (Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000,
  );
}

/** «6 хоногийн өмнө» — тодорхой огноо нь зөвхөн хол үед хэрэгтэй. */
function sinceLabel(days: number, dateKey: string): string {
  if (days <= 0) return "өнөөдөр";
  if (days === 1) return "өчигдөр";
  if (days < 7) return `${days} хоногийн өмнө`;
  if (days < 30) return `${Math.floor(days / 7)} долоо хоногийн өмнө`;
  return formatDateLong(dateKey);
}

type Editing = { kind: "new" } | { kind: "edit"; client: ClientRow } | null;

export function ClientsView({
  clients,
  isAdmin,
}: {
  clients: ClientRow[];
  /** Захиалгын түүхтэй хүнийг зөвхөн админ устгана */
  isAdmin: boolean;
}) {
  const [editing, setEditing] = useState<Editing>(null);

  /**
   * Устгах — асуулт асуухгүй, шууд. Андуурч бүртгэсэн мөрийг хурдан цэвэрлэх
   * нь ресепшний өдөр тутмын ажил. Сервер татгалзвал (жишээ нь захиалгын
   * түүхтэй хүнийг ресепшн устгах гэвэл) шалтгааныг нь дээр гаргана.
   */
  const [error, setError] = useState<string[] | null>(null);
  const [isRemoving, startRemove] = useTransition();

  function remove(client: ClientRow) {
    setError(null);
    startRemove(async () => {
      const outcome = await deleteClient(client.id);
      if (!outcome.ok) setError(outcome.issues);
    });
  }

  const today = todayKey();

  /**
   * Мөр бүрт «хэдэн хоногийн өмнө» гэдгийг бодож, саяхан ирснийг нь дээр
   * тавина. Хараахан ирээгүй хүмүүс жагсаалтын сүүлд, шинэ бүртгэл нь дээрээ.
   */
  const rows = useMemo(() => {
    const enriched = clients.map((client) => ({
      client,
      since: client.lastVisit ? dayDiff(client.lastVisit, today) : null,
    }));

    return enriched.sort((a, b) => {
      if (a.since === null && b.since === null) {
        return b.client.registeredAt.localeCompare(a.client.registeredAt);
      }
      if (a.since === null) return 1;
      if (b.since === null) return -1;
      return a.since - b.since;
    });
  }, [clients, today]);

  return (
    <>
      <PageHeader
        title="Үйлчлүүлэгч"
        subtitle={`Нийт ${clients.length} бүртгэлтэй`}
        action={
          <PrimaryButton onClick={() => setEditing({ kind: "new" })}>
            + Үйлчлүүлэгч бүртгэх
          </PrimaryButton>
        }
      />

      <div className="min-h-0 flex-1 overflow-auto scrollbar-slim p-4 md:p-6">
        {error ? (
          <div className="mb-4">
            <Issues issues={error} />
          </div>
        ) : null}

        {clients.length === 0 ? (
          <Empty onAdd={() => setEditing({ kind: "new" })} />
        ) : (
          <ul className="divide-y divide-sand-100 overflow-hidden rounded-2xl border border-sand-200 bg-white">
            {rows.map(({ client, since }) => (
              <li key={client.id} className="flex items-stretch">
                <ClientLine
                  client={client}
                  since={since}
                  onEdit={() => setEditing({ kind: "edit", client })}
                />
                {/* Устгах — мөрийн ХАМГИЙН АРД, ил. Дарвал шууд устана. */}
                {isAdmin || client.visits === 0 ? (
                  <button
                    type="button"
                    disabled={isRemoving}
                    onClick={() => remove(client)}
                    title={`${client.name}-г устгах`}
                    aria-label={`${client.name}-г устгах`}
                    className="flex shrink-0 items-center px-3 text-sand-300 transition hover:bg-danger-50 hover:text-danger-600 disabled:opacity-40 sm:px-4"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      className="size-4"
                      aria-hidden
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={1.8}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M10 11v6M14 11v6" />
                    </svg>
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      {editing ? (
        <ClientForm
          client={editing.kind === "edit" ? editing.client : null}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </>
  );
}

/** Жагсаалтын нэг мөр — дарвал засах цонх нээгдэнэ. */
function ClientLine({
  client,
  since,
  onEdit,
}: {
  client: ClientRow;
  since: number | null;
  onEdit: () => void;
}) {
  const color = avatarColor(client.name);
  const regular = client.visits >= REGULAR_FROM;

  return (
    <button
      type="button"
      onClick={onEdit}
      className="group flex min-w-0 flex-1 items-start gap-3 py-3 pl-3 pr-1 text-left transition hover:bg-sand-50 sm:gap-4 sm:pl-4"
    >
      {/* Аватар — өнгө нь мөр даяар давтагдана */}
      <span
        aria-hidden
        className="flex size-11 shrink-0 items-center justify-center rounded-2xl text-base font-semibold text-white shadow-sm"
        style={{ backgroundColor: color }}
      >
        {initial(client.name)}
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="truncate font-serif text-[15px] text-sand-900">
            {client.name}
          </span>
          {regular ? (
            <span className="shrink-0 rounded-full bg-warn-50 px-2 py-0.5 text-[11px] font-medium text-warn-700">
              Байнгын
            </span>
          ) : null}
          {client.visits === 0 ? (
            <span className="shrink-0 rounded-full bg-sand-100 px-2 py-0.5 text-[11px] text-sand-500">
              Шинэ бүртгэл
            </span>
          ) : null}
        </span>

        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-sm text-sand-600">
          <span className="tabular-nums">{formatPhone(client.phone)}</span>
          {client.lastVisit && since !== null ? (
            <>
              <span aria-hidden className="text-sand-300">
                ·
              </span>
              <span className="text-sand-500">
                {sinceLabel(since, client.lastVisit)}
              </span>
            </>
          ) : null}
        </span>

        {/* Сүүлд авсан үйлчилгээ — үйлчилгээнийхээ өнгөөр */}
        {client.services.length > 0 ? (
          <span className="mt-1.5 flex flex-wrap gap-1">
            {client.services.map((service, index) => (
              <span
                key={`${service.name}-${index}`}
                className="inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-[11px]"
                style={{
                  backgroundColor: `color-mix(in srgb, ${service.color} 12%, white)`,
                  color: `color-mix(in srgb, ${service.color} 75%, #22201d)`,
                }}
              >
                <span
                  aria-hidden
                  className="size-1.5 rounded-full"
                  style={{ backgroundColor: service.color }}
                />
                {service.name}
              </span>
            ))}
          </span>
        ) : null}

        {client.note ? (
          <span className="mt-1.5 block truncate text-xs text-warn-600">
            ⚠ {client.note}
          </span>
        ) : null}
      </span>

      {/* Баруун тал — тоон дүгнэлт */}
      <span className="shrink-0 text-right">
        <span className="block text-sm font-medium tabular-nums text-sand-900">
          {client.visits > 0 ? `${client.visits} удаа` : "—"}
        </span>
        {client.spent > 0 ? (
          <span className="mt-0.5 block text-xs tabular-nums text-sand-500">
            {formatPrice(client.spent)}
          </span>
        ) : null}
      </span>
    </button>
  );
}

function Empty({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="rounded-2xl border border-dashed border-sand-300 bg-white/60 px-6 py-14 text-center">
      <p className="font-serif text-lg text-sand-800">Бүртгэл алга</p>
      <p className="mx-auto mt-1 max-w-sm text-sm text-sand-500">
        Цаг захиалахад үйлчлүүлэгч өөрөө бүртгэгддэг. Урьдчилж бүртгэх бол
        доорх товчийг дарна.
      </p>
      <div className="mt-4 flex justify-center">
        <PrimaryButton onClick={onAdd}>+ Үйлчлүүлэгч бүртгэх</PrimaryButton>
      </div>
    </div>
  );
}

/** Шинээр бүртгэх ба засах нэг цонх — талбарууд ижил. */
function ClientForm({
  client,
  onClose,
}: {
  client: ClientRow | null;
  onClose: () => void;
}) {
  const [result, formAction, isPending] = useActionState<
    ActionResult | null,
    FormData
  >(client ? updateClient : createClient, null);

  useEffect(() => {
    if (result?.ok) onClose();
  }, [result, onClose]);

  return (
    <Modal
      title={client ? "Үйлчлүүлэгч засах" : "Үйлчлүүлэгч бүртгэх"}
      onClose={onClose}
      footer={
        <>
          <GhostButton type="button" onClick={onClose}>
            Болих
          </GhostButton>
          <PrimaryButton type="submit" form="client-form" disabled={isPending}>
            {isPending ? "Хадгалж байна…" : client ? "Хадгалах" : "Бүртгэх"}
          </PrimaryButton>
        </>
      }
    >
      {/* Түүхийг нь цонхны толгойд сануулна — хэнийг засаж байгаа нь тодорхой */}
      {client && client.visits > 0 ? (
        <p className="mb-3 rounded-xl bg-sand-100/70 px-3 py-2 text-sm text-sand-600">
          {client.visits} удаа ирсэн · нийт{" "}
          <strong className="tabular-nums text-sand-900">
            {formatPrice(client.spent)}
          </strong>
          {client.lastVisit ? ` · сүүлд ${formatDateLong(client.lastVisit)}` : ""}
        </p>
      ) : null}

      <form id="client-form" action={formAction} className="space-y-3">
        {client ? <input type="hidden" name="id" value={client.id} /> : null}

        <Field label="Нэр">
          <input
            name="name"
            defaultValue={client?.name ?? ""}
            placeholder="Жишээ: Ариун"
            required
            autoFocus
            className={inputClass}
          />
        </Field>

        <Field label="Утас">
          <input
            name="phone"
            type="tel"
            inputMode="numeric"
            defaultValue={client?.phone ?? ""}
            placeholder="99XXXXXX"
            required
            className={inputClass}
          />
        </Field>

        <Field
          label="Тэмдэглэл"
          hint="Харшил, дуртай өнгө гэх мэт — захиалгын цонхонд сануулга болж гарна."
        >
          <textarea
            name="note"
            rows={2}
            defaultValue={client?.note ?? ""}
            placeholder="Заавал биш"
            className={`${inputClass} resize-none`}
          />
        </Field>

        {result && !result.ok ? <Issues issues={result.issues} /> : null}
      </form>
    </Modal>
  );
}
