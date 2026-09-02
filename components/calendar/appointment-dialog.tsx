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
  ServiceCatalog,
} from "@/lib/queries";
import { STATUS_LABELS, formatDuration, formatPrice } from "@/lib/labels";
import { effectivePrice, isSaleActive } from "@/lib/pricing";
import {
  formatMinutes,
  parseMinutes,
  toDateKey,
  toLocalMinutes,
} from "@/lib/time";
import {
  addPayment,
  createAppointment,
  deleteAppointment,
  deletePayment,
  findClients,
  freeStartTimes,
  setAppointmentStatus,
  settleAppointment,
  updateAppointment,
} from "@/app/(app)/calendar/actions";
import {
  PAYMENT_METHOD_CHOICES,
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATE_LABELS,
  summarize,
} from "@/lib/payments";
import type { ActionResult } from "@/lib/action-result";
import type {
  AppointmentStatus,
  PaymentMethod,
} from "@/lib/generated/prisma/enums";
import { addTimeOff } from "@/app/(app)/staff/actions";
import { Field, Issues, inputClass } from "@/components/ui/form";
import { CopyButton } from "@/components/ui/copy-button";
import { buildBookingText } from "@/lib/booking-text";

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
  /** Мессежид оруулах салбарын нэр */
  branchName: string;
  catalog: ServiceCatalog;
  /** Худал бол зөвхөн харах — бүх талбар идэвхгүй, хадгалах товч гарахгүй */
  canWrite: boolean;
  /** Админ бол энэ цагийг чөлөө болгож тэмдэглэж чадна */
  isAdmin: boolean;
  onClose: () => void;
};

/** Цаг сонголтын алхам — 30 минут. */
const SLOT_STEP = 30;

/**
 * Үргэлжлэх хугацааны бэлэн сонголтууд.
 *
 * Жагсаалтын хугацаа зөвхөн тооцоолол: нэг цагийн хоёр маникурыг мастер цаг
 * хагаст багтааж болно. Ресепшн бодит хугацааг нь энд шууд тавина.
 */
const DURATION_PRESETS = [30, 60, 90, 120, 150, 180, 240];

/** 00:00–23:30 хүртэлх 30 минутын цагууд. */
const START_TIMES = Array.from(
  { length: (24 * 60) / SLOT_STEP },
  (_, index) => index * SLOT_STEP,
);

