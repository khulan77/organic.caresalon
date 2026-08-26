"use client";

import { useRouter, useSearchParams } from "next/navigation";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type {
  BranchSummary,
  DayAppointment,
  DayStaff,
  PackageList,
  ServiceCatalog,
} from "@/lib/queries";
import { formatMinutes, toDateKey, toLocalMinutes } from "@/lib/time";
import { formatPrice } from "@/lib/labels";
import { PAYMENT_STATE_LABELS, summarize } from "@/lib/payments";
import { AppointmentDialog, type DialogState } from "./appointment-dialog";

/** Нэг минут хэдэн пиксел эзлэх — 1 цаг = 114px */
const PX_PER_MIN = 1.9;
/** Багана ба цагийн баганын өргөн — гар утсанд нарийсна. */
const COL = "min-w-[168px] flex-1 md:min-w-[210px]";
const GUTTER = "w-14 shrink-0 md:w-[76px]";

type Props = {
  branch: BranchSummary;
  dateKey: string;
  staff: DayStaff[];
  appointments: DayAppointment[];
  closure: {
    isClosed: boolean;
    openMin: number | null;
    closeMin: number | null;
    reason: string | null;
  } | null;
  catalog: ServiceCatalog;
  packages: PackageList;
  /** Энэ салбарт захиалга бүртгэх эрхтэй эсэх (ресепшн зөвхөн харьяа салбартаа) */
  canWrite: boolean;
};

/** Захиалгын өнгө — үйлчилгээнийх, эс бөгөөс ангиллынх. */
function colorOf(appointment: DayAppointment): string {
  const first = appointment.items[0];
  return first?.service.color ?? first?.service.category.color ?? "#a39887";
}

/** Өнгийг цайруулж дэвсгэр болгоно. */
function tint(color: string, percent: number): string {
  return `color-mix(in srgb, ${color} ${percent}%, white)`;
}

/**
 * Тухайн өдөр огт ажиллахгүй эсэх — долоо хоногийн хуваарь нь амралттай,
 * эсвэл ээлжийг бүтэн хамарсан чөлөө авсан.
 */
function isRestingAllDay(member: DayStaff): boolean {
  const shift = member.schedules[0];
  if (!shift || shift.isDayOff) return true;
  return member.timeOffs.some(
    (off) =>
      (off.startMin ?? 0) <= shift.startMin &&
      (off.endMin ?? 24 * 60) >= shift.endMin,
  );
}

/** "Сарнай" → "СА" */
function initialsOf(name: string): string {
  const cleaned = name.replace(/[^\p{L}\s]/gu, "").trim();
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    return (words[0][0] + words[1][0]).toUpperCase();
  }
  return cleaned.slice(0, 2).toUpperCase();
}

