"use client";

import {
  useActionState,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from "react";
import type {
  DayAppointment,
  DayStaff,
  PackageList,
  ServiceCatalog,
} from "@/lib/queries";
import { STATUS_LABELS, formatDuration, formatPrice } from "@/lib/labels";
import { effectivePrice, isSaleActive } from "@/lib/pricing";
import { formatMinutes, toLocalMinutes } from "@/lib/time";
import {
  createAppointment,
  deleteAppointment,
  findClients,
  setAppointmentStatus,
  updateAppointment,
} from "@/app/(app)/calendar/actions";
import type { ActionResult } from "@/lib/action-result";
import type { AppointmentStatus } from "@/lib/generated/prisma/enums";
import { Field, Issues, inputClass } from "@/components/ui/form";

export type DialogState =
  | {
      mode: "create";
      branchId: string;
      dateKey: string;
      staffId: string;
      startMin: number;
    }
  | {
      mode: "edit";
      branchId: string;
      dateKey: string;
      appointment: DayAppointment;
    };

type ClientOption = {
  id: string;
  name: string;
  phone: string;
  note: string | null;
};

type Props = {
  state: DialogState;
  staff: DayStaff[];
  catalog: ServiceCatalog;
  packages: PackageList;
  onClose: () => void;
};

const STATUS_FLOW: AppointmentStatus[] = [
  "BOOKED",
  "CONFIRMED",
  "ARRIVED",
  "COMPLETED",
  "NO_SHOW",
  "CANCELLED",
];

export function AppointmentDialog({
  state,
  staff,
  catalog,
  packages,
  onClose,
}: Props) {
  const editing = state.mode === "edit" ? state.appointment : null;

  const allServices = useMemo(
    () => catalog.flatMap((category) => category.services),
    [catalog],
  );

  const [selectedClient, setSelectedClient] = useState<ClientOption | null>(
    editing?.client ?? null,
  );
  const [creatingClient, setCreatingClient] = useState(false);

  const [packageId, setPackageId] = useState<string | null>(
    editing?.packageId ?? null,
  );

  const activePackage = packages.find((p) => p.id === packageId) ?? null;
  const packageServiceIds = useMemo(
    () => activePackage?.items.map((item) => item.serviceId) ?? [],
    [activePackage],
  );

  /**
   * Багцаас гадуур нэмж сонгосон үйлчилгээнүүд.
   * Засварлах үед үйлчилгээг НЭРЭЭР нь тааруулна — AppointmentService.id нь
   * Service.id-тэй ижил биш. Цонх нь `key`-ээр дахин үүсдэг тул анхны утгыг
   * энд шууд тооцоход хангалттай.
   */
  const [extraIds, setExtraIds] = useState<string[]>(() => {
    if (!editing) return [];
    const booked = editing.items
      .map((item) => allServices.find((s) => s.name === item.name)?.id)
      .filter((id): id is string => Boolean(id));
    const inPackage =
      packages
        .find((p) => p.id === editing.packageId)
        ?.items.map((item) => item.serviceId) ?? [];
    return booked.filter((id) => !inPackage.includes(id));
  });

  // Сервер рүү явах эцсийн жагсаалт — багцынх урд, нэмэлт нь ард
  const serviceIds = useMemo(
    () => [
      ...packageServiceIds,
      ...extraIds.filter((id) => !packageServiceIds.includes(id)),
    ],
    [packageServiceIds, extraIds],
  );

  const selectedServices = serviceIds
    .map((id) => allServices.find((s) => s.id === id))
    .filter((s): s is (typeof allServices)[number] => Boolean(s));

  const totalDuration = selectedServices.reduce(
    (sum, s) => sum + s.durationMin,
    0,
  );
  const subtotal = selectedServices.reduce(
    (sum, s) => sum + effectivePrice(s),
    0,
  );

  // Багцын хөнгөлөлт — зөвхөн багцад орсон үйлчилгээнүүдээс
  const packageSubtotal = selectedServices
    .filter((s) => packageServiceIds.includes(s.id))
    .reduce((sum, s) => sum + effectivePrice(s), 0);
  const packageDiscount = activePackage
    ? Math.max(0, packageSubtotal - activePackage.price)
    : 0;

  // Хадгалсан хөнгөлөлтөөс багцынхыг хассан үлдэгдэл нь гараар өгсөн хөнгөлөлт
  const [manualDiscount, setManualDiscount] = useState<string>(() => {
    if (!editing || editing.discount <= 0) return "";
    const fromPackage = editing.packageId
      ? (packages
          .find((p) => p.id === editing.packageId)
          ?.items.reduce(
            (sum, item) => sum + effectivePrice(item.service),
            0,
          ) ?? 0) -
        (packages.find((p) => p.id === editing.packageId)?.price ?? 0)
      : 0;
    const manual = editing.discount - Math.max(0, fromPackage);
    return manual > 0 ? String(manual) : "";
  });
  const manual = Number(manualDiscount.replace(/\D/g, "")) || 0;

  const discount = Math.min(subtotal, packageDiscount + manual);
  const totalPrice = subtotal - discount;

  const action = state.mode === "create" ? createAppointment : updateAppointment;
  const [result, formAction, isPending] = useActionState<
    ActionResult | null,
    FormData
  >(action, null);

  useEffect(() => {
    if (result?.ok) onClose();
  }, [result, onClose]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const defaultStartMin =
    state.mode === "edit"
      ? toLocalMinutes(state.appointment.startAt)
      : state.startMin;
  const defaultStaffId =
    state.mode === "edit" ? state.appointment.staffId : state.staffId;

  function toggleService(id: string) {
    // Багцын бүрэлдэхүүнийг тусад нь салгахгүй — багцаа болиулж салгана
    if (packageServiceIds.includes(id)) return;
    setExtraIds((current) =>
      current.includes(id)
        ? current.filter((serviceId) => serviceId !== id)
        : [...current, id],
    );
  }

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
        aria-label={
          state.mode === "create" ? "Шинэ цаг захиалга" : "Цаг захиалга засах"
        }
        className="relative flex max-h-[92vh] w-full max-w-2xl flex-col rounded-t-2xl bg-white shadow-xl sm:rounded-2xl"
      >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-sand-200 px-5 py-4">
          <div>
            <h2 className="font-serif text-lg text-sand-900">
              {state.mode === "create"
                ? "Шинэ цаг захиалга"
                : "Цаг захиалга засах"}
            </h2>
            {editing ? (
              <span
                className="mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-medium"
                style={{
                  backgroundColor: STATUS_LABELS[editing.status].bg,
                  color: STATUS_LABELS[editing.status].color,
                }}
              >
                {STATUS_LABELS[editing.status].label}
              </span>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Хаах"
            className="rounded-lg p-1.5 text-sand-500 transition hover:bg-sand-100 hover:text-sand-800"
          >
            ✕
          </button>
        </header>

        <form
          action={formAction}
          className="flex min-h-0 flex-1 flex-col overflow-y-auto scrollbar-slim"
        >
          <input type="hidden" name="branchId" value={state.branchId} />
          {editing ? (
            <input type="hidden" name="appointmentId" value={editing.id} />
          ) : null}
          {packageId ? (
            <input type="hidden" name="packageId" value={packageId} />
          ) : null}
          {serviceIds.map((id) => (
            <input key={id} type="hidden" name="serviceIds" value={id} />
          ))}
          <input type="hidden" name="discount" value={String(manual)} />
          {selectedClient && !creatingClient ? (
            <input type="hidden" name="clientId" value={selectedClient.id} />
          ) : null}

          <div className="space-y-5 px-5 py-4">
            {/* Үйлчлүүлэгч */}
            <section>
              <SectionTitle>Үйлчлүүлэгч</SectionTitle>
              <ClientPicker
                selected={selectedClient}
                creating={creatingClient}
                onSelect={(client) => {
                  setSelectedClient(client);
                  setCreatingClient(false);
                }}
                onStartCreate={() => {
                  setSelectedClient(null);
                  setCreatingClient(true);
                }}
                onClear={() => {
                  setSelectedClient(null);
                  setCreatingClient(false);
                }}
              />
            </section>

            {/* Багц */}
            {packages.length > 0 ? (
              <section>
                <SectionTitle>Багц</SectionTitle>
                <div className="flex flex-wrap gap-1.5">
                  {packages.map((pkg) => {
                    const active = pkg.id === packageId;
                    const color = pkg.color ?? "#a39887";
                    return (
                      <button
                        key={pkg.id}
                        type="button"
                        aria-pressed={active}
                        onClick={() => setPackageId(active ? null : pkg.id)}
                        className={`rounded-lg border px-3 py-2 text-left text-xs transition hover:bg-sand-50 ${
                          active ? "" : "border-sand-300 text-sand-700"
                        }`}
                        style={
                          active
                            ? {
                                borderColor: color,
                                backgroundColor: `color-mix(in srgb, ${color} 10%, white)`,
                              }
                            : undefined
                        }
                      >
                        <span
                          className="block font-medium"
                          style={{ color: active ? color : undefined }}
                        >
                          {pkg.name}
                        </span>
                        <span className="block text-[11px] text-sand-500">
                          {pkg.items.length} үйлчилгээ · {formatPrice(pkg.price)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>
            ) : null}

            {/* Үйлчилгээ */}
            <section>
              <SectionTitle>
                Үйлчилгээ
                {selectedServices.length > 0 ? (
                  <span className="ml-2 font-normal text-sand-500">
                    {formatDuration(totalDuration)}
                  </span>
                ) : null}
              </SectionTitle>

              <div className="space-y-3">
                {catalog.map((category) => (
                  <div key={category.id}>
                    <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-sand-500">
                      <span
                        aria-hidden
                        className="size-2 rounded-full"
                        style={{ backgroundColor: category.color }}
                      />
                      {category.name}
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {category.services.map((service) => {
                        const inPackage = packageServiceIds.includes(service.id);
                        const active = serviceIds.includes(service.id);
                        const color = service.color ?? category.color;
                        const sale = isSaleActive(service);
                        return (
                          <button
                            key={service.id}
                            type="button"
                            onClick={() => toggleService(service.id)}
                            aria-pressed={active}
                            title={
                              inPackage
                                ? "Багцад орсон — салгах бол багцаа болиулна уу"
                                : undefined
                            }
                            className={`rounded-lg border px-3 py-2 text-left text-xs transition ${
                              inPackage ? "cursor-default" : "hover:bg-sand-50"
                            } ${active ? "" : "border-sand-300 text-sand-700"}`}
                            style={
                              active
                                ? {
                                    borderColor: color,
                                    backgroundColor: `color-mix(in srgb, ${color} 10%, white)`,
                                  }
                                : undefined
                            }
                          >
                            <span
                              className="block font-medium"
                              style={{ color: active ? color : undefined }}
                            >
                              {service.name}
                              {inPackage ? (
                                <span className="ml-1 text-sand-400">· багц</span>
                              ) : null}
                            </span>
                            <span className="block text-[11px] text-sand-500">
                              {formatDuration(service.durationMin)} ·{" "}
                              {sale ? (
                                <>
                                  <span className="line-through">
                                    {formatPrice(service.price)}
                                  </span>{" "}
                                  <span className="font-medium text-[#986438]">
                                    {formatPrice(service.salePrice as number)}
                                  </span>
                                </>
                              ) : (
                                formatPrice(service.price)
                              )}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* Ажилтан, огноо, цаг */}
            <section className="grid gap-3 sm:grid-cols-3">
              <Field label="Ажилтан">
                <select
                  name="staffId"
                  defaultValue={defaultStaffId}
                  className={inputClass}
                >
                  {staff.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.name}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Огноо">
                <input
                  type="date"
                  name="dateKey"
                  defaultValue={state.dateKey}
                  className={inputClass}
                />
              </Field>

              <Field label="Эхлэх цаг">
                <input
                  type="time"
                  name="startTime"
                  step={900}
                  defaultValue={formatMinutes(defaultStartMin)}
                  className={inputClass}
                />
              </Field>
            </section>

            {totalDuration > 0 ? (
              <p className="rounded-lg bg-sand-100/70 px-3 py-2 text-sm text-sand-600">
                Дуусах цаг:{" "}
                <strong className="tabular-nums text-sand-900">
                  {formatMinutes(defaultStartMin + totalDuration)}
                </strong>{" "}
                (нийт {formatDuration(totalDuration)})
              </p>
            ) : null}

            {/* Хөнгөлөлт ба тооцоо */}
            {selectedServices.length > 0 ? (
              <section className="rounded-xl border border-sand-200 p-3">
                <div className="sm:max-w-xs">
                  <Field label="Нэмэлт хөнгөлөлт (₮)" hint="Тохиролцсон хямдрал">
                    <input
                      type="number"
                      min={0}
                      step={1000}
                      value={manualDiscount}
                      onChange={(event) => setManualDiscount(event.target.value)}
                      placeholder="0"
                      className={inputClass}
                    />
                  </Field>
                </div>

                <dl className="mt-3 space-y-1 border-t border-sand-100 pt-3 text-sm">
                  <Row label="Дүн" value={formatPrice(subtotal)} />
                  {packageDiscount > 0 && activePackage ? (
                    <Row
                      label={`Багц: ${activePackage.name}`}
                      value={`− ${formatPrice(packageDiscount)}`}
                      accent
                    />
                  ) : null}
                  {manual > 0 ? (
                    <Row
                      label="Нэмэлт хөнгөлөлт"
                      value={`− ${formatPrice(manual)}`}
                      accent
                    />
                  ) : null}
                  <div className="flex justify-between border-t border-sand-100 pt-1 font-semibold text-sand-900">
                    <dt>Төлөх дүн</dt>
                    <dd className="tabular-nums">{formatPrice(totalPrice)}</dd>
                  </div>
                </dl>
              </section>
            ) : null}

            {/* Тэмдэглэл */}
            <Field label="Тэмдэглэл">
              <textarea
                name="note"
                rows={2}
                defaultValue={editing?.note ?? ""}
                placeholder="Жишээ: улаан гель хүсэж байна"
                className={`${inputClass} resize-none`}
              />
            </Field>

            {result && !result.ok ? <Issues issues={result.issues} /> : null}

            {editing ? (
              <StatusControls appointment={editing} onDone={onClose} />
            ) : null}
          </div>

          <footer className="sticky bottom-0 flex shrink-0 items-center justify-between gap-3 border-t border-sand-200 bg-white px-5 py-3">
            <div className="text-sm">
              {selectedServices.length > 0 ? (
                <span className="flex items-baseline gap-2">
                  {discount > 0 ? (
                    <span className="text-sand-400 line-through">
                      {formatPrice(subtotal)}
                    </span>
                  ) : null}
                  <span className="font-semibold text-sand-900">
                    {formatPrice(totalPrice)}
                  </span>
                </span>
              ) : (
                <span className="text-sand-500">Үйлчилгээ сонгоно уу</span>
              )}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-xl border border-sand-300 px-4 py-2 text-sm text-sand-700 transition hover:bg-sand-100"
              >
                Болих
              </button>
              <button
                type="submit"
                disabled={isPending || serviceIds.length === 0}
                className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-700 disabled:opacity-50"
              >
                {isPending
                  ? "Хадгалж байна…"
                  : state.mode === "create"
                    ? "Захиалах"
                    : "Хадгалах"}
              </button>
            </div>
          </footer>
        </form>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="flex justify-between">
      <dt className={accent ? "text-[#3e5a47]" : "text-sand-600"}>{label}</dt>
      <dd className={`tabular-nums ${accent ? "text-[#3e5a47]" : "text-sand-700"}`}>
        {value}
      </dd>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="mb-2 text-sm font-medium text-sand-800">{children}</h3>;
}

/** Үйлчлүүлэгчийг утас/нэрээр хайх, эсвэл шинээр бүртгэх. */
function ClientPicker({
  selected,
  creating,
  onSelect,
  onStartCreate,
  onClear,
}: {
  selected: ClientOption | null;
  creating: boolean;
  onSelect: (client: ClientOption) => void;
  onStartCreate: () => void;
  onClear: () => void;
}) {
  const [query, setQuery] = useState("");
  // Хариуг ямар хайлтынх болохыг нь хамт хадгална — ингэснээр хожуу ирсэн
  // хариу шинэ хайлтын үр дүнг дарахгүй.
  const [results, setResults] = useState<{
    query: string;
    items: ClientOption[];
  }>({ query: "", items: [] });
  const [isSearching, startSearch] = useTransition();

  const trimmed = query.trim();

  useEffect(() => {
    if (trimmed.length < 2) return;
    const timer = setTimeout(() => {
      startSearch(async () => {
        const found = await findClients(trimmed);
        setResults({ query: trimmed, items: found });
      });
    }, 250);
    return () => clearTimeout(timer);
  }, [trimmed]);

  const items = results.query === trimmed ? results.items : [];

  if (selected) {
    return (
      <div className="flex items-start justify-between gap-3 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2.5">
        <div className="min-w-0">
          <p className="truncate font-medium text-sand-900">{selected.name}</p>
          <p className="truncate text-sm text-sand-600">{selected.phone}</p>
          {selected.note ? (
            <p className="mt-1 truncate text-xs text-[#986438]">⚠ {selected.note}</p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onClear}
          className="shrink-0 text-sm text-brand-700 underline underline-offset-2"
        >
          Солих
        </button>
      </div>
    );
  }

  if (creating) {
    return (
      <div className="space-y-2 rounded-lg border border-sand-300 p-3">
        <div className="grid gap-2 sm:grid-cols-2">
          <input
            name="clientName"
            placeholder="Нэр"
            required
            className={inputClass}
          />
          <input
            name="clientPhone"
            type="tel"
            inputMode="numeric"
            placeholder="Утас"
            required
            className={inputClass}
          />
        </div>
        <input
          name="clientNote"
          placeholder="Тэмдэглэл (харшил, дуртай өнгө гэх мэт)"
          className={inputClass}
        />
        <button
          type="button"
          onClick={onClear}
          className="text-sm text-sand-600 underline underline-offset-2"
        >
          Бүртгэлтэй үйлчлүүлэгч хайх
        </button>
      </div>
    );
  }

  return (
    <div>
      <input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Нэр эсвэл утсаар хайх…"
        className={inputClass}
      />

      {trimmed.length >= 2 ? (
        <div className="mt-1.5 overflow-hidden rounded-lg border border-sand-200">
          {items.length === 0 && (isSearching || results.query !== trimmed) ? (
            <p className="px-3 py-2 text-sm text-sand-500">Хайж байна…</p>
          ) : items.length === 0 ? (
            <p className="px-3 py-2 text-sm text-sand-500">Олдсонгүй.</p>
          ) : (
            <ul className="max-h-44 overflow-y-auto scrollbar-slim">
              {items.map((client) => (
                <li key={client.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(client)}
                    className="flex w-full items-baseline justify-between gap-3 px-3 py-2 text-left text-sm transition hover:bg-sand-50"
                  >
                    <span className="truncate font-medium text-sand-900">
                      {client.name}
                    </span>
                    <span className="shrink-0 text-sand-500">{client.phone}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      <button
        type="button"
        onClick={onStartCreate}
        className="mt-2 text-sm text-brand-700 underline underline-offset-2"
      >
        + Шинэ үйлчлүүлэгч бүртгэх
      </button>
    </div>
  );
}

/** Захиалгын төлөв солих ба устгах. */
function StatusControls({
  appointment,
  onDone,
}: {
  appointment: DayAppointment;
  onDone: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function changeStatus(status: AppointmentStatus) {
    startTransition(async () => {
      const result = await setAppointmentStatus(appointment.id, status);
      setError(result.ok ? null : result.issues.join(" "));
    });
  }

  function remove() {
    if (
      !confirm(
        "Энэ захиалгыг бүрмөсөн устгах уу? Буцаах боломжгүй. Ирээгүй үйлчлүүлэгчийг устгахын оронд «Ирээгүй» төлөвт оруулахыг зөвлөе.",
      )
    ) {
      return;
    }
    startTransition(async () => {
      await deleteAppointment(appointment.id);
      onDone();
    });
  }

  return (
    <section className="border-t border-sand-200 pt-4">
      <SectionTitle>Төлөв</SectionTitle>
      <div className="flex flex-wrap gap-1.5">
        {STATUS_FLOW.map((status) => {
          const meta = STATUS_LABELS[status];
          const active = appointment.status === status;
          return (
            <button
              key={status}
              type="button"
              disabled={isPending || active}
              onClick={() => changeStatus(status)}
              className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium transition disabled:cursor-default ${
                active ? "" : "border-sand-300 text-sand-700 hover:bg-sand-50"
              }`}
              style={
                active
                  ? {
                      backgroundColor: meta.bg,
                      color: meta.color,
                      borderColor: meta.color,
                    }
                  : undefined
              }
            >
              {meta.label}
            </button>
          );
        })}
      </div>

      {error ? (
        <p role="alert" className="mt-2 text-sm text-[#9a5555]">
          {error}
        </p>
      ) : null}

      <button
        type="button"
        onClick={remove}
        disabled={isPending}
        className="mt-3 text-sm text-[#9a5555] underline underline-offset-2 disabled:opacity-50"
      >
        Захиалгыг устгах
      </button>
    </section>
  );
}