/** Дурын минутыг хамгийн ойрын 30 минутын нүд рүү буулгана. */
function nearestSlot(minutes: number): string {
  const snapped = Math.round(minutes / SLOT_STEP) * SLOT_STEP;
  return formatMinutes(Math.min(snapped, 24 * 60 - SLOT_STEP));
}

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
  branchName,
  catalog,
  canWrite,
  isAdmin,
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

  /**
   * Сонгосон үйлчилгээнүүд.
   * Засварлах үед үйлчилгээг НЭРЭЭР нь тааруулна — AppointmentService.id нь
   * Service.id-тэй ижил биш. Цонх нь `key`-ээр дахин үүсдэг тул анхны утгыг
   * энд шууд тооцоход хангалттай.
   */
  const [serviceIds, setServiceIds] = useState<string[]>(() => {
    if (!editing) return [];
    return siblings.flatMap((sibling) =>
      sibling.items
        .map((item) => allServices.find((s) => s.name === item.name)?.id)
        .filter((id): id is string => Boolean(id)),
    );
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

  /**
   * ГАРААР тохируулсан үргэлжлэх хугацаа — `null` бол үйлчилгээгээр бодно.
   *
   * Засварлах үед: хадгалагдсан урт нь жагсаалтын хугацаанаас зөрж байвал
   * хэн нэгэн зориуд тохируулсан гэсэн үг тул түүнийг барина.
   */
  const [durationOverride, setDurationOverride] = useState<number | null>(
    () => {
      if (!editing) return null;
      const actual = Math.round(
        (editing.endAt.getTime() - editing.startAt.getTime()) / 60_000,
      );
      return actual > 0 && actual !== totalDuration ? actual : null;
    },
  );

  /** Захиалгын бодит урт — цаг, сул цаг, дуусах цаг бүгд үүгээр тооцогдоно. */
  const effectiveDuration = durationOverride ?? totalDuration;

  /**
   * ДАВХАР ЗАХИАЛГА — завгүй цаг дээр зориуд бүртгэнэ.
   *
   * Мастер нэг зэрэг хоёр үйлчлүүлэгч хөтөлдөг тохиолдолд л. Асаахад завгүй
   * цагууд ч сул цагийн жагсаалтад гарч ирнэ.
   */
  const [allowOverlap, setAllowOverlap] = useState(
    editing?.allowOverlap ?? false,
  );

  /** Хэдэн ажилтан оролцож байгаа — хуваарилалтын хэсгийг харуулах эсэхэд. */
  const involvedStaffIds = [...durationByStaff.keys()];
  const subtotal = selectedServices.reduce(
    (sum, s) => sum + effectivePrice(s),
    0,
  );

  /**
   * Нэмэлт төлбөр — формын төлөвт барина. Хадгалахад бүхэлд нь дахин бичигдэнэ.
   * Зөвхөн ДҮН: юуны төлбөр болохыг асуухгүй.
   * `key` нь зөвхөн React-ийн жагсаалтад зориулсан, сервер рүү явахгүй.
   */
  const [charges, setCharges] = useState<{ key: string; amount: string }[]>(
    () => {
      const existing = editing
        ? editing.charges.map((charge) => ({
            key: charge.id,
            amount: String(charge.amount),
          }))
        : [];
      // Дарж нээх шаардлагагүй — хоосон мөр анхнаасаа харагдана.
      // Хоосон мөр (дүн 0) хадгалахад шүүгдэж хаягдана.
      return existing.length > 0 ? existing : [{ key: "row-0", amount: "" }];
    },
  );

  const extraTotal = charges.reduce(
    (sum, charge) => sum + (Number(charge.amount.replace(/\D/g, "")) || 0),
    0,
  );

  // Захиалгын түвшинд хөнгөлөлт байхгүй — үйлчилгээ + нэмэлт төлбөр
  const totalPrice = subtotal + extraTotal;

  // ── Төлбөрийн байдал (зөвхөн засварлах үед — шинэ захиалга хараахан байхгүй)
  const payments = editing?.payments ?? [];
  const money = summarize({ totalPrice, payments });

  function addChargeRow() {
    setCharges((current) => [
      ...current,
      { key: `new-${Date.now()}-${current.length}`, amount: "" },
    ]);
  }

  function updateChargeRow(key: string, amount: string) {
    setCharges((current) =>
      current.map((charge) =>
        charge.key === key ? { ...charge, amount } : charge,
      ),
    );
  }

  function removeChargeRow(key: string) {
    setCharges((current) => current.filter((charge) => charge.key !== key));
  }

  /**
   * Шинэ цагийн цонхны хоёр горим: захиалга авах уу, эсвэл тэр цагийг
   * ажилтны чөлөө болгох уу. Чөлөө зөвхөн админд.
   */
  const [tab, setTab] = useState<"book" | "off">("book");
  const offMode = state.mode === "create" && isAdmin && tab === "off";

  /** Захиалахдаа шууд бүтнээр төлсөн эсэх. */
  const [paidInFull, setPaidInFull] = useState(false);
  /** Урьдчилж авсан дүн — «төлсөн» биш үед л хэрэглэнэ. */
  const [deposit, setDeposit] = useState("");
  /** Урьдчилгаа / бүтэн төлөлтийг ямар хэлбэрээр авсан. */
  const [depositMethod, setDepositMethod] = useState<PaymentMethod>("CASH");

  /**
   * Хурдан цуцлалт — цонх нээмэгц доод мөрөнд томоор харагдана.
   *
   * Ресепшн утсаар ярьж байхдаа нэг дарж чөлөөлнө: шалтгаан асуухгүй, гүйлгэж
   * доош бууж «Төлөв» хэсэг хайх ч шаардлагагүй. Андуурсан бол тэр даруй
   * «Сэргээх» болж хувирна.
   */
  const [isCancelling, startCancel] = useTransition();
  const [cancelError, setCancelError] = useState<string | null>(null);
  const cancelled =
    editing?.status === "CANCELLED" || editing?.status === "NO_SHOW";

  function quickStatus(status: AppointmentStatus) {
    if (!editing) return;
    setCancelError(null);
    startCancel(async () => {
      const outcome = await setAppointmentStatus(editing.id, status);
      setCancelError(outcome.ok ? null : outcome.issues.join(" "));
    });
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

  // ── Эхлэх цаг: тухайн ажилтны СУЛ ЦАГУУДЫГ л санал болгоно
  /** Огноо цонхонд солигдож болно — сул цаг шинэ өдрөөрөө татагдана. */
  const [dateKey, setDateKey] = useState(state.dateKey);
  /** Байгаа захиалгын цагийг ЯГ хэвээр нь барина — засахад цаг өөрөө шилжихгүй. */
  const [startTime, setStartTime] = useState(() =>
    state.mode === "edit"
      ? formatMinutes(defaultStartMin)
      : nearestSlot(defaultStartMin),
  );
  const startMin = parseMinutes(startTime);

  /** Зэрэг ажиллах бүх ажилтан сул байх ёстой — хуваарилалт хийгээгүй бол үндсэн нь. */
  const slotStaffIds =
    involvedStaffIds.length > 0 ? involvedStaffIds : [primaryStaffId];
  /** Үйлчилгээ сонгоогүй байхад ч сул цаг харагдана — нэг нүдээр хэмжинэ. */
  const slotDuration = effectiveDuration > 0 ? effectiveDuration : SLOT_STEP;
  const slotStaffNames = slotStaffIds
    .map((id) => staff.find((member) => member.id === id)?.name ?? "—")
    .join(", ");

  /**
   * Сул цагуудын хоорондын зай.
   *
   * Анхдагчаар үйлчилгээний уртаар (доод тал нь 1 цаг) — 30 минут тутам
   * санал болговол ар араасаа таарахгүй хагас цагууд хуримтлагдана.
   * Үйлчлүүлэгч тодорхой цаг нэрлэвэл 30 минутын алхам руу шилжиж болно.
   */
  const [fineSteps, setFineSteps] = useState(false);
  const slotStep = fineSteps
    ? SLOT_STEP
    : Math.max(2 * SLOT_STEP, Math.ceil(slotDuration / SLOT_STEP) * SLOT_STEP);

  /**
   * Сүүлд ирсэн хариу — ямар хүсэлтийнх болохыг нь `key`-ээр нь хамт барина.
   * Түлхүүр зөрж байвал л «ачаалж байна» гэсэн үг: эффект дотор төлөв
   * цэвэрлэх шаардлагагүй болно.
   */
  const [slotData, setSlotData] = useState<{
    key: string;
    slots: number[];
    reason: string | null;
  } | null>(null);

  /**
   * Дахин татах шалтгааныг НЭГ МӨРӨӨР илэрхийлнэ — массив нь дүрслэл бүрд
   * шинээр үүсдэг тул `useEffect`-ийн хамаарал болгож болохгүй.
   */
  const slotKey = [
    state.branchId,
    dateKey,
    [...slotStaffIds].sort().join(","),
    slotDuration,
    slotStep,
    allowOverlap ? "1" : "0",
    siblings.map((sibling) => sibling.id).join(","),
  ].join("|");

  const mode = state.mode;
  /** Хариу нь одоогийн түлхүүрийнх биш бол ачаалж байна. */
  const slots = slotData?.key === slotKey ? slotData.slots : null;
  const slotReason = slotData?.key === slotKey ? slotData.reason : null;

  useEffect(() => {
    if (!canWrite) return;
    const [branchId, day, staffIds, duration, step, overlap, exclude] =
      slotKey.split("|");

    let active = true;

    // Үйлчилгээ дараалан дарахад сүлжээ дүүргэхгүй
    const timer = setTimeout(() => {
      freeStartTimes({
        branchId,
        dateKey: day,
        staffIds: staffIds.split(","),
        durationMin: Number(duration),
        stepMin: Number(step),
        allowOverlap: overlap === "1",
        excludeAppointmentIds: exclude ? exclude.split(",") : [],
        rejectPastTime: mode === "create",
      })
        .then((outcome) => {
          if (!active) return;
          setSlotData({
            key: slotKey,
            slots: outcome.slots,
            reason: outcome.reason,
          });
        })
        .catch(() => {
          if (!active) return;
          setSlotData({
            key: slotKey,
            slots: [],
            reason: "Сул цагийг ачаалж чадсангүй. Дахин оролдоно уу.",
          });
        });
    }, 120);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [canWrite, slotKey, mode]);

  /** Сонгосон цаг саналаас гарсан эсэх — жишээ нь үйлчилгээ нэмээд урт болсон. */
  const startTaken = slots !== null && !slots.includes(startMin);

  function toggleService(id: string) {
    setServiceIds((current) =>
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
        className="relative flex max-h-[92dvh] w-full max-w-2xl flex-col rounded-t-2xl bg-white shadow-xl sm:max-h-[92vh] sm:rounded-2xl"
      >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-sand-200 px-5 py-4">
          <div className="min-w-0">
            <h2 className="font-serif text-lg text-sand-900">
              {!canWrite
                ? "Цаг захиалга"
                : state.mode === "create"
                  ? offMode
                    ? "Чөлөө өгөх"
                    : "Шинэ цаг захиалга"
                  : "Цаг захиалга засах"}
            </h2>

            {/* Сул цагийг захиалга болгох уу, чөлөө болгох уу — зөвхөн админд */}
            {state.mode === "create" && canWrite && isAdmin ? (
              <div className="mt-2 flex items-center gap-1 rounded-full bg-sand-200/70 p-1">
                <button
                  type="button"
                  onClick={() => setTab("book")}
                  aria-pressed={tab === "book"}
                  className={`whitespace-nowrap rounded-full px-3 py-1 text-xs transition ${
                    tab === "book"
                      ? "bg-white font-medium text-sand-900 shadow-sm"
                      : "text-sand-500 hover:text-sand-800"
                  }`}
                >
                  Цаг захиалга
                </button>
                <button
                  type="button"
                  onClick={() => setTab("off")}
                  aria-pressed={tab === "off"}
                  className={`whitespace-nowrap rounded-full px-3 py-1 text-xs transition ${
                    tab === "off"
                      ? "bg-white font-medium text-sand-900 shadow-sm"
                      : "text-sand-500 hover:text-sand-800"
                  }`}
                >
                  Чөлөө
                </button>
              </div>
            ) : null}
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
          <div className="flex shrink-0 items-center gap-1.5">
            {editing ? (
              <CopyButton
                label="Хуулах"
                title="Үйлчлүүлэгч рүү илгээх баталгаажуулалтыг хуулах"
                getText={() =>
                  buildBookingText({
                    clientName: editing.client.name,
                    branchName,
                    startAt: editing.startAt,
                    endAt: editing.endAt,
                    lines: siblings.map((sibling) => ({
                      staffName:
                        staff.find((m) => m.id === sibling.staffId)?.name ?? "—",
                      items: sibling.items,
                    })),
                    extraTotal: editing.extraTotal,
                    totalPrice: siblings.reduce(
                      (sum, row) => sum + row.totalPrice,
                      0,
                    ),
                    paid: money.paid,
                  })
                }
              />
            ) : null}
            <button
              type="button"
              onClick={onClose}
              aria-label="Хаах"
              className="rounded-lg p-1.5 text-sand-500 transition hover:bg-sand-100 hover:text-sand-800"
            >
              ✕
            </button>
          </div>
        </header>

        {offMode ? (
          <TimeOffPanel
            staff={staff}
            defaultStaffId={state.mode === "create" ? state.staffId : ""}
            dateKey={state.dateKey}
            defaultStartMin={defaultStartMin}
            onClose={onClose}
          />
        ) : (
        <form
          action={formAction}
          className="flex min-h-0 flex-1 flex-col overflow-y-auto scrollbar-slim"
        >
          <input type="hidden" name="branchId" value={state.branchId} />
          {editing ? (
            <input type="hidden" name="appointmentId" value={editing.id} />
          ) : null}
          {/* Үйлчилгээ ба түүнийг хийх ажилтан — сервер индексээр нь хослуулна */}
          {serviceIds.map((id) => (
            <Fragment key={id}>
              <input type="hidden" name="serviceIds" value={id} />
              <input type="hidden" name="serviceStaffId" value={staffOf(id)} />
            </Fragment>
          ))}
          {selectedClient && !creatingClient ? (
            <input type="hidden" name="clientId" value={selectedClient.id} />
          ) : null}

          <fieldset
            disabled={!canWrite}
            className="min-w-0 space-y-5 px-5 py-4 disabled:opacity-90"
          >
            {!canWrite ? (
              <p className="rounded-lg bg-warn-50 px-3 py-2 text-sm text-warn-700 ring-1 ring-warn-200">
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

            {/* Үйлчилгээ */}
            <section>
              <SectionTitle>
                Үйлчилгээ
                {selectedServices.length > 0 ? (
                  <span className="ml-2 inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-2 py-0.5 align-middle text-xs font-medium text-brand-700 ring-1 ring-brand-200">
                    {selectedServices.length} сонгосон ·{" "}
                    {formatDuration(totalDuration)}
                  </span>
                ) : (
                  <span className="ml-2 font-normal text-sand-400">
                    дарж сонгоно
                  </span>
                )}
              </SectionTitle>

              <div className="space-y-2.5">
                {catalog.map((category) => {
                  const picked = category.services.filter((service) =>
                    serviceIds.includes(service.id),
                  ).length;
                  return (
                    <div
                      key={category.id}
                      className="overflow-hidden rounded-2xl ring-1 ring-sand-200"
                    >
                      {/* Ангиллын толгой — тухайн ангиллын өнгөөр намуухан будна */}
                      <div
                        className="flex items-center gap-2 px-3 py-1.5 text-xs font-semibold"
                        style={{
                          backgroundColor: `color-mix(in srgb, ${category.color} 13%, white)`,
                          color: `color-mix(in srgb, ${category.color} 72%, #22201d)`,
                        }}
                      >
                        <span
                          aria-hidden
                          className="size-2 shrink-0 rounded-full"
                          style={{ backgroundColor: category.color }}
                        />
                        <span className="truncate">{category.name}</span>
                        {picked > 0 ? (
                          <span
                            className="ml-auto shrink-0 rounded-full bg-white/70 px-1.5 text-[11px] tabular-nums"
                            aria-label={`${picked} сонгосон`}
                          >
                            {picked}
                          </span>
                        ) : null}
                      </div>

                      <div className="grid gap-1.5 bg-white p-1.5 sm:grid-cols-2">
                        {category.services.map((service) => {
                          const active = serviceIds.includes(service.id);
                          const color = service.color ?? category.color;
                          const sale = isSaleActive(service);
                          return (
                            <button
                              key={service.id}
                              type="button"
                              onClick={() => toggleService(service.id)}
                              aria-pressed={active}
                              className={`flex items-center gap-2.5 rounded-xl border px-2.5 py-2 text-left transition active:scale-[0.98] ${
                                active
                                  ? "shadow-sm"
                                  : "border-sand-200 bg-sand-50/70 hover:border-sand-300 hover:bg-white"
                              }`}
                              style={
                                active
                                  ? {
                                      borderColor: color,
                                      backgroundColor: `color-mix(in srgb, ${color} 11%, white)`,
                                    }
                                  : undefined
                              }
                            >
                              {/* Сонгосон эсэх — өнгөнөөс гадна тэмдгээр ч харагдана */}
                              <span
                                aria-hidden
                                className="flex size-5 shrink-0 items-center justify-center rounded-full border transition"
                                style={
                                  active
                                    ? { backgroundColor: color, borderColor: color }
                                    : { borderColor: "var(--color-sand-300)" }
                                }
                              >
                                {active ? (
                                  <svg
                                    viewBox="0 0 24 24"
                                    className="size-3 text-white"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth={3.5}
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  >
                                    <path d="m5 13 4 4L19 7" />
                                  </svg>
                                ) : null}
                              </span>

                              <span className="min-w-0 flex-1">
                                <span
                                  className="block truncate text-[13px] font-medium"
                                  style={{
                                    color: active
                                      ? `color-mix(in srgb, ${color} 78%, #22201d)`
                                      : undefined,
                                  }}
                                >
                                  {service.name}
                                </span>
                                <span className="mt-0.5 block text-[11px] text-sand-500">
                                  {formatDuration(service.durationMin)} ·{" "}
                                  {sale ? (
                                    <>
                                      <span className="line-through">
                                        {formatPrice(service.price)}
                                      </span>{" "}
                                      <span className="font-medium text-warn-600">
                                        {formatPrice(service.salePrice as number)}
                                      </span>
                                    </>
                                  ) : (
                                    formatPrice(service.price)
                                  )}
                                </span>
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* Ажилтан, огноо */}
            <section className="grid gap-3 sm:grid-cols-2">
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
                  value={dateKey}
                  onChange={(event) => setDateKey(event.target.value)}
                  className={inputClass}
                />
              </Field>
            </section>

            {/*
              Үргэлжлэх хугацаа ба давхар захиалга.

              Хоёулаа сул цагийн жагсаалтад шууд нөлөөлдөг тул цаг сонгохын
              ӨМНӨ байрлана: эхлээд «хэр удах», дараа нь «хэдэн цагт».
            */}
            <section>
              {durationOverride ? (
                <input
                  type="hidden"
                  name="durationMin"
                  value={durationOverride}
                />
              ) : null}
              {allowOverlap ? (
                <input type="hidden" name="allowOverlap" value="on" />
              ) : null}

              <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3">
                <SectionTitle>Үргэлжлэх хугацаа</SectionTitle>
                {durationOverride && totalDuration > 0 ? (
                  <span className="mb-2 text-xs text-sand-500">
                    жагсаалтаар {formatDuration(totalDuration)}
                  </span>
                ) : null}
              </div>

              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => setDurationOverride(null)}
                  aria-pressed={durationOverride === null}
                  className={presetClass(durationOverride === null)}
                >
                  Автомат
                  {totalDuration > 0 ? ` · ${formatDuration(totalDuration)}` : ""}
                </button>

                {DURATION_PRESETS.map((minutes) => (
                  <button
                    key={minutes}
                    type="button"
                    onClick={() => setDurationOverride(minutes)}
                    aria-pressed={durationOverride === minutes}
                    className={presetClass(durationOverride === minutes)}
                  >
                    {formatDuration(minutes)}
                  </button>
                ))}

                {/* Жагсаалтад байхгүй урт (жишээ нь 45м) — хадгалагдсаныг нуухгүй */}
                {durationOverride && !DURATION_PRESETS.includes(durationOverride) ? (
                  <span className={presetClass(true)}>
                    {formatDuration(durationOverride)}
                  </span>
                ) : null}
              </div>

              <label className="mt-3 flex items-start gap-2 text-sm text-sand-700">
                <input
                  type="checkbox"
                  checked={allowOverlap}
                  onChange={(event) => setAllowOverlap(event.target.checked)}
                  className="mt-0.5 size-4 shrink-0 rounded border-sand-400 text-brand-600 focus:ring-brand-500/30"
                />
                <span className="min-w-0">
                  Давхар захиалга
                  <span className="block text-xs text-sand-500">
                    Мастер зэрэг хоёр үйлчлүүлэгч хөтлөх үед — завгүй цаг дээр ч
                    бүртгэнэ. Ажлын цаг, чөлөө нь хэвээр шалгагдана.
                  </span>
                </span>
              </label>
            </section>

            {/*
              Эхлэх цаг — задгай жагсаалт биш, ТУХАЙН АЖИЛТНЫ СУЛ ЦАГУУД.
              Ээлж, чөлөө, бусад захиалгыг хассан цагууд л энд гарна: ресепшн
              завгүй цаг сонгоод алдаа идэх шаардлагагүй болно.
            */}
            <section>
              <input type="hidden" name="startTime" value={startTime} />

              <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3">
                <SectionTitle>Эхлэх цаг</SectionTitle>
                <span className="mb-2 min-w-0 truncate text-xs text-sand-500">
                  {slotStaffNames} · {formatDuration(slotDuration)}
                </span>
              </div>

              {!canWrite ? (
                <p className="text-sm tabular-nums text-sand-800">{startTime}</p>
              ) : slots === null ? (
                <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6">
                  {Array.from({ length: 12 }).map((_, index) => (
                    <div
                      key={index}
                      className="h-9 animate-pulse rounded-xl bg-sand-100"
                    />
                  ))}
                </div>
              ) : slots.length === 0 ? (
                <p className="rounded-lg bg-warn-50 px-3 py-2.5 text-sm text-warn-700 ring-1 ring-warn-200">
                  {slotReason ?? "Сул цаг үлдээгүй байна."}
                </p>
              ) : (
                <>
                  <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6">
                    {/* Сонгосон цаг завгүй болсон бол нуухгүй — анхааруулж харуулна */}
                    {startTaken ? (
                      <button
                        type="button"
                        aria-pressed="true"
                        className="rounded-xl border border-warn-400 bg-warn-50 py-2 text-sm font-medium tabular-nums text-warn-700"
                      >
                        {startTime}
                      </button>
                    ) : null}

                    {slots.map((minute) => {
                      const value = formatMinutes(minute);
                      const active = minute === startMin;
                      return (
                        <button
                          key={minute}
                          type="button"
                          onClick={() => setStartTime(value)}
                          aria-pressed={active}
                          className={`rounded-xl border py-2 text-sm tabular-nums transition active:scale-[0.98] ${
                            active
                              ? "border-brand-600 bg-brand-50 font-medium text-brand-700"
                              : "border-sand-300 text-sand-700 hover:bg-sand-50"
                          }`}
                        >
                          {value}
                        </button>
                      );
                    })}
                  </div>

                  <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-sand-500">
                    <span>
                      {startTaken
                        ? "Сонгосон цаг багтахаа больжээ — сул цагаас сонгоно уу."
                        : allowOverlap
                          ? `${slots.length} цаг · давхар захиалга тул завгүй цаг ч орсон`
                          : `${slots.length} сул цаг · ${formatDuration(slotStep)} зайтай`}
                    </span>
                    <button
                      type="button"
                      onClick={() => setFineSteps((current) => !current)}
                      className="text-brand-700 underline-offset-2 hover:underline"
                    >
                      {fineSteps
                        ? "Үйлчилгээний зайгаар"
                        : "30 минутын алхмаар"}
                    </button>
                  </p>
                </>
              )}
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

            {effectiveDuration > 0 ? (
              <p className="rounded-lg bg-sand-100/70 px-3 py-2 text-sm text-sand-600">
                Дуусах цаг:{" "}
                <strong className="tabular-nums text-sand-900">
                  {formatMinutes(startMin + effectiveDuration)}
                </strong>{" "}
                (нийт {formatDuration(effectiveDuration)}
                {involvedStaffIds.length > 1
                  ? `, ${involvedStaffIds.length} ажилтан зэрэг`
                  : ""}
                )
              </p>
            ) : null}

            {/* Нэмэлт төлбөр, хөнгөлөлт ба тооцоо */}
            {selectedServices.length > 0 ? (
              <section className="rounded-xl border border-sand-200 p-3">
                {/* ── Нэмэлт төлбөр — талбар нь шууд харагдана ── */}
                <div className="mb-3">
                  <span className="block text-sm font-medium text-sand-800">
                    Нэмэлт төлбөр
                  </span>
                  <p className="mb-2 text-xs text-sand-500">
                    Урт хумс, нэмэлт чимэглэл гэх мэт үйлчилгээний жагсаалтад
                    байхгүй төлбөрийг энд бичнэ. Хоосон орхивол тооцогдохгүй.
                  </p>

                  <div className="space-y-1.5">
                    {charges.map((charge) => (
                      <div key={charge.key} className="flex items-center gap-2">
                        <div className="relative min-w-0 flex-1 sm:max-w-[13rem]">
                          <input
                            type="number"
                            name="chargeAmount"
                            min={0}
                            step={1000}
                            inputMode="numeric"
                            value={charge.amount}
                            onChange={(event) =>
                              updateChargeRow(charge.key, event.target.value)
                            }
                            aria-label="Нэмэлт төлбөрийн дүн"
                            placeholder="0"
                            className={`${inputClass} pr-7 text-right`}
                          />
                          <span className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-sm text-sand-400">
                            ₮
                          </span>
                        </div>
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

                  <button
                    type="button"
                    onClick={addChargeRow}
                    className="mt-2 rounded-lg border border-sand-300 px-2.5 py-1 text-xs text-sand-700 transition hover:bg-sand-100"
                  >
                    + Дахин нэмэх
                  </button>
                </div>

                <dl className="mt-3 space-y-1 border-t border-sand-100 pt-3 text-sm">
                  <Row label="Үйлчилгээ" value={formatPrice(subtotal)} />
                  {extraTotal > 0 ? (
                    <Row
                      label="Нэмэлт төлбөр"
                      value={`+ ${formatPrice(extraTotal)}`}
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
                <SectionTitle>Төлбөр</SectionTitle>

                {/* Сервер рүү явах дүн — «Төлсөн» бол бүтэн дүн */}
                <input
                  type="hidden"
                  name="depositAmount"
                  value={
                    paidInFull
                      ? totalPrice
                      : Number(deposit.replace(/\D/g, "")) || 0
                  }
                />
                <input
                  type="hidden"
                  name="depositMethod"
                  value={depositMethod}
                />

                <button
                  type="button"
                  onClick={() => setPaidInFull((current) => !current)}
                  aria-pressed={paidInFull}
                  className={`flex w-full items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-semibold transition active:scale-[0.99] ${
                    paidInFull
                      ? "border-ok-600 bg-ok-500 text-white shadow-sm hover:bg-ok-600"
                      : "border-sand-300 bg-white text-sand-700 hover:border-ok-500 hover:bg-ok-50 hover:text-ok-700"
                  }`}
                >
                  <span
                    aria-hidden
                    className={`flex size-5 shrink-0 items-center justify-center rounded-full border ${
                      paidInFull
                        ? "border-white/70 bg-white/20"
                        : "border-sand-300"
                    }`}
                  >
                    {paidInFull ? (
                      <svg
                        viewBox="0 0 24 24"
                        className="size-3"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={3.5}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="m5 13 4 4L19 7" />
                      </svg>
                    ) : null}
                  </span>
                  Төлсөн · {formatPrice(totalPrice)}
                </button>

                {paidInFull ? (
                  <div className="mt-3 border-t border-sand-100 pt-3">
                    <MethodPicker
                      value={depositMethod}
                      onChange={setDepositMethod}
                    />
                    <p className="mt-1.5 text-[11px] text-sand-500">
                      Захиалга үүсэхэд бүтэн төлбөр бүртгэгдэнэ.
                    </p>
                  </div>
                ) : (
                  <div className="mt-3 space-y-2 border-t border-sand-100 pt-3">
                    <label className="mb-1 block text-xs text-sand-500">
                      Урьдчилгаа авсан бол (заавал биш)
                    </label>
                    <div className="relative sm:max-w-[13rem]">
                      <input
                        type="number"
                        min={0}
                        max={totalPrice}
                        step={1000}
                        inputMode="numeric"
                        value={deposit}
                        onChange={(event) => setDeposit(event.target.value)}
                        placeholder="0"
                        className={`${inputClass} pr-7 text-right`}
                      />
                      <span className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-sm text-sand-400">
                        ₮
                      </span>
                    </div>
                    {Number(deposit.replace(/\D/g, "")) > 0 ? (
                      <MethodPicker
                        value={depositMethod}
                        onChange={setDepositMethod}
                      />
                    ) : null}
                  </div>
                )}
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

          <footer className="sticky bottom-0 flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-sand-200 bg-white px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:pb-3">
            {cancelError ? (
              <p role="alert" className="w-full text-sm text-danger-600">
                {cancelError}
              </p>
            ) : null}

            <div className="flex min-w-0 items-center gap-3 text-sm">
              {/* Цуцлах товч — хадгалах товчноос ХОЛ, санамсаргүй дарахаас
                  сэргийлж зүүн захад тусад нь байрлана. */}
              {editing && canWrite ? (
                <button
                  type="button"
                  disabled={isCancelling}
                  onClick={() => quickStatus(cancelled ? "BOOKED" : "CANCELLED")}
                  className={`shrink-0 rounded-xl border px-4 py-2 text-sm font-medium transition disabled:opacity-50 ${
                    cancelled
                      ? "border-sand-300 text-sand-700 hover:bg-sand-100"
                      : "border-danger-200 bg-danger-50 text-danger-700 hover:brightness-95"
                  }`}
                >
                  {isCancelling
                    ? "Түр хүлээнэ үү…"
                    : cancelled
                      ? "Сэргээх"
                      : "Цуцлах"}
                </button>
              ) : null}

              {selectedServices.length > 0 ? (
                <span className="truncate font-semibold text-sand-900">
                  {formatPrice(totalPrice)}
                </span>
              ) : (
                <span className="truncate text-sand-500">
                  Үйлчилгээ сонгоно уу
                </span>
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
        )}
      </div>
    </div>
  );
}

/** Хугацааны түргэн сонголтууд — минутаар. */
const OFF_PRESETS = [30, 60, 90, 120, 180, 240];

/**
 * Сул цаг дээр шууд чөлөө тэмдэглэх самбар.
 *
 * Хуанли дээр дарсан ажилтан, огноо, цаг нь бэлдэгдэж ирнэ — админ зөвхөн
 * хэдэн цаг болохыг сонгоод хадгална. Тухайн цагт захиалга байвал сервер
 * зөвшөөрөхгүй бөгөөд аль захиалгууд нь давхцаж байгааг хэлнэ.
 */
function TimeOffPanel({
  staff,
  defaultStaffId,
  dateKey,
  defaultStartMin,
  onClose,
}: {
  staff: DayStaff[];
  defaultStaffId: string;
  dateKey: string;
  defaultStartMin: number;
  onClose: () => void;
}) {
  const [result, formAction, isPending] = useActionState<
    ActionResult | null,
    FormData
  >(addTimeOff, null);

  const [staffId, setStaffId] = useState(defaultStaffId);
  const [startMin, setStartMin] = useState(
    Math.round(defaultStartMin / SLOT_STEP) * SLOT_STEP,
  );
  /** null бол бүтэн өдөр. */
  const [duration, setDuration] = useState<number | null>(60);

  useEffect(() => {
    if (result?.ok) onClose();
  }, [result, onClose]);

  // Өдрийн төгсгөлөөс хальж болохгүй
  const endMin = duration === null ? 24 * 60 : Math.min(startMin + duration, 24 * 60);
  const member = staff.find((m) => m.id === staffId);

  return (
    <form
      action={formAction}
      className="flex min-h-0 flex-1 flex-col overflow-y-auto scrollbar-slim"
    >
      <input type="hidden" name="staffId" value={staffId} />
      <input type="hidden" name="date" value={dateKey} />
      {duration === null ? (
        <input type="hidden" name="wholeDay" value="on" />
      ) : (
        <>
          <input type="hidden" name="startTime" value={formatMinutes(startMin)} />
          <input type="hidden" name="endTime" value={formatMinutes(endMin)} />
        </>
      )}

      <div className="min-w-0 space-y-5 px-5 py-4">
        <p className="rounded-lg bg-sand-100/70 px-3 py-2 text-sm text-sand-600">
          Энэ цагийг ажилтны чөлөө болгож тэмдэглэнэ. Чөлөөтэй цагт шинэ
          захиалга орохгүй бөгөөд цагийн бүртгэлд улаанаар харагдана.
        </p>

        <section className="grid gap-3 sm:grid-cols-2">
          <Field label="Ажилтан">
            <select
              value={staffId}
              onChange={(event) => setStaffId(event.target.value)}
              className={inputClass}
            >
              {staff.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Эхлэх цаг">
            <select
              value={formatMinutes(startMin)}
              onChange={(event) => setStartMin(parseMinutes(event.target.value))}
              disabled={duration === null}
              className={inputClass}
            >
              {START_TIMES.map((minute) => (
                <option key={minute} value={formatMinutes(minute)}>
                  {formatMinutes(minute)}
                </option>
              ))}
            </select>
          </Field>
        </section>

        <section>
          <SectionTitle>Хэр удаан</SectionTitle>
          <div className="flex flex-wrap gap-1.5">
            {OFF_PRESETS.map((minutes) => (
              <button
                key={minutes}
                type="button"
                onClick={() => setDuration(minutes)}
                aria-pressed={duration === minutes}
                className={`rounded-xl border px-3.5 py-2 text-sm transition active:scale-[0.98] ${
                  duration === minutes
                    ? "border-brand-600 bg-brand-50 font-medium text-brand-700"
                    : "border-sand-300 text-sand-700 hover:bg-sand-50"
                }`}
              >
                {formatDuration(minutes)}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setDuration(null)}
              aria-pressed={duration === null}
              className={`rounded-xl border px-3.5 py-2 text-sm transition active:scale-[0.98] ${
                duration === null
                  ? "border-brand-600 bg-brand-50 font-medium text-brand-700"
                  : "border-sand-300 text-sand-700 hover:bg-sand-50"
              }`}
            >
              Бүтэн өдөр
            </button>
          </div>
        </section>

        <Field label="Шалтгаан" hint="Цагийн бүртгэл дээр хамт харагдана">
          <input
            name="reason"
            placeholder="Жишээ: Эмнэлэг, Сургалт"
            className={inputClass}
          />
        </Field>

        {result && !result.ok ? <Issues issues={result.issues} /> : null}
      </div>

      <footer className="sticky bottom-0 flex shrink-0 items-center justify-between gap-3 border-t border-sand-200 bg-white px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:pb-3">
        <div className="min-w-0 text-sm">
          <span className="block truncate font-medium text-sand-900">
            {member?.name ?? "—"}
          </span>
          <span className="block text-xs text-sand-500">
            {duration === null
              ? "Бүтэн өдөр"
              : `${formatMinutes(startMin)}–${formatMinutes(endMin)} · ${formatDuration(
                  endMin - startMin,
                )}`}
          </span>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-sand-300 px-4 py-2 text-sm text-sand-700 transition hover:bg-sand-100"
          >
            Болих
          </button>
          <button
            type="submit"
            disabled={isPending || !staffId || endMin <= startMin}
            className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-700 disabled:opacity-50"
          >
            {isPending ? "Хадгалж байна…" : "Чөлөө нэмэх"}
          </button>
        </div>
      </footer>
    </form>
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
      <dt className={accent ? "text-ok-700" : "text-sand-600"}>{label}</dt>
      <dd className={`tabular-nums ${accent ? "text-ok-700" : "text-sand-700"}`}>
        {value}
      </dd>
    </div>
  );
}


function MethodPicker({
  value,
  onChange,
  label = "Төлбөрийн хэлбэр",
}: {
  value: PaymentMethod;
  onChange: (method: PaymentMethod) => void;
  label?: string;
}) {
  return (
    <div>
      <span className="mb-1 block text-xs text-sand-500">{label}</span>
      <div
        role="radiogroup"
        aria-label={label}
        className="inline-flex items-center gap-1 rounded-full bg-sand-200/70 p-1"
      >
        {PAYMENT_METHOD_CHOICES.map((method) => {
          const active = value === method;
          return (
            <button
              key={method}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(method)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                active
                  ? "bg-white text-sand-900 shadow-sm"
                  : "text-sand-500 hover:text-sand-800"
              }`}
            >
              {PAYMENT_METHOD_LABELS[method]}
            </button>
          );
        })}
      </div>
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
  const [isSettling, startSettle] = useTransition();
  const [settleError, setSettleError] = useState<string | null>(null);

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

  /** Үлдэгдлийг нэг товчоор бүтнээр нь төлөгдсөн болгоно. */
  function settle() {
    setSettleError(null);
    startSettle(async () => {
      // Сонгосон хэлбэрээр бүртгэнэ — өдрийн эцсийн задаргаа зөв гарна
      const outcome = await settleAppointment(appointmentId, method);
      if (!outcome.ok) setSettleError(outcome.issues.join(" "));
    });
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
              <span className="shrink-0 rounded bg-sand-100 px-1.5 py-0.5 text-[11px] font-medium text-sand-600">
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
                className="shrink-0 rounded-lg p-1 text-sand-400 transition hover:bg-sand-100 hover:text-danger-600 disabled:opacity-50"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {/* ── Нэг товчоор бүтэн төлөлт ── */}
      {due > 0 ? (
        <div className="mb-3 border-t border-sand-100 pt-3">
          <div className="mb-2">
            <MethodPicker value={method} onChange={setMethod} />
          </div>
          <button
            type="button"
            onClick={settle}
            disabled={isSettling || isPending}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-ok-500 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-ok-600 active:scale-[0.99] disabled:opacity-50"
          >
            <svg
              viewBox="0 0 24 24"
              className="size-4 shrink-0"
              aria-hidden
              fill="none"
              stroke="currentColor"
              strokeWidth={2.4}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="m5 13 4 4L19 7" />
            </svg>
            {isSettling
              ? "Бүртгэж байна…"
              : `${PAYMENT_METHOD_LABELS[method]}-ээр төлсөн · ${formatPrice(due)}`}
          </button>
          <p className="mt-1.5 text-center text-[11px] text-sand-500">
            Үлдэгдлийг бүтнээр төлөгдсөнд тооцно.
          </p>
          {settleError ? (
            <p role="alert" className="mt-2 text-sm text-danger-600">
              {settleError}
            </p>
          ) : null}
        </div>
      ) : null}

      {/* ── Шинэ төлбөр ── */}
      <div className="space-y-2 border-t border-sand-100 pt-3">
        {due <= 0 ? (
          <MethodPicker value={method} onChange={setMethod} />
        ) : null}
        <div className="relative sm:max-w-[13rem]">
          <input
            type="number"
            step={1000}
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            placeholder={due > 0 ? String(due) : "0"}
            aria-label="Төлбөрийн дүн"
            className={`${inputClass} pr-7 text-right`}
          />
          <span className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-sm text-sand-400">
            ₮
          </span>
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

/** Хугацааны сонголтын товчны хэв маяг — «Хэр удаан» хэсэгтэй нэг загвар. */
function presetClass(active: boolean): string {
  return `rounded-xl border px-3 py-1.5 text-sm transition active:scale-[0.98] ${
    active
      ? "border-brand-600 bg-brand-50 font-medium text-brand-700"
      : "border-sand-300 text-sand-700 hover:bg-sand-50"
  }`;
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
            <p className="mt-1 truncate text-xs text-warn-600">⚠ {selected.note}</p>
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
              className="rounded-lg bg-danger-600 px-3 py-1.5 text-xs font-medium text-white transition hover:brightness-110 disabled:opacity-50"
            >
              {isPending ? "Хадгалж байна…" : "Баталгаажуулах"}
            </button>
          </div>
        </div>
      ) : null}

      {/* ── Цуцлалтын түүх ── */}
      {appointment.cancelledAt ? (
        <div className="mt-3 rounded-xl bg-danger-50 px-3 py-2 text-sm text-danger-700">
          <p>
            <strong>{STATUS_LABELS[appointment.status].label}</strong>
            {appointment.cancelledBy
              ? ` — ${appointment.cancelledBy.name}`
              : ""}
            <span className="text-danger-600/70">
              {" · "}
              {toDateKey(appointment.cancelledAt)}{" "}
              {formatMinutes(toLocalMinutes(appointment.cancelledAt))}
            </span>
          </p>
          {appointment.cancelReason ? (
            <p className="mt-0.5 text-[13px]">{appointment.cancelReason}</p>
          ) : null}

          {replacement ? (
            <p className="mt-1.5 border-t border-danger-200 pt-1.5 text-[13px] text-sand-600">
              Энэ цагийг <strong>{replacement.clientName}</strong> авсан (
              {formatMinutes(replacement.startMin)}–
              {formatMinutes(replacement.endMin)}, бүртгэсэн{" "}
              {toDateKey(replacement.bookedAt)}).
            </p>
          ) : (
            <p className="mt-1.5 border-t border-danger-200 pt-1.5 text-[13px] text-sand-600">
              Энэ цаг одоогоор сул байна.
            </p>
          )}
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="mt-2 text-sm text-danger-600">
          {error}
        </p>
      ) : null}

      <button
        type="button"
        onClick={remove}
        disabled={isPending}
        className="mt-3 text-sm text-danger-600 underline underline-offset-2 disabled:opacity-50"
      >
        Захиалгыг устгах
      </button>
    </section>
  );
}