export function DayGrid({
  branch,
  dateKey,
  staff,
  appointments,
  closure,
  catalog,
  packages,
  canWrite,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Тухайн өдрийн ажлын цаг — онцгой тохиргоо байвал түүнийг барина
  const openMin = closure?.openMin ?? branch.openMin;
  const closeMin = closure?.closeMin ?? branch.closeMin;

  // Ажлын цагаас гадуур захиалга байвал хуанлийг сунгана — нуугдахаас сэргийлнэ
  const { rangeStart, rangeEnd } = useMemo(() => {
    let start = openMin;
    let end = closeMin;
    for (const appt of appointments) {
      start = Math.min(start, toLocalMinutes(appt.startAt));
      const apptEnd = toLocalMinutes(appt.endAt);
      end = Math.max(end, apptEnd === 0 ? 24 * 60 : apptEnd);
    }
    return {
      rangeStart: Math.floor(start / 60) * 60,
      rangeEnd: Math.ceil(end / 60) * 60,
    };
  }, [appointments, openMin, closeMin]);

  const gridHeight = (rangeEnd - rangeStart) * PX_PER_MIN;

  const hourMarks = useMemo(() => {
    const marks: number[] = [];
    for (let m = rangeStart; m <= rangeEnd; m += 60) marks.push(m);
    return marks;
  }, [rangeStart, rangeEnd]);

  /**
   * Амарч байгаа ажилтныг хуанлиас нуулаа — өдрийн ажиллах баганууд л үлдэнэ.
   * Захиалгатай бол хэвээр харуулна, эс тэгвэл тэр захиалга харагдахгүй үлдэнэ
   * (хуваарь нь хожим өөрчлөгдсөн тохиолдол).
   */
  const visibleStaff = useMemo(() => {
    const hasAppointments = new Set(appointments.map((a) => a.staffId));
    return staff.filter(
      (member) => hasAppointments.has(member.id) || !isRestingAllDay(member),
    );
  }, [staff, appointments]);

  const byStaff = useMemo(() => {
    const map = new Map<string, DayAppointment[]>();
    for (const member of visibleStaff) map.set(member.id, []);
    for (const appt of appointments) map.get(appt.staffId)?.push(appt);
    return map;
  }, [visibleStaff, appointments]);

  // Ажлын цаг руу автоматаар гүйлгэнэ
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = Math.max(0, (openMin - rangeStart) * PX_PER_MIN - 8);
  }, [openMin, rangeStart, dateKey]);

  // Толгойн «Захиалга нэмэх» товч `?new=1`-ээр цонх нээнэ
  const wantsNew = searchParams.get("new") === "1";

  function clearNewParam() {
    if (!wantsNew) return;
    const params = new URLSearchParams(searchParams.toString());
    params.delete("new");
    router.replace(`/calendar?${params.toString()}`, { scroll: false });
  }

  const defaultCreate = useMemo<DialogState | null>(() => {
    if (!canWrite) return null;
    const working = visibleStaff.find((m) => !isRestingAllDay(m));
    if (!working) return null;
    return {
      mode: "create",
      branchId: branch.id,
      dateKey,
      staffId: working.id,
      startMin: Math.max(openMin, working.schedules[0].startMin),
    };
  }, [visibleStaff, branch.id, dateKey, openMin, canWrite]);

  /**
   * Төлөвт бичихгүйгээр URL-аас гаргаж авна.
   *
   * Засварлах горимд захиалгыг сангаас ирсэн ШИНЭ хувилбараар солино: төлбөр
   * бүртгэсний дараа `refresh()` шинэ өгөгдөл авчирдаг ч `dialog` төлөвт
   * хуучин хуулбар үлддэг тул цонх шинэчлэгдэхгүй байсан.
   */
  const activeDialog = useMemo<DialogState | null>(() => {
    const base = dialog ?? (wantsNew ? defaultCreate : null);
    if (base?.mode !== "edit") return base;

    const fresh =
      appointments.find((a) => a.id === base.appointment.id) ?? base.appointment;

    // Хамтарсан захиалга — ҮРГЭЛЖ үндсэн мөрийг нээнэ (нэхэмжлэх нэг),
    // бүлгийн бусад мөрийг хамт өгнө.
    const siblings = fresh.groupId
      ? appointments.filter((a) => a.groupId === fresh.groupId)
      : [fresh];
    const primary = siblings.find((a) => a.isPrimary) ?? fresh;

    /**
     * Цуцлагдсан захиалгын цагийг дараа нь өөр хүн авсан эсэх.
     * Ижил ажилтны, давхцаж буй, идэвхтэй захиалгыг хайна — ресепшн «энэ цаг
     * сул болсон уу» гэдэгт хариулж чадна.
     */
    const cancelled =
      primary.status === "CANCELLED" || primary.status === "NO_SHOW";
    const replacement = cancelled
      ? appointments.find(
          (other) =>
            other.id !== primary.id &&
            other.staffId === primary.staffId &&
            other.status !== "CANCELLED" &&
            other.status !== "NO_SHOW" &&
            other.startAt < primary.endAt &&
            other.endAt > primary.startAt,
        )
      : undefined;

    return {
      ...base,
      appointment: primary,
      siblings,
      replacement: replacement
        ? {
            clientName: replacement.client.name,
            startMin: toLocalMinutes(replacement.startAt),
            endMin: toLocalMinutes(replacement.endAt),
            bookedAt: replacement.createdAt,
          }
        : null,
    };
  }, [dialog, wantsNew, defaultCreate, appointments]);

  function closeDialog() {
    setDialog(null);
    clearNewParam();
  }

  if (visibleStaff.length === 0) {
    const noStaffAtAll = staff.length === 0;
    return (
      <div className="grid flex-1 place-items-center p-8 text-center">
        <div>
          <p className="font-medium text-sand-800">
            {noStaffAtAll
              ? "Энэ салбарт ажилтан бүртгэгдээгүй байна."
              : "Энэ өдөр ажиллах ажилтан алга."}
          </p>
          <p className="mt-1 text-sm text-sand-500">
            {noStaffAtAll
              ? "Ажилтан хэсгээс ажилтан нэмнэ үү."
              : "Бүх ажилтан амралттай эсвэл чөлөөтэй байна."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
      {closure?.isClosed ? (
        <div className="no-print border-b border-amber-200 bg-amber-50 px-6 py-2 text-sm text-amber-900">
          Тухайн өдөр салбар хаалттай
          {closure.reason ? ` — ${closure.reason}` : ""}.
        </div>
      ) : null}

      <div
        className="min-h-0 flex-1 overflow-auto scrollbar-slim bg-white"
        ref={scrollRef}
      >
        <div className="relative w-max min-w-full">
          {/* ── Ажилтны толгой ── */}
          <div className="sticky top-0 z-20 flex border-b border-sand-200 bg-white">
            <div className={GUTTER} />
            {visibleStaff.map((member) => {
              const schedule = member.schedules[0];
              const dayOff = !schedule || schedule.isDayOff;
              const count =
                byStaff
                  .get(member.id)
                  ?.filter(
                    (a) => a.status !== "CANCELLED" && a.status !== "NO_SHOW",
                  ).length ?? 0;
              return (
                <div
                  key={member.id}
                  className={`${COL} border-l border-sand-200 px-3 py-4 text-center md:py-5`}
                >
                  <span
                    aria-hidden
                    className="mx-auto flex size-11 items-center justify-center rounded-full text-sm font-medium tracking-wide text-white"
                    style={{ backgroundColor: member.color }}
                  >
                    {initialsOf(member.name)}
                  </span>
                  <p className="mt-2.5 truncate text-[15px] font-medium text-sand-900">
                    {member.name}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-sand-500">
                    {dayOff ? "Амралттай" : `${count} захиалга`}
                  </p>
                </div>
              );
            })}
          </div>

          {/* ── Хуанлийн их бие ── */}
          {/* Дээд талын зай — эхний цагийн шошго таслагдахаас сэргийлнэ */}
          <div className="flex pt-2.5">
            <div
              className={`relative ${GUTTER}`}
              style={{ height: gridHeight }}
            >
              {hourMarks.map((minute) => (
                <div
                  key={minute}
                  className="absolute right-2 -translate-y-1/2 font-mono text-[11px] text-sand-400 md:right-4 md:text-xs"
                  style={{ top: (minute - rangeStart) * PX_PER_MIN }}
                >
                  {formatMinutes(minute)}
                </div>
              ))}
            </div>

            {visibleStaff.map((member) => (
              <StaffColumn
                key={member.id}
                member={member}
                appointments={byStaff.get(member.id) ?? []}
                rangeStart={rangeStart}
                rangeEnd={rangeEnd}
                gridHeight={gridHeight}
                slotMin={branch.slotMin}
                hourMarks={hourMarks}
                canWrite={canWrite}
                onCreate={(startMin) => {
                  clearNewParam();
                  setDialog({
                    mode: "create",
                    branchId: branch.id,
                    dateKey,
                    staffId: member.id,
                    startMin,
                  });
                }}
                onOpen={(appointment) => {
                  clearNewParam();
                  // Бүлгийг activeDialog дотор эцэслэн олно — энд зөвхөн
                  // дарсан мөрийг тэмдэглэхэд хангалттай.
                  setDialog({
                    mode: "edit",
                    branchId: branch.id,
                    dateKey,
                    appointment,
                    siblings: [appointment],
                    replacement: null,
                  });
                }}
              />
            ))}
          </div>

          <CurrentTimeLine
            dateKey={dateKey}
            rangeStart={rangeStart}
            rangeEnd={rangeEnd}
          />
        </div>
      </div>

      {activeDialog ? (
        <AppointmentDialog
          key={
            activeDialog.mode === "edit"
              ? activeDialog.appointment.id
              : `${activeDialog.staffId}-${activeDialog.startMin}`
          }
          state={activeDialog}
          staff={visibleStaff}
          catalog={catalog}
          packages={packages}
          canWrite={canWrite}
          onClose={closeDialog}
        />
      ) : null}
    </>
  );
}

function StaffColumn({
  member,
  appointments,
  rangeStart,
  rangeEnd,
  gridHeight,
  slotMin,
  hourMarks,
  canWrite,
  onCreate,
  onOpen,
}: {
  member: DayStaff;
  appointments: DayAppointment[];
  rangeStart: number;
  rangeEnd: number;
  gridHeight: number;
  slotMin: number;
  hourMarks: number[];
  canWrite: boolean;
  onCreate: (startMin: number) => void;
  onOpen: (appointment: DayAppointment) => void;
}) {
  const schedule = member.schedules[0];
  const dayOff = !schedule || schedule.isDayOff;
  // Амралттай ч захиалгатай тул харагдаж буй багана — шинэ цаг оруулахыг хаана
  const locked = dayOff || !canWrite;
  const laidOut = useMemo(() => layoutAppointments(appointments), [appointments]);

  function handleClick(event: React.MouseEvent<HTMLDivElement>) {
    if (locked) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const raw = rangeStart + (event.clientY - rect.top) / PX_PER_MIN;
    const snapped = Math.floor(raw / slotMin) * slotMin;
    onCreate(Math.max(rangeStart, Math.min(snapped, rangeEnd - slotMin)));
  }

  return (
    <div
      className={`relative ${COL} border-l border-sand-200`}
      style={{ height: gridHeight }}
    >
      {hourMarks.map((minute) => (
        <div
          key={minute}
          className="pointer-events-none absolute inset-x-0 border-t border-sand-200/70"
          style={{ top: (minute - rangeStart) * PX_PER_MIN }}
        />
      ))}

      {dayOff ? (
        <div className="day-off-shade pointer-events-none absolute inset-0" />
      ) : (
        <>
          <Shade from={rangeStart} to={schedule.startMin} rangeStart={rangeStart} />
          <Shade from={schedule.endMin} to={rangeEnd} rangeStart={rangeStart} />
        </>
      )}

      {member.timeOffs.map((off, index) => (
        <div
          key={index}
          className="day-off-shade pointer-events-none absolute inset-x-0 flex items-start justify-center px-1 pt-1 text-[11px] text-sand-500"
          style={{
            top: ((off.startMin ?? 0) - rangeStart) * PX_PER_MIN,
            height: ((off.endMin ?? 24 * 60) - (off.startMin ?? 0)) * PX_PER_MIN,
          }}
        >
          <span className="truncate">{off.reason ?? "Чөлөө"}</span>
        </div>
      ))}

      <div
        role="button"
        tabIndex={locked ? -1 : 0}
        aria-label={`${member.name} — шинэ цаг захиалах`}
        onClick={handleClick}
        className={`absolute inset-0 ${locked ? "cursor-not-allowed" : "cursor-copy"}`}
      />

      {laidOut.map(({ appointment, column, columns }) => (
        <AppointmentBlock
          key={appointment.id}
          appointment={appointment}
          rangeStart={rangeStart}
          column={column}
          columns={columns}
          onOpen={onOpen}
        />
      ))}
    </div>
  );
}

function Shade({
  from,
  to,
  rangeStart,
}: {
  from: number;
  to: number;
  rangeStart: number;
}) {
  if (to <= from) return null;
  return (
    <div
      className="pointer-events-none absolute inset-x-0 bg-sand-100"
      style={{
        top: (from - rangeStart) * PX_PER_MIN,
        height: (to - from) * PX_PER_MIN,
      }}
    />
  );
}

function AppointmentBlock({
  appointment,
  rangeStart,
  column,
  columns,
  onOpen,
}: {
  appointment: DayAppointment;
  rangeStart: number;
  column: number;
  columns: number;
  onOpen: (appointment: DayAppointment) => void;
}) {
  const startMin = toLocalMinutes(appointment.startAt);
  const endLocal = toLocalMinutes(appointment.endAt);
  const endMin = endLocal <= startMin ? 24 * 60 : endLocal;
  const duration = endMin - startMin;

  const color = colorOf(appointment);
  const cancelled = appointment.status === "CANCELLED";
  const noShow = appointment.status === "NO_SHOW";
  const width = 100 / columns;
  const compact = duration < 40;

  // Хамтарсан захиалга — нэг үйлчлүүлэгч хоёр ажилтанд зэрэг үйлчлүүлж байна
  const grouped = Boolean(appointment.groupId);

  // Төлбөрийн байдал — блок дээр нэг харцаар харагдана.
  // Бүлгийн хувьд төлбөр үндсэн мөрөнд наалддаг тул зөвхөн тэнд харуулна.
  const money = summarize({
    totalPrice: appointment.totalPrice,
    payments: appointment.payments,
  });
  const moneyMark =
    grouped && !appointment.isPrimary
      ? null
      : money.state === "PAID" || money.state === "OVERPAID"
        ? { text: "₮", title: "Төлбөр бүрэн төлөгдсөн" }
        : money.state === "PARTIAL"
          ? {
              text: "½",
              title: `Дутуу төлсөн — үлдэгдэл ${formatPrice(money.balance)}`,
            }
          : null;

  return (
    <button
      type="button"
      onClick={() => onOpen(appointment)}
      title={`${appointment.client.name} · ${formatMinutes(startMin)}–${formatMinutes(endMin)} · ${appointment.items.map((i) => i.name).join(", ")}${grouped ? " · хамтарсан захиалга" : ""}${moneyMark ? ` · ${moneyMark.title}` : ""}`}
      className={`absolute overflow-hidden rounded-lg pl-3.5 pr-2.5 text-left transition hover:z-10 hover:shadow-md focus:z-10 focus:outline-none focus:ring-2 focus:ring-brand-500/40 ${
        compact ? "py-1" : "py-2"
      } ${noShow ? "hatched" : ""}`}
      style={{
        top: (startMin - rangeStart) * PX_PER_MIN + 2,
        height: Math.max(duration * PX_PER_MIN - 4, 22),
        left: `calc(${column * width}% + 4px)`,
        width: `calc(${width}% - 8px)`,
        backgroundColor: tint(color, cancelled ? 5 : 10),
        opacity: cancelled ? 0.65 : 1,
      }}
    >
      {/* Зүүн талын өнгөт зурвас */}
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 w-[4px]"
        style={{ backgroundColor: color, opacity: cancelled ? 0.5 : 1 }}
      />

      {/* Хамтарсан захиалгын тасархай хүрээ — багануудыг нүдээр холбоно */}
      {grouped ? (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-lg border border-dashed"
          style={{ borderColor: color }}
        />
      ) : null}

      {moneyMark ? (
        <span
          title={moneyMark.title}
          className="absolute right-1.5 top-1.5 flex size-4 items-center justify-center rounded-full text-[10px] font-bold leading-none"
          style={{
            backgroundColor: PAYMENT_STATE_LABELS[money.state].bg,
            color: PAYMENT_STATE_LABELS[money.state].color,
          }}
        >
          {moneyMark.text}
        </span>
      ) : null}

      <p className="truncate font-mono text-[11px]" style={{ color }}>
        {formatMinutes(startMin)} – {formatMinutes(endMin)}
      </p>
      <p
        className={`truncate text-sm font-semibold text-sand-900 ${
          cancelled ? "line-through" : ""
        }`}
      >
        {grouped ? (
          <span
            aria-hidden
            title="Хамтарсан захиалга — өөр ажилтан зэрэг үйлчилж байна"
            className="mr-1 text-sand-500"
          >
            ⇄
          </span>
        ) : null}
        {appointment.client.name}
      </p>
      {!compact ? (
        <p className="truncate text-[13px]" style={{ color }}>
          {appointment.items.map((item) => item.name).join(", ")}
        </p>
      ) : null}
    </button>
  );
}

/**
 * Цагийг гадаад эх сурвалж болгон захиалж авна.
 * Минут солигдох бүрд л шинэ утга буцаана — эс бөгөөс React төгсгөлгүй давтана.
 */
let cachedMinuteKey = "";
let cachedNow: Date | null = null;

function subscribeToClock(onChange: () => void) {
  const timer = setInterval(onChange, 30_000);
  return () => clearInterval(timer);
}

function getClockSnapshot(): Date | null {
  const now = new Date();
  const key = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${now.getHours()}-${now.getMinutes()}`;
  if (key !== cachedMinuteKey) {
    cachedMinuteKey = key;
    cachedNow = now;
  }
  return cachedNow;
}

/** Сервер дээр цаг байхгүй — hydration зөрөхөөс сэргийлнэ. */
function getServerClockSnapshot(): Date | null {
  return null;
}

/** Одоогийн цагийн шугам — зөвхөн өнөөдрийн харагдацад. */
function CurrentTimeLine({
  dateKey,
  rangeStart,
  rangeEnd,
}: {
  dateKey: string;
  rangeStart: number;
  rangeEnd: number;
}) {
  const now = useSyncExternalStore(
    subscribeToClock,
    getClockSnapshot,
    getServerClockSnapshot,
  );

  if (!now || toDateKey(now) !== dateKey) return null;

  const minutes = toLocalMinutes(now);
  if (minutes < rangeStart || minutes > rangeEnd) return null;

  return (
    <div
      className="pointer-events-none absolute inset-x-0 z-10 flex items-center pl-[51px] md:pl-[71px]"
      style={{ top: (minutes - rangeStart) * PX_PER_MIN }}
    >
      <span className="size-[9px] shrink-0 rounded-full bg-rose-400" />
      <span className="h-px flex-1 bg-rose-400" />
    </div>
  );
}

/**
 * Давхцсан захиалгуудыг зэрэгцээ багана болгож байрлуулна.
 * Идэвхтэй захиалга давхцахгүй ч цуцалсан захиалга давхцаж болно.
 */
function layoutAppointments(appointments: DayAppointment[]) {
  const sorted = [...appointments].sort(
    (a, b) => a.startAt.getTime() - b.startAt.getTime(),
  );

  const result: {
    appointment: DayAppointment;
    column: number;
    columns: number;
  }[] = [];

  let cluster: DayAppointment[] = [];
  let clusterEnd = 0;

  function flush() {
    if (cluster.length === 0) return;
    const columnEnds: number[] = [];
    const placed = cluster.map((appt) => {
      const start = appt.startAt.getTime();
      let column = columnEnds.findIndex((end) => end <= start);
      if (column === -1) {
        column = columnEnds.length;
        columnEnds.push(0);
      }
      columnEnds[column] = appt.endAt.getTime();
      return { appointment: appt, column };
    });
    for (const item of placed) {
      result.push({ ...item, columns: columnEnds.length });
    }
    cluster = [];
  }

  for (const appt of sorted) {
    if (cluster.length > 0 && appt.startAt.getTime() >= clusterEnd) {
      flush();
      clusterEnd = 0;
    }
    cluster.push(appt);
    clusterEnd = Math.max(clusterEnd, appt.endAt.getTime());
  }
  flush();

  return result;
}
