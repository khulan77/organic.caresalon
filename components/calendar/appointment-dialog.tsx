"use client";

import {
  Fragment,
  startTransition,
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
import { formatMinutes, toDateKey, toLocalMinutes } from "@/lib/time";
import {
  addPayment,
  createAppointment,
  deleteAppointment,
  deletePayment,
  findClients,
  setAppointmentStatus,
  updateAppointment,
} from "@/app/(app)/calendar/actions";
import {
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATE_LABELS,
  summarize,
} from "@/lib/payments";
import type { ActionResult } from "@/lib/action-result";
import type {
  AppointmentStatus,
  PaymentMethod,
} from "@/lib/generated/prisma/enums";
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
      /** Бүлгийн ҮНДСЭН мөр — нэмэлт төлбөр, төлбөр энд наалддаг */
      appointment: DayAppointment;
      /** Бүлгийн бүх мөр (ганц захиалга бол ганц элемент) */
      siblings: DayAppointment[];
      /** Цуцлагдсан бол тэр цагийг дараа нь авсан захиалга */
      replacement: {
        clientName: string;
        startMin: number;
        endMin: number;
        bookedAt: Date;
      } | null;
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
  /** Худал бол зөвхөн харах — бүх талбар идэвхгүй, хадгалах товч гарахгүй */
  canWrite: boolean;
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
  canWrite,
  onClose,
}: Props) {
  const editing = state.mode === "edit" ? state.appointment : null;
  /** Бүлгийн бүх мөр — үйлчилгээ, хөнгөлөлт бүгдийг эндээс цуглуулна. */
  const siblings = state.mode === "edit" ? state.siblings : [];
  const replacement = state.mode === "edit" ? state.replacement : null;

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
    const booked = siblings.flatMap((sibling) =>
      sibling.items
        .map((item) => allServices.find((s) => s.name === item.name)?.id)
        .filter((id): id is string => Boolean(id)),
    );
    const inPackage =
      packages
        .find((p) => p.id === editing.packageId)
        ?.items.map((item) => item.serviceId) ?? [];
    return booked.filter((id) => !inPackage.includes(id));
  });

  /**
   * Үйлчилгээ бүрийг ХЭН хийх. Энд байхгүй үйлчилгээ үндсэн ажилтанд очно.
   * Засварлах үед бүлгийн мөр бүрээс нь буцаан уншина.
   */
  const [serviceStaff, setServiceStaff] = useState<Record<string, string>>(
    () => {
      const map: Record<string, string> = {};
      for (const sibling of siblings) {
        for (const item of sibling.items) {
          const service = allServices.find((s) => s.name === item.name);
          if (service) map[service.id] = sibling.staffId;
        }
      }
      return map;
    },
  );

  // Сервер рүү явах эцсийн жагсаалт — багцынх урд, нэмэлт нь ард
  const serviceIds = useMemo(
    () => [
      ...packageServiceIds,
      ...extraIds.filter((id) => !packageServiceIds.includes(id)),
    ],
    [packageServiceIds, extraIds],
  );

  const [primaryStaffId, setPrimaryStaffId] = useState(
    state.mode === "edit" ? state.appointment.staffId : state.staffId,
  );

  /** Үйлчилгээг хэн хийх — хуваарилагдаагүй бол үндсэн ажилтан. */
  function staffOf(serviceId: string): string {
    return serviceStaff[serviceId] ?? primaryStaffId;
  }

  const selectedServices = serviceIds
    .map((id) => allServices.find((s) => s.id === id))
    .filter((s): s is (typeof allServices)[number] => Boolean(s));

  /** Ажилтан тус бүрийн хугацаа — хэд хэдэн ажилтан зэрэг ажиллаж болно. */
  const durationByStaff = new Map<string, number>();
  for (const service of selectedServices) {
    const id = staffOf(service.id);
    durationByStaff.set(id, (durationByStaff.get(id) ?? 0) + service.durationMin);
  }

  /**
   * Бүлгийн хугацаа = ХАМГИЙН УРТ ажилтных (сервертэй ижил дүрэм).
   * Зэрэг эхэлж зэрэг дуусна.
   */
  const totalDuration = [...durationByStaff.values()].reduce(
    (max, value) => Math.max(max, value),
    0,
  );

  /** Хэдэн ажилтан оролцож байгаа — хуваарилалтын хэсгийг харуулах эсэхэд. */
  const involvedStaffIds = [...durationByStaff.keys()];
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
    // Хөнгөлөлт бүлгийн мөрүүдэд хуваарилагдсан байдаг — нийлбэрээр нь буцаана
    const groupDiscount = siblings.reduce((sum, row) => sum + row.discount, 0);
    if (!editing || groupDiscount <= 0) return "";
    const fromPackage = editing.packageId
      ? (packages
          .find((p) => p.id === editing.packageId)
          ?.items.reduce(
            (sum, item) => sum + effectivePrice(item.service),
            0,
          ) ?? 0) -
        (packages.find((p) => p.id === editing.packageId)?.price ?? 0)
      : 0;
    const manual = groupDiscount - Math.max(0, fromPackage);
    return manual > 0 ? String(manual) : "";
  });
  const manual = Number(manualDiscount.replace(/\D/g, "")) || 0;

  /**
   * Нэмэлт төлбөр — формын төлөвт барина. Хадгалахад бүхэлд нь дахин бичигдэнэ.
   * `key` нь зөвхөн React-ийн жагсаалтад зориулсан, сервер рүү явахгүй.
   */
  const [charges, setCharges] = useState<
    { key: string; label: string; amount: string }[]
  >(() =>
    editing
      ? editing.charges.map((charge) => ({
          key: charge.id,
          label: charge.label,
          amount: String(charge.amount),
        }))
      : [],
  );

  const extraTotal = charges.reduce(
    (sum, charge) => sum + (Number(charge.amount.replace(/\D/g, "")) || 0),
    0,
  );

  // Хөнгөлөлт нь үйлчилгээний дүнгээс хэтрэхгүй (сервертэй ижил дүрэм)
  const discount = Math.min(subtotal, packageDiscount + manual);
  const totalPrice = subtotal + extraTotal - discount;

  // ── Төлбөрийн байдал (зөвхөн засварлах үед — шинэ захиалга хараахан байхгүй)
  const payments = editing?.payments ?? [];
  const money = summarize({ totalPrice, payments });

  function addChargeRow() {
    setCharges((current) => [
      ...current,
      { key: `new-${Date.now()}-${current.length}`, label: "", amount: "" },
    ]);
  }

  function updateChargeRow(
    key: string,
    patch: Partial<{ label: string; amount: string }>,
  ) {
    setCharges((current) =>
      current.map((charge) =>
        charge.key === key ? { ...charge, ...patch } : charge,
      ),
    );
  }

  function removeChargeRow(key: string) {
    setCharges((current) => current.filter((charge) => charge.key !== key));
  }

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
          !canWrite
            ? "Цаг захиалгын дэлгэрэнгүй"
            : state.mode === "create"
              ? "Шинэ цаг захиалга"
              : "Цаг захиалга засах"
        }
        className="relative flex max-h-[92vh] w-full max-w-2xl flex-col rounded-t-2xl bg-white shadow-xl sm:rounded-2xl"
      >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-sand-200 px-5 py-4">
          <div>
            <h2 className="font-serif text-lg text-sand-900">
              {!canWrite
                ? "Цаг захиалга"
                : state.mode === "create"
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
          {/* Үйлчилгээ ба түүнийг хийх ажилтан — сервер индексээр нь хослуулна */}
          {serviceIds.map((id) => (
            <Fragment key={id}>
              <input type="hidden" name="serviceIds" value={id} />
              <input type="hidden" name="serviceStaffId" value={staffOf(id)} />
            </Fragment>
          ))}
          <input type="hidden" name="discount" value={String(manual)} />
          {selectedClient && !creatingClient ? (
            <input type="hidden" name="clientId" value={selectedClient.id} />
          ) : null}

          <fieldset
            disabled={!canWrite}
            className="min-w-0 space-y-5 px-5 py-4 disabled:opacity-90"
          >
            {!canWrite ? (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-200">
                Өөр салбарын захиалга — зөвхөн харна. Өөрчлөх бол тухайн
                салбарын ресепшн эсвэл админд хандана уу.
              </p>
            ) : null}

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
              <Field
                label="Үндсэн ажилтан"
                hint={
                  involvedStaffIds.length > 1
                    ? "Нэхэмжлэх энэ ажилтны мөрөнд наалдана"
                    : undefined
                }
              >
                <select
                  name="staffId"
                  value={primaryStaffId}
                  onChange={(event) => setPrimaryStaffId(event.target.value)}
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

            {/* Ажилтны хуваарилалт — 2+ ажилтантай салбарт л утга учиртай */}
            {selectedServices.length > 0 && staff.length > 1 ? (
              <section className="rounded-xl border border-sand-200 p-3">
                <SectionTitle>Хэн хийх</SectionTitle>
                <p className="mb-2 text-xs text-sand-500">
                  Хоёр ажилтан зэрэг үйлчилбэл цаг нь зэрэг эхэлж зэрэг дуусна.
                </p>
                <div className="space-y-2">
                  {selectedServices.map((service) => (
                    <div
                      key={service.id}
                      className="flex flex-wrap items-center gap-2 text-sm"
                    >
                      <span className="min-w-[8rem] flex-1 truncate text-sand-800">
                        {service.name}
                        <span className="ml-1.5 text-xs text-sand-400">
                          {formatDuration(service.durationMin)}
                        </span>
                      </span>
                      <select
                        value={staffOf(service.id)}
                        onChange={(event) =>
                          setServiceStaff((current) => ({
                            ...current,
                            [service.id]: event.target.value,
                          }))
                        }
                        aria-label={`${service.name} — ажилтан`}
                        className={`${inputClass} w-full shrink-0 sm:w-40`}
                      >
                        {staff.map((member) => (
                          <option key={member.id} value={member.id}>
                            {member.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>

                {involvedStaffIds.length > 1 ? (
                  <ul className="mt-3 space-y-1 border-t border-sand-100 pt-2 text-xs text-sand-600">
                    {involvedStaffIds.map((id) => {
                      const member = staff.find((m) => m.id === id);
                      const own = durationByStaff.get(id) ?? 0;
                      return (
                        <li key={id} className="flex justify-between gap-2">
                          <span className="truncate">{member?.name ?? "—"}</span>
                          <span className="shrink-0 tabular-nums">
                            {formatDuration(own)}
                            {own < totalDuration
                              ? ` · +${formatDuration(totalDuration - own)} хүлээнэ`
                              : ""}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </section>
            ) : null}

            {totalDuration > 0 ? (
              <p className="rounded-lg bg-sand-100/70 px-3 py-2 text-sm text-sand-600">
                Дуусах цаг:{" "}
                <strong className="tabular-nums text-sand-900">
                  {formatMinutes(defaultStartMin + totalDuration)}
                </strong>{" "}
                (нийт {formatDuration(totalDuration)}
                {involvedStaffIds.length > 1
                  ? `, ${involvedStaffIds.length} ажилтан зэрэг`
                  : ""}
                )
              </p>
            ) : null}

            {/* Нэмэлт төлбөр, хөнгөлөлт ба тооцоо */}
            {selectedServices.length > 0 ? (
              <section className="rounded-xl border border-sand-200 p-3">
                {/* ── Нэмэлт төлбөр ── */}
                <div className="mb-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-sand-800">
                      Нэмэлт төлбөр
                    </span>
                    <button
                      type="button"
                      onClick={addChargeRow}
                      className="rounded-lg border border-sand-300 px-2.5 py-1 text-xs text-sand-700 transition hover:bg-sand-100"
                    >
                      + Нэмэх
                    </button>
                  </div>

                  {charges.length === 0 ? (
                    <p className="text-xs text-sand-500">
                      Урт хумс, нэмэлт чимэглэл гэх мэт үйлчилгээний жагсаалтад
                      байхгүй төлбөрийг энд нэмнэ.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {charges.map((charge) => (
                        <div
                          key={charge.key}
                          className="flex flex-wrap items-center gap-2"
                        >
                          <input
                            type="text"
                            name="chargeLabel"
                            value={charge.label}
                            onChange={(event) =>
                              updateChargeRow(charge.key, {
                                label: event.target.value,
                              })
                            }
                            placeholder="Юуны төлбөр"
                            maxLength={80}
                            className={`${inputClass} min-w-[8rem] flex-1`}
                          />
                          <input
                            type="number"
                            name="chargeAmount"
                            min={0}
                            step={1000}
                            value={charge.amount}
                            onChange={(event) =>
                              updateChargeRow(charge.key, {
                                amount: event.target.value,
                              })
                            }
                            placeholder="0"
                            className={`${inputClass} w-28 shrink-0 text-right`}
                          />
                          <button
                            type="button"
                            onClick={() => removeChargeRow(charge.key)}
                            aria-label="Нэмэлт төлбөр хасах"
                            className="shrink-0 rounded-lg p-1.5 text-sand-400 transition hover:bg-sand-100 hover:text-sand-800"
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="border-t border-sand-100 pt-3 sm:max-w-xs">
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
                  <Row label="Үйлчилгээ" value={formatPrice(subtotal)} />
                  {extraTotal > 0 ? (
                    <Row
                      label="Нэмэлт төлбөр"
                      value={`+ ${formatPrice(extraTotal)}`}
                    />
                  ) : null}
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

            {/* Төлбөр */}
            {editing ? (
              <PaymentSection
                appointmentId={editing.id}
                payments={payments}
                money={money}
                totalPrice={totalPrice}
              />
            ) : selectedServices.length > 0 ? (
              <section className="rounded-xl border border-sand-200 p-3">
                <SectionTitle>Урьдчилгаа</SectionTitle>
                <p className="mb-2 text-xs text-sand-500">
                  Захиалахдаа урьдчилж авсан төлбөр байвал энд бичнэ. Үлдэгдлийг
                  дараа нь захиалгын цонхноос бүртгэнэ.
                </p>
                <div className="flex flex-wrap gap-2 sm:max-w-md">
                  <input
                    type="number"
                    name="depositAmount"
                    min={0}
                    max={totalPrice}
                    step={1000}
                    placeholder="0"
                    className={`${inputClass} min-w-[7rem] flex-1 text-right`}
                  />
                  <select
                    name="depositMethod"
                    defaultValue="CASH"
                    aria-label="Төлбөрийн хэлбэр"
                    className={`${inputClass} w-32 shrink-0`}
                  >
                    {PAYMENT_METHODS.map((method) => (
                      <option key={method} value={method}>
                        {PAYMENT_METHOD_LABELS[method]}
                      </option>
                    ))}
                  </select>
                </div>
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
              <StatusControls
                appointment={editing}
                replacement={replacement}
                onDone={onClose}
              />
            ) : null}
          </fieldset>

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
                {canWrite ? "Болих" : "Хаах"}
              </button>
              {canWrite ? (
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
              ) : null}
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

/**
 * Төлбөрийн хэсэг — бүртгэсэн төлбөрүүд ба шинээр авах талбар.
 *
 * Гол формын ДОТОР байрлах тул энд <form> ҮҮСГЭХГҮЙ (HTML-д form дотор form
 * байж болохгүй). Оронд нь FormData-г гараар угсарч action-ыг дуудна.
 */
function PaymentSection({
  appointmentId,
  payments,
  money,
  totalPrice,
}: {
  appointmentId: string;
  payments: DayAppointment["payments"];
  money: ReturnType<typeof summarize>;
  totalPrice: number;
}) {
  const [result, formAction, isPending] = useActionState<
    ActionResult | null,
    FormData
  >(addPayment, null);

  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("CASH");
  const [isDeposit, setIsDeposit] = useState(false);
  const [isRemoving, startRemove] = useTransition();

  // Амжилттай бүртгэсний дараа талбарыг цэвэрлэнэ.
  // Effect биш — рендерийн үед өмнөх үртэй харьцуулж тохируулна (React-ийн
  // «adjusting state during render» загвар), ингэснээр нэмэлт дүрслэл гарахгүй.
  const [seenResult, setSeenResult] = useState(result);
  if (result !== seenResult) {
    setSeenResult(result);
    if (result?.ok) setAmount("");
  }

  const state = PAYMENT_STATE_LABELS[money.state];
  const due = Math.max(0, money.balance);

  function submit() {
    const data = new FormData();
    data.set("appointmentId", appointmentId);
    data.set("amount", amount);
    data.set("method", method);
    if (isDeposit) data.set("isDeposit", "on");
    startTransition(() => formAction(data));
  }

  return (
    <section className="rounded-xl border border-sand-200 p-3">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <SectionTitle>Төлбөр</SectionTitle>
        <span
          className="rounded-full px-2 py-0.5 text-xs font-medium"
          style={{ backgroundColor: state.bg, color: state.color }}
        >
          {state.label}
          {money.hasDeposit && money.state === "PARTIAL"
            ? " · урьдчилгаатай"
            : ""}
        </span>
      </div>

      <dl className="mb-3 space-y-1 text-sm">
        <Row label="Төлөх дүн" value={formatPrice(totalPrice)} />
        <Row label="Төлсөн" value={formatPrice(money.paid)} accent />
        <div className="flex justify-between border-t border-sand-100 pt-1 font-semibold text-sand-900">
          <dt>{money.balance < 0 ? "Илүү төлсөн" : "Үлдэгдэл"}</dt>
          <dd className="tabular-nums">
            {formatPrice(Math.abs(money.balance))}
          </dd>
        </div>
      </dl>

      {payments.length > 0 ? (
        <ul className="mb-3 divide-y divide-sand-100 border-t border-sand-100">
          {payments.map((payment) => (
            <li
              key={payment.id}
              className="flex flex-wrap items-center gap-x-2 gap-y-0.5 py-1.5 text-sm"
            >
              <span className="w-24 shrink-0 tabular-nums font-medium text-sand-900">
                {formatPrice(payment.amount)}
              </span>
              <span className="shrink-0 text-xs text-sand-500">
                {PAYMENT_METHOD_LABELS[payment.method]}
              </span>
              {payment.isDeposit ? (
                <span className="shrink-0 rounded bg-sand-200 px-1.5 py-0.5 text-[11px] text-sand-700">
                  урьдчилгаа
                </span>
              ) : null}
              <span className="min-w-[10rem] flex-1 truncate text-xs text-sand-400">
                {toDateKey(payment.createdAt)}
                {payment.receivedBy ? ` · ${payment.receivedBy.name}` : ""}
                {payment.note ? ` · ${payment.note}` : ""}
              </span>
              <button
                type="button"
                disabled={isRemoving}
                onClick={() =>
                  startRemove(async () => {
                    await deletePayment(payment.id);
                  })
                }
                aria-label="Төлбөр устгах"
                className="shrink-0 rounded-lg p-1 text-sand-400 transition hover:bg-sand-100 hover:text-[#9a5555] disabled:opacity-50"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {/* ── Шинэ төлбөр ── */}
      <div className="space-y-2 border-t border-sand-100 pt-3">
        <div className="flex flex-wrap gap-2">
          <input
            type="number"
            step={1000}
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            placeholder={due > 0 ? String(due) : "0"}
            aria-label="Төлбөрийн дүн"
            className={`${inputClass} min-w-[7rem] flex-1 text-right`}
          />
          <select
            value={method}
            onChange={(event) =>
              setMethod(event.target.value as PaymentMethod)
            }
            aria-label="Төлбөрийн хэлбэр"
            className={`${inputClass} w-32 shrink-0`}
          >
            {PAYMENT_METHODS.map((option) => (
              <option key={option} value={option}>
                {PAYMENT_METHOD_LABELS[option]}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-sand-700">
            <input
              type="checkbox"
              checked={isDeposit}
              onChange={(event) => setIsDeposit(event.target.checked)}
              className="size-4 rounded border-sand-300"
            />
            Урьдчилгаа
          </label>

          <div className="flex gap-2">
            {due > 0 ? (
              <button
                type="button"
                onClick={() => setAmount(String(due))}
                className="rounded-lg border border-sand-300 px-2.5 py-1.5 text-xs text-sand-700 transition hover:bg-sand-100"
              >
                Үлдэгдлийг бүтнээр
              </button>
            ) : null}
            <button
              type="button"
              onClick={submit}
              disabled={isPending || !amount}
              className="rounded-lg bg-sand-800 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-sand-900 disabled:opacity-50"
            >
              {isPending ? "Бүртгэж байна…" : "Төлбөр бүртгэх"}
            </button>
          </div>
        </div>

        {result && !result.ok ? <Issues issues={result.issues} /> : null}
      </div>
    </section>
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
  replacement,
  onDone,
}: {
  appointment: DayAppointment;
  replacement: {
    clientName: string;
    startMin: number;
    endMin: number;
    bookedAt: Date;
  } | null;
  onDone: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  /** Цуцлах/ирээгүй болгохын өмнө шалтгаан асуух үе шат. */
  const [pendingCancel, setPendingCancel] = useState<AppointmentStatus | null>(
    null,
  );
  const [reason, setReason] = useState("");

  function changeStatus(status: AppointmentStatus, why?: string) {
    startTransition(async () => {
      const result = await setAppointmentStatus(appointment.id, status, why);
      setError(result.ok ? null : result.issues.join(" "));
      if (result.ok) {
        setPendingCancel(null);
        setReason("");
      }
    });
  }

  function pick(status: AppointmentStatus) {
    // Цуцлалтыг түүхэнд үлдээх тул шалтгааныг нь эхлээд асууна
    if (status === "CANCELLED" || status === "NO_SHOW") {
      setPendingCancel(status);
      return;
    }
    changeStatus(status);
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
              onClick={() => pick(status)}
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

      {/* ── Цуцлах шалтгаан ── */}
      {pendingCancel ? (
        <div className="mt-3 rounded-xl border border-sand-300 bg-sand-50 p-3">
          <p className="mb-2 text-sm text-sand-700">
            {STATUS_LABELS[pendingCancel].label} болгох — шалтгаанаа бичвэл
            дараа нь хэн, юуны улмаас цуцалсныг харах боломжтой.
          </p>
          <input
            type="text"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Жишээ: үйлчлүүлэгч утсаар цуцаллаа"
            maxLength={120}
            className={inputClass}
          />
          <div className="mt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setPendingCancel(null);
                setReason("");
              }}
              className="rounded-lg border border-sand-300 px-3 py-1.5 text-xs text-sand-700 transition hover:bg-sand-100"
            >
              Болих
            </button>
            <button
              type="button"
              disabled={isPending}
              onClick={() => changeStatus(pendingCancel, reason)}
              className="rounded-lg bg-[#9a5555] px-3 py-1.5 text-xs font-medium text-white transition hover:brightness-110 disabled:opacity-50"
            >
              {isPending ? "Хадгалж байна…" : "Баталгаажуулах"}
            </button>
          </div>
        </div>
      ) : null}

      {/* ── Цуцлалтын түүх ── */}
      {appointment.cancelledAt ? (
        <div className="mt-3 rounded-xl bg-[#f6e8e8] px-3 py-2 text-sm text-[#7d4646]">
          <p>
            <strong>{STATUS_LABELS[appointment.status].label}</strong>
            {appointment.cancelledBy
              ? ` — ${appointment.cancelledBy.name}`
              : ""}
            <span className="text-[#9a7070]">
              {" · "}
              {toDateKey(appointment.cancelledAt)}{" "}
              {formatMinutes(toLocalMinutes(appointment.cancelledAt))}
            </span>
          </p>
          {appointment.cancelReason ? (
            <p className="mt-0.5 text-[13px]">{appointment.cancelReason}</p>
          ) : null}

          {replacement ? (
            <p className="mt-1.5 border-t border-[#e6cfcf] pt-1.5 text-[13px] text-[#5c5850]">
              Энэ цагийг <strong>{replacement.clientName}</strong> авсан (
              {formatMinutes(replacement.startMin)}–
              {formatMinutes(replacement.endMin)}, бүртгэсэн{" "}
              {toDateKey(replacement.bookedAt)}).
            </p>
          ) : (
            <p className="mt-1.5 border-t border-[#e6cfcf] pt-1.5 text-[13px] text-[#5c5850]">
              Энэ цаг одоогоор сул байна.
            </p>
          )}
        </div>
      ) : null}

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
