"use client";

import { useRouter, useSearchParams } from "next/navigation";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
} from "react";
import type {
  BranchSummary,
  DayAppointment,
  DayStaff,
  ServiceCatalog,
} from "@/lib/queries";
import { formatMinutes, toDateKey, toLocalMinutes } from "@/lib/time";
import { formatPrice } from "@/lib/labels";
import { buildBookingText } from "@/lib/booking-text";
import { CopyButton } from "@/components/ui/copy-button";
import { PAYMENT_STATE_LABELS, summarize } from "@/lib/payments";
import {
  moveAppointment,
  setAppointmentStatus,
} from "@/app/(app)/calendar/actions";
import { AppointmentDialog, type DialogState } from "./appointment-dialog";

/**
 * Нэг минут хэдэн пиксел эзлэх.
 *
 * Гар утсанд тогтмол нягт — хуруунд ономтой байх нь чухал, доош гүйлгэнэ.
 * Компьютер дээр өдрийг ДЭЛГЭЦЭНД БАГТААНА: боломжит өндрийг өдрийн урттаа
 * хувааж масштабыг өөрөө олно. Хэт нягтарвал уншигдахаа болих тул доод
 * хязгаартай — тэр үед л гүйлгэнэ.
 */
const PX_PER_MIN_PHONE = 1.1; // 1 цаг = 66px
const PX_PER_MIN_WIDE = 1.6; // хэмжилт ирэхээс өмнөх түр утга
const PX_PER_MIN_MIN = 0.55; // 1 цаг = 33px — үүнээс нягт болгохгүй
const PX_PER_MIN_MAX = 1.9; // том дэлгэцэнд ч хэт сунгахгүй
/** Хуанлийн их бие дээрх зай (`pt-2.5`) ба доод захын амьсгал. */
const GRID_PADDING = 14;

const WIDE_QUERY = "(min-width: 768px)";

function subscribeToWidth(onChange: () => void) {
  const media = window.matchMedia(WIDE_QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

function getWideSnapshot(): boolean {
  return window.matchMedia(WIDE_QUERY).matches;
}

/** Сервер дээр дэлгэцийн өргөн мэдэгдэхгүй — өргөн гэж үзнэ. */
function getServerWideSnapshot(): boolean {
  return true;
}
/** Хуанлийн шугам ба цаг сонголтын алхам — 30 минут. */
export const SLOT_STEP = 30;
/**
 * Багана ба цагийн баганын өргөн.
 *
 * Баганууд дэлгэцэндээ ҮРГЭЛЖ багтана — утас, таблет, компьютер хамаагүй
 * хуанли хойшоо гүйхгүй. Ажилтан олон бол багана нарийсах тул мастер сонгох
 * эгнээ өөрөө гарч ирнэ (`MIN_READABLE_COL`).
 */
const COL = "min-w-0 flex-1";
const GUTTER = "w-9 shrink-0 md:w-[76px]";
/** `GUTTER`-ийн бодит өргөн — баганын өргөнийг тооцоолоход хэрэгтэй. */
const GUTTER_PX_PHONE = 36;
const GUTTER_PX_WIDE = 76;
/** Багана үүнээс нарийсвал нэр, цаг нь уншигдахаа больдог. */
const MIN_READABLE_COL = 140;

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
  /** Энэ салбарт захиалга бүртгэх эрхтэй эсэх (ресепшн зөвхөн харьяа салбартаа) */
  canWrite: boolean;
  /** Админ бол сул цаг дээр шууд чөлөө нэмж чадна */
  isAdmin: boolean;
};

/**
 * Хулганаар чирч буй захиалга.
 *
 * Барьсан цэгийг (`grabMin`) хадгалдаг тул блок хулганы дор байрлалаа алдалгүй
 * хөдөлнө: хажуу тийш шулуун чирвэл цаг нь хэвээрээ, зөвхөн ажилтан солигдоно.
 */
type DragState = {
  appointment: DayAppointment;
  /** Блокийн эхлэлээс хулгана хэдэн минутын гүнд байсан */
  grabMin: number;
  durationMin: number;
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

/** Утасны мастер сонгох чипний хэв маяг. */
function chipClass(active: boolean): string {
  return `flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition ${
    active
      ? "border-sand-900 bg-sand-900 text-white"
      : "border-sand-300 text-sand-700"
  }`;
}

export function DayGrid({
  branch,
  dateKey,
  staff,
  appointments,
  closure,
  catalog,
  canWrite,
  isAdmin,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);

  const isWide = useSyncExternalStore(
    subscribeToWidth,
    getWideSnapshot,
    getServerWideSnapshot,
  );

  /**
   * Хуанлийн харагдах хэсгийн хэмжээ.
   * `height` — ажилтны толгойг хассан цэвэр өндөр (масштаб тооцоход),
   * `width` — багана хэр нарийсахыг мэдэхэд.
   */
  const [box, setBox] = useState<{ height: number; width: number } | null>(
    null,
  );

  useEffect(() => {
    const node = scrollRef.current;
    const head = headRef.current;
    if (!node || !head) return;

    // Ажиглалт эхлэхэд эхний хэмжилт өөрөө ирнэ — гараар дуудах шаардлагагүй
    const observer = new ResizeObserver(() => {
      setBox({
        height: node.clientHeight - head.offsetHeight - GRID_PADDING,
        width: node.clientWidth,
      });
    });
    observer.observe(node);
    observer.observe(head);
    return () => observer.disconnect();
  }, []);

  // ── Чирж зөөх ──
  const [drag, setDrag] = useState<DragState | null>(null);
  /** Одоо хулгана аль баганын аль цагийн дээр байгаа — урьдчилсан харагдац */
  const [dropAt, setDropAt] = useState<{
    staffId: string;
    startMin: number;
  } | null>(null);
  const [isBusy, startAction] = useTransition();

  /**
   * Хуанлийн дээд талын мэдэгдэл — алдаа, эсвэл цуцлалтыг буцаах санал.
   *
   * Аль өдрийнх болохыг хамт хадгална: өөр өдөр рүү шилжихэд өмнөх өдрийн
   * мэдэгдэл өөрөө хамаагүй болж алга болно.
   */
  const [notice, setNotice] = useState<
    | { kind: "issues"; dateKey: string; title: string; issues: string[] }
    | {
        kind: "undo";
        dateKey: string;
        id: string;
        clientName: string;
        status: DayAppointment["status"];
      }
    | null
  >(null);
  const activeNotice = notice?.dateKey === dateKey ? notice : null;

  /** Цуцлагдсан захиалгыг хуанлиас нууна — тэр цаг сул мэт харагдана. */
  const [showCancelled, setShowCancelled] = useState(false);

  function showIssues(title: string, issues: string[]) {
    setNotice({ kind: "issues", dateKey, title, issues });
  }

  // Тухайн өдрийн ажлын цаг — онцгой тохиргоо байвал түүнийг барина
  const openMin = closure?.openMin ?? branch.openMin;
  const closeMin = closure?.closeMin ?? branch.closeMin;

  /**
   * Ажилтан тус бүрийн ӨДРИЙН ОРЛОГО ба өдрийн нийт дүн.
   *
   * Цуцлагдсан ба ирээгүй захиалга ОРОХГҮЙ — бодитоор үйлчилсэн дүн л тоологдоно.
   * Хамтарсан захиалгын мөр бүр өөрийн ажилтанд ногдсон дүнтэй тул нийлбэр нь
   * ажилтны орлогыг зөв харуулна. Төлбөр нь үндсэн мөрөнд наалддаг тул
   * давхардаж тоологдохгүй.
   */
  const money = useMemo(() => {
    const perStaff = new Map<string, { count: number; amount: number }>();
    let total = 0;
    let paid = 0;
    for (const appt of appointments) {
      if (appt.status === "CANCELLED" || appt.status === "NO_SHOW") continue;
      const row = perStaff.get(appt.staffId) ?? { count: 0, amount: 0 };
      row.count += 1;
      row.amount += appt.totalPrice;
      perStaff.set(appt.staffId, row);
      total += appt.totalPrice;
      for (const payment of appt.payments) paid += payment.amount;
    }
    return { perStaff, total, paid };
  }, [appointments]);

  /** Доод мөрний ажилтан тус бүрийн задаргаа нээлттэй эсэх. */
  const [breakdown, setBreakdown] = useState(false);

  const cancelledCount = useMemo(
    () => appointments.filter((a) => a.status === "CANCELLED").length,
    [appointments],
  );

  /**
   * Хуанли дээр ЗУРАГДАХ захиалгууд.
   *
   * Цуцлагдсаныг нууна — ресепшн тэр цагийг шууд сул гэж харна. «Ирээгүй»
   * захиалга үлдэнэ: цаг нь бодитоор зарцуулагдсан, түүх нь харагдах ёстой.
   */
  const shownAppointments = useMemo(
    () =>
      showCancelled
        ? appointments
        : appointments.filter((a) => a.status !== "CANCELLED"),
    [appointments, showCancelled],
  );

  // Ажлын цагаас гадуур захиалга байвал хуанлийг сунгана — нуугдахаас сэргийлнэ
  const { rangeStart, rangeEnd } = useMemo(() => {
    let start = openMin;
    let end = closeMin;
    for (const appt of shownAppointments) {
      start = Math.min(start, toLocalMinutes(appt.startAt));
      const apptEnd = toLocalMinutes(appt.endAt);
      end = Math.max(end, apptEnd === 0 ? 24 * 60 : apptEnd);
    }
    return {
      rangeStart: Math.floor(start / 60) * 60,
      rangeEnd: Math.ceil(end / 60) * 60,
    };
  }, [shownAppointments, openMin, closeMin]);

  /**
   * Босоо масштаб. Компьютер дээр өдрийг үлдсэн өндөрт багтаана; хэмжилт
   * ирээгүй эсвэл хэт нягтарч байвал уншигдах хэмжээндээ зогсоно.
   */
  const pxPerMin = useMemo(() => {
    if (!isWide) return PX_PER_MIN_PHONE;
    if (!box || rangeEnd <= rangeStart) return PX_PER_MIN_WIDE;
    const fit = box.height / (rangeEnd - rangeStart);
    return Math.min(Math.max(fit, PX_PER_MIN_MIN), PX_PER_MIN_MAX);
  }, [isWide, box, rangeStart, rangeEnd]);

  const gridHeight = (rangeEnd - rangeStart) * pxPerMin;

  /**
   * Цагийн шугам 30 минут тутам. Бүтэн цаг нь тод, хагас цаг нь бүдэг —
   * ресепшн 30 минутын нүд рүү нүдээр шууд ононо.
   */
  const timeMarks = useMemo(() => {
    const marks: number[] = [];
    for (let m = rangeStart; m <= rangeEnd; m += SLOT_STEP) marks.push(m);
    return marks;
  }, [rangeStart, rangeEnd]);

  /**
   * Амарч байгаа ажилтныг хуанлиас нуулаа — өдрийн ажиллах баганууд л үлдэнэ.
   * Захиалгатай бол хэвээр харуулна, эс тэгвэл тэр захиалга харагдахгүй үлдэнэ
   * (хуваарь нь хожим өөрчлөгдсөн тохиолдол).
   */
  const visibleStaff = useMemo(() => {
    const hasAppointments = new Set(shownAppointments.map((a) => a.staffId));
    return staff.filter(
      (member) => hasAppointments.has(member.id) || !isRestingAllDay(member),
    );
  }, [staff, shownAppointments]);

  const byStaff = useMemo(() => {
    const map = new Map<string, DayAppointment[]>();
    for (const member of visibleStaff) map.set(member.id, []);
    for (const appt of shownAppointments) map.get(appt.staffId)?.push(appt);
    return map;
  }, [visibleStaff, shownAppointments]);

  /**
   * Багана хэр нарийсаж байна вэ — утас, таблет, жижиг цонх бүгдэд адилхан
   * дүрэм: нэг баганад 140px-ээс бага ногдвол «шахуу» гэж үзнэ.
   */
  const columnWidth =
    box && visibleStaff.length > 0
      ? (box.width - (isWide ? GUTTER_PX_WIDE : GUTTER_PX_PHONE)) /
        visibleStaff.length
      : null;
  const crowded =
    visibleStaff.length > 1 &&
    columnWidth !== null &&
    columnWidth < MIN_READABLE_COL;

  /**
   * Шахуу үед НЭГ мастерын багана руу төвлөрөх.
   *
   * Дэлгэц/цонх томрож баганууд тухтай багтмагц сонголт өөрөө хүчингүй болно —
   * нуугдсан багана «гацаж» үлдэхгүй.
   */
  const [focusStaffId, setFocusStaffId] = useState<string | null>(null);
  const focus =
    crowded && visibleStaff.some((member) => member.id === focusStaffId)
      ? focusStaffId
      : null;

  function hiddenColumn(staffId: string): string {
    return focus && focus !== staffId ? "hidden" : "";
  }

  // Ажлын цаг руу автоматаар гүйлгэнэ
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = Math.max(0, (openMin - rangeStart) * pxPerMin - 8);
  }, [openMin, rangeStart, dateKey, pxPerMin]);

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

  // ─────────────────────── Чирж зөөх ───────────────────────

  function beginDrag(appointment: DayAppointment, grabMin: number) {
    const startMin = toLocalMinutes(appointment.startAt);
    const endLocal = toLocalMinutes(appointment.endAt);
    const endMin = endLocal <= startMin ? 24 * 60 : endLocal;
    setNotice(null);
    setDrag({ appointment, grabMin, durationMin: endMin - startMin });
  }

  function endDrag() {
    setDrag(null);
    setDropAt(null);
  }

  /**
   * Хулганы байрлалаас захиалгын ШИНЭ эхлэх цагийг бодно.
   * Барьсан цэгийг хасаад 30 минутын нүд рүү бөөрөнхийлж, хуанлийн мужид барина.
   */
  function snapStart(pointerMin: number, state: DragState): number {
    const snapped =
      Math.round((pointerMin - state.grabMin) / SLOT_STEP) * SLOT_STEP;
    return Math.max(
      rangeStart,
      Math.min(snapped, rangeEnd - state.durationMin),
    );
  }

  function hoverColumn(staffId: string, pointerMin: number) {
    if (!drag) return;
    const startMin = snapStart(pointerMin, drag);
    // `dragover` пиксел тутамд дуудагддаг — нүд солигдоогүй бол дахин зурахгүй
    setDropAt((prev) =>
      prev && prev.staffId === staffId && prev.startMin === startMin
        ? prev
        : { staffId, startMin },
    );
  }

  function dropInColumn(staffId: string, pointerMin: number) {
    const state = drag;
    endDrag();
    if (!state) return;

    const startMin = snapStart(pointerMin, state);
    // Байрандаа буцаж унасан бол сервер зовоохгүй
    if (
      staffId === state.appointment.staffId &&
      startMin === toLocalMinutes(state.appointment.startAt)
    ) {
      return;
    }

    startAction(async () => {
      const result = await moveAppointment({
        appointmentId: state.appointment.id,
        staffId,
        dateKey,
        startMin,
      });
      if (!result.ok) showIssues("Зөөх боломжгүй.", result.issues);
    });
  }

  // ───────────────────── Нэг товчоор цуцлах ─────────────────────

  /**
   * Хуанлинаас шууд цуцална — шалтгаан асуухгүй.
   *
   * Ресепшн утсаар ярьж байхдаа нэг дарж чөлөөлнө. Андуурсан бол дээд талын
   * мэдэгдлээс «Буцаах» дарж хуучин төлөв рүү нь буцаана. Дэлгэрэнгүй
   * шалтгаан бичих шаардлагатай бол захиалгын цонхны «Төлөв» хэсэг хэвээрээ.
   */
  function cancelAppointment(appointment: DayAppointment) {
    setNotice(null);
    const previous = appointment.status;
    startAction(async () => {
      const result = await setAppointmentStatus(appointment.id, "CANCELLED");
      if (!result.ok) {
        showIssues("Цуцлаж чадсангүй.", result.issues);
        return;
      }
      setNotice({
        kind: "undo",
        dateKey,
        id: appointment.id,
        clientName: appointment.client.name,
        status: previous,
      });
    });
  }

  function undoCancel() {
    const target = activeNotice?.kind === "undo" ? activeNotice : null;
    if (!target) return;
    setNotice(null);
    startAction(async () => {
      // Цагийг нь хооронд нь өөр хүн авсан байвал сервер татгалзана
      const result = await setAppointmentStatus(target.id, target.status);
      if (!result.ok) showIssues("Цуцлалтыг буцаах боломжгүй.", result.issues);
    });
  }

  /**
   * Захиалгын баталгаажуулалтын текст — хамтарсан захиалгын бүх мөрийг нэгтгэнэ.
   * Хуанли дээрх аль ч мөрөөс хуулахад НЭГ бүтэн мессеж гарна.
   */
  function copyTextFor(appointment: DayAppointment): string {
    const group = appointment.groupId
      ? appointments.filter((a) => a.groupId === appointment.groupId)
      : [appointment];
    const primary = group.find((a) => a.isPrimary) ?? appointment;

    return buildBookingText({
      clientName: appointment.client.name,
      branchName: branch.name,
      startAt: appointment.startAt,
      endAt: appointment.endAt,
      lines: group.map((row) => ({
        staffName: staff.find((m) => m.id === row.staffId)?.name ?? "—",
        items: row.items,
      })),
      extraTotal: primary.extraTotal,
      totalPrice: group.reduce((sum, row) => sum + row.totalPrice, 0),
      paid: primary.payments.reduce((sum, payment) => sum + payment.amount, 0),
    });
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
        <div className="no-print border-b border-warn-200 bg-warn-50 px-6 py-2 text-sm text-warn-700">
          Тухайн өдөр салбар хаалттай
          {closure.reason ? ` — ${closure.reason}` : ""}.
        </div>
      ) : null}

      {activeNotice?.kind === "issues" ? (
        <div
          role="alert"
          className="no-print flex items-start gap-3 border-b border-danger-200 bg-danger-50 px-6 py-2 text-sm text-danger-700"
        >
          <span className="min-w-0 flex-1">
            <strong className="font-medium">{activeNotice.title}</strong>{" "}
            {activeNotice.issues.join(" ")}
          </span>
          <button
            type="button"
            onClick={() => setNotice(null)}
            className="shrink-0 font-medium underline underline-offset-2"
          >
            Хаах
          </button>
        </div>
      ) : null}

      {activeNotice?.kind === "undo" ? (
        <div className="no-print flex items-center gap-3 border-b border-sand-200 bg-sand-50 px-6 py-2 text-sm text-sand-700">
          <span className="min-w-0 flex-1">
            <strong className="font-medium text-sand-900">
              {activeNotice.clientName}
            </strong>
            -ийн захиалга цуцлагдаж, тэр цаг сул боллоо.
          </span>
          <button
            type="button"
            onClick={undoCancel}
            disabled={isBusy}
            className="shrink-0 rounded-lg border border-sand-300 bg-white px-2.5 py-1 text-xs font-medium text-sand-800 transition hover:bg-sand-100 disabled:opacity-50"
          >
            Цуцлалтыг буцаах
          </button>
          <button
            type="button"
            onClick={() => setNotice(null)}
            className="shrink-0 text-xs text-sand-500 underline underline-offset-2 hover:text-sand-700"
          >
            Хаах
          </button>
        </div>
      ) : null}

      {cancelledCount > 0 ? (
        <div className="no-print flex items-center gap-2 border-b border-sand-200 px-6 py-1.5 text-xs text-sand-500">
          <span>
            {cancelledCount} цуцлагдсан захиалга{" "}
            {showCancelled ? "харагдаж байна" : "нуугдсан — цаг нь сул"}.
          </span>
          <button
            type="button"
            onClick={() => setShowCancelled((value) => !value)}
            className="font-medium text-sand-700 underline underline-offset-2"
          >
            {showCancelled ? "Нуух" : "Харах"}
          </button>
        </div>
      ) : null}

      {/*
        Мастер сонгох эгнээ — баганууд шахуу болсон үед Л гарч ирнэ (утас,
        таблет, нарийн цонх). Тухтай багтаж байвал босоо зай дэмий эзлэхгүй.
      */}
      {crowded ? (
        <div className="no-print flex gap-1.5 overflow-x-auto scrollbar-slim border-b border-sand-200 px-3 py-2 md:px-6">
          <button
            type="button"
            onClick={() => setFocusStaffId(null)}
            aria-pressed={focus === null}
            className={chipClass(focus === null)}
          >
            Бүгд
          </button>
          {visibleStaff.map((member) => (
            <button
              key={member.id}
              type="button"
              onClick={() => setFocusStaffId(member.id)}
              aria-pressed={focus === member.id}
              className={chipClass(focus === member.id)}
            >
              <span
                aria-hidden
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: member.color }}
              />
              {member.name}
            </button>
          ))}
        </div>
      ) : null}

      <div
        aria-busy={isBusy}
        className={`min-h-0 flex-1 overflow-auto scrollbar-slim bg-white ${
          isBusy ? "pointer-events-none opacity-60 transition-opacity" : ""
        }`}
        ref={scrollRef}
      >
        <div className="relative w-full">
          {/* ── Ажилтны толгой ── */}
          <div
            ref={headRef}
            className="sticky top-0 z-20 flex border-b border-sand-200 bg-white"
          >
            <div className={GUTTER} />
            {visibleStaff.map((member) => {
              const schedule = member.schedules[0];
              const dayOff = !schedule || schedule.isDayOff;
              const day = money.perStaff.get(member.id);
              const count = day?.count ?? 0;
              const earned = day?.amount ?? 0;
              return (
                <div
                  key={member.id}
                  className={`${COL} ${hiddenColumn(member.id)} border-l border-sand-200 px-1 py-2 text-center md:px-3 md:py-4`}
                >
                  <span
                    aria-hidden
                    className="mx-auto flex size-7 items-center justify-center rounded-full text-[11px] font-semibold tracking-wide text-white ring-2 ring-white md:size-11 md:text-sm"
                    style={{ backgroundColor: member.color }}
                  >
                    {initialsOf(member.name)}
                  </span>
                  <p className="mt-1 truncate text-[11px] font-medium text-sand-900 md:mt-2 md:text-[15px]">
                    {member.name}
                  </p>
                  <p
                    className={`truncate text-[10px] md:mt-0.5 md:text-xs ${
                      dayOff ? "text-sand-400" : "text-sand-500"
                    }`}
                  >
                    {dayOff ? "Амралттай" : `${count} захиалга`}
                  </p>
                  {/* Тухайн өдөр энэ мастер хэдэн төгрөгийн үйлчилгээ хийсэн */}
                  {earned > 0 ? (
                    <p className="truncate text-[11px] font-semibold text-sand-800 md:text-sm">
                      {formatPrice(earned)}
                    </p>
                  ) : null}
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
              {timeMarks.map((minute) => {
                const onTheHour = minute % 60 === 0;
                // Шахуу масштабд хагас цагийн шошго давхцах тул зөвхөн бүтэн цаг
                if (!onTheHour && SLOT_STEP * pxPerMin < 26) return null;
                return (
                  <div
                    key={minute}
                    className={`absolute right-1 -translate-y-1/2 font-mono tabular-nums md:right-4 ${
                      onTheHour
                        ? "text-[10px] text-sand-500 md:text-xs"
                        : "text-[9px] text-sand-300 md:text-[11px]"
                    }`}
                    style={{ top: (minute - rangeStart) * pxPerMin }}
                  >
                    {formatMinutes(minute)}
                  </div>
                );
              })}
            </div>

            {visibleStaff.map((member) => (
              <StaffColumn
                key={member.id}
                member={member}
                appointments={byStaff.get(member.id) ?? []}
                rangeStart={rangeStart}
                rangeEnd={rangeEnd}
                gridHeight={gridHeight}
                timeMarks={timeMarks}
                pxPerMin={pxPerMin}
                canWrite={canWrite}
                copyTextFor={copyTextFor}
                drag={drag}
                dropStartMin={
                  dropAt?.staffId === member.id ? dropAt.startMin : null
                }
                onDragStartAppointment={beginDrag}
                onDragEndAppointment={endDrag}
                onDragOverColumn={hoverColumn}
                onDropInColumn={dropInColumn}
                onCancel={cancelAppointment}
                hiddenClass={hiddenColumn(member.id)}
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
            pxPerMin={pxPerMin}
          />
        </div>
      </div>

      {/*
        Өдрийн нийт дүн — хуанлийн ЯГ доод талд, гүйлгэхгүйгээр үргэлж харагдана.
        «Нийт» нь захиалгын дүн, «Төлөгдсөн» нь бодитоор гарт орсон мөнгө.
      */}
      <div className="flex shrink-0 flex-col border-t border-sand-200 bg-sand-50">
        {/* Ажилтан тус бүрийн задаргаа — дарж нээж хаана */}
        {breakdown ? (
          <ul className="scrollbar-slim max-h-44 overflow-y-auto border-b border-sand-200 px-4 py-1.5 md:px-6">
            {visibleStaff.map((member) => {
              const day = money.perStaff.get(member.id);
              return (
                <li
                  key={member.id}
                  className="flex items-baseline justify-between gap-3 py-1"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span
                      aria-hidden
                      className="size-2 shrink-0 rounded-full"
                      style={{ backgroundColor: member.color }}
                    />
                    <span className="truncate text-sm text-sand-700">
                      {member.name}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-baseline gap-3">
                    <span className="text-xs text-sand-400">
                      {day?.count ?? 0} захиалга
                    </span>
                    <span className="min-w-[86px] text-right text-sm font-semibold tabular-nums text-sand-900">
                      {day ? formatPrice(day.amount) : "—"}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        ) : null}

        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 px-4 py-2 md:px-6">
          <button
            type="button"
            onClick={() => setBreakdown((value) => !value)}
            aria-expanded={breakdown}
            className="flex items-baseline gap-2 rounded-lg text-left transition hover:opacity-80"
          >
            <span aria-hidden className="text-xs text-sand-400">
              {breakdown ? "▾" : "▸"}
            </span>
            <span className="text-sm text-sand-500">Өдрийн нийт</span>
            <span className="text-base font-semibold text-sand-900 md:text-lg">
              {formatPrice(money.total)}
            </span>
            <span className="text-xs text-sand-400 underline underline-offset-2">
              {breakdown ? "хураах" : "ажилтнаар"}
            </span>
          </button>

          <p className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs text-sand-500">
            <span>
              Төлөгдсөн{" "}
              <b className="font-semibold text-sand-800">
                {formatPrice(money.paid)}
              </b>
            </span>
            {money.total - money.paid > 0 ? (
              <span>
                Үлдэгдэл{" "}
                <b className="font-semibold text-danger-600">
                  {formatPrice(money.total - money.paid)}
                </b>
              </span>
            ) : null}
          </p>
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
          branchName={branch.name}
          catalog={catalog}
          canWrite={canWrite}
          isAdmin={isAdmin}
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
  timeMarks,
  pxPerMin,
  canWrite,
  copyTextFor,
  onCreate,
  onOpen,
  drag,
  dropStartMin,
  onDragStartAppointment,
  onDragEndAppointment,
  onDragOverColumn,
  onDropInColumn,
  onCancel,
  hiddenClass,
}: {
  member: DayStaff;
  appointments: DayAppointment[];
  rangeStart: number;
  rangeEnd: number;
  gridHeight: number;
  timeMarks: number[];
  /** Нэг минутын өндөр — дэлгэцийн өргөнөөс хамаарна */
  pxPerMin: number;
  canWrite: boolean;
  copyTextFor: (appointment: DayAppointment) => string;
  onCreate: (startMin: number) => void;
  onOpen: (appointment: DayAppointment) => void;
  drag: DragState | null;
  /** Энэ багана дээр буулгавал эхлэх цаг — өөр багана дээр байвал `null` */
  dropStartMin: number | null;
  onDragStartAppointment: (appointment: DayAppointment, grabMin: number) => void;
  onDragEndAppointment: () => void;
  onDragOverColumn: (staffId: string, pointerMin: number) => void;
  onDropInColumn: (staffId: string, pointerMin: number) => void;
  onCancel: (appointment: DayAppointment) => void;
  /** Мастер сонгосон үед бусад баганыг нуух ангилал */
  hiddenClass: string;
}) {
  const schedule = member.schedules[0];
  const dayOff = !schedule || schedule.isDayOff;
  // Амралттай ч захиалгатай тул харагдаж буй багана — шинэ цаг оруулахыг хаана
  const locked = dayOff || !canWrite;
  const laidOut = useMemo(() => layoutAppointments(appointments), [appointments]);

  function handleClick(event: React.MouseEvent<HTMLDivElement>) {
    if (locked) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const raw = rangeStart + (event.clientY - rect.top) / pxPerMin;
    // Дарсан цагийг 30 минутын нүд рүү бөөрөнхийлнө
    const snapped = Math.floor(raw / SLOT_STEP) * SLOT_STEP;
    onCreate(Math.max(rangeStart, Math.min(snapped, rangeEnd - SLOT_STEP)));
  }

  /** Хулганы босоо байрлалыг баганын минут болгоно. */
  function pointerMinutes(event: React.DragEvent<HTMLDivElement>): number {
    const rect = event.currentTarget.getBoundingClientRect();
    return rangeStart + (event.clientY - rect.top) / pxPerMin;
  }

  // Амралттай багана ба бичих эрхгүй хэрэглэгч захиалга хүлээж авахгүй
  const acceptsDrop = Boolean(drag) && !locked;

  return (
    <div
      onDragOver={(event) => {
        if (!acceptsDrop) return;
        // `preventDefault` дуудсан үед л буулгах боломжтой болно
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        onDragOverColumn(member.id, pointerMinutes(event));
      }}
      onDrop={(event) => {
        if (!acceptsDrop) return;
        event.preventDefault();
        onDropInColumn(member.id, pointerMinutes(event));
      }}
      className={`relative ${COL} ${hiddenClass} border-l border-sand-200 ${
        acceptsDrop && dropStartMin !== null ? "bg-brand-500/[0.04]" : ""
      }`}
      style={{ height: gridHeight }}
    >
      {timeMarks.map((minute) => (
        <div
          key={minute}
          className={`pointer-events-none absolute inset-x-0 border-t ${
            minute % 60 === 0 ? "border-sand-200" : "border-sand-100"
          }`}
          style={{ top: (minute - rangeStart) * pxPerMin }}
        />
      ))}

      {dayOff ? (
        <div className="day-off-shade pointer-events-none absolute inset-0" />
      ) : (
        <>
          <Shade
            from={rangeStart}
            to={schedule.startMin}
            rangeStart={rangeStart}
            pxPerMin={pxPerMin}
          />
          <Shade
            from={schedule.endMin}
            to={rangeEnd}
            rangeStart={rangeStart}
            pxPerMin={pxPerMin}
          />
        </>
      )}

      {member.timeOffs.map((off, index) => (
        <div
          key={index}
          className="day-off-shade pointer-events-none absolute inset-x-0 flex items-start justify-center px-1 pt-1 text-[11px] text-sand-500"
          style={{
            top: ((off.startMin ?? 0) - rangeStart) * pxPerMin,
            height: ((off.endMin ?? 24 * 60) - (off.startMin ?? 0)) * pxPerMin,
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
          pxPerMin={pxPerMin}
          column={column}
          columns={columns}
          copyTextFor={copyTextFor}
          onOpen={onOpen}
          canDrag={canWrite}
          isDragging={drag?.appointment.id === appointment.id}
          onDragStart={onDragStartAppointment}
          onDragEnd={onDragEndAppointment}
          onCancel={onCancel}
        />
      ))}

      {/* Хаана унахыг урьдчилан харуулна — шинэ цаг нь энд бичигдэнэ */}
      {drag && dropStartMin !== null ? (
        <div
          className="pointer-events-none absolute inset-x-1 z-20 flex items-start justify-center rounded-lg border-2 border-dashed border-brand-500 bg-brand-500/10 px-1 pt-0.5"
          style={{
            top: (dropStartMin - rangeStart) * pxPerMin,
            height: Math.max(drag.durationMin * pxPerMin, 22),
          }}
        >
          <span className="truncate font-mono text-[11px] font-medium tabular-nums text-sand-700">
            {formatMinutes(dropStartMin)}–
            {formatMinutes(dropStartMin + drag.durationMin)}
          </span>
        </div>
      ) : null}
    </div>
  );
}

function Shade({
  from,
  to,
  rangeStart,
  pxPerMin,
}: {
  from: number;
  to: number;
  rangeStart: number;
  pxPerMin: number;
}) {
  if (to <= from) return null;
  return (
    <div
      className="pointer-events-none absolute inset-x-0 bg-sand-100"
      style={{
        top: (from - rangeStart) * pxPerMin,
        height: (to - from) * pxPerMin,
      }}
    />
  );
}

function AppointmentBlock({
  appointment,
  rangeStart,
  pxPerMin,
  column,
  columns,
  copyTextFor,
  onOpen,
  canDrag,
  isDragging,
  onDragStart,
  onDragEnd,
  onCancel,
}: {
  appointment: DayAppointment;
  rangeStart: number;
  pxPerMin: number;
  column: number;
  columns: number;
  copyTextFor: (appointment: DayAppointment) => string;
  onOpen: (appointment: DayAppointment) => void;
  /** Энэ салбарт бичих эрхтэй эсэх — эрхгүй бол чирэгдэхгүй */
  canDrag: boolean;
  isDragging: boolean;
  onDragStart: (appointment: DayAppointment, grabMin: number) => void;
  onDragEnd: () => void;
  onCancel: (appointment: DayAppointment) => void;
}) {
  const startMin = toLocalMinutes(appointment.startAt);
  const endLocal = toLocalMinutes(appointment.endAt);
  const endMin = endLocal <= startMin ? 24 * 60 : endLocal;
  const duration = endMin - startMin;

  const color = colorOf(appointment);
  const cancelled = appointment.status === "CANCELLED";
  const noShow = appointment.status === "NO_SHOW";
  const width = 100 / columns;
  const height = Math.max(duration * pxPerMin - 4, 22);
  /**
   * Намхан блокт үйлчилгээний нэр багтахгүй — цаг ба нэрийг л үлдээнэ.
   * Хугацаагаар биш, БОДИТ өндрөөр шийднэ: утсанд нэг минут нь намхан.
   */
  const compact = height < 56;
  /** Маш намхан блок — цаг ба нэрийг НЭГ мөрөнд шахна. */
  const tiny = height < 34;

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

  /**
   * Цуцлагдсан захиалгыг чирэхгүй — сервер ч татгалзана. Эхлээд төлөвийг нь
   * сэргээх ёстой, эс тэгвэл идэвхтэй захиалгын цаг руу чимээгүй шургална.
   */
  const draggable = canDrag && !cancelled && !noShow;

  // Хуулах товчийг дотор нь байрлуулах тул блок нь <button> БИШ — HTML-д
  // товч дотор товч байж болохгүй. Гар (keyboard)-ын үйлдлийг гараар өгнө.
  return (
    <div
      role="button"
      tabIndex={0}
      draggable={draggable}
      onDragStart={(event) => {
        // Firefox чирэхийн тулд dataTransfer-т ямар нэг утга шаарддаг
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", appointment.id);
        const rect = event.currentTarget.getBoundingClientRect();
        onDragStart(appointment, (event.clientY - rect.top) / pxPerMin);
      }}
      onDragEnd={onDragEnd}
      onClick={() => onOpen(appointment)}
      onKeyDown={(event) => {
        // Дотор нь товч байгаа тул зөвхөн блок өөрөө сонгогдсон үед нээнэ
        if (event.target !== event.currentTarget) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen(appointment);
        }
      }}
      title={`${appointment.client.name} · ${formatMinutes(startMin)}–${formatMinutes(endMin)} · ${appointment.items.map((i) => i.name).join(", ")}${grouped ? " · хамтарсан захиалга" : ""}${moneyMark ? ` · ${moneyMark.title}` : ""}${draggable ? " · чирж өөр мастер эсвэл цаг руу зөөнө" : ""}`}
      className={`group/appt absolute overflow-hidden rounded-lg pl-2 pr-1.5 text-left md:pl-3.5 md:pr-2.5 shadow-[0_1px_2px_rgba(34,32,29,0.06)] ring-1 ring-inset ring-sand-900/5 transition duration-150 hover:z-10 hover:shadow-md focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 ${
        draggable ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"
      } ${tiny ? "py-0.5" : compact ? "py-1" : "py-2"} ${
        noShow ? "hatched" : ""
      }`}
      style={{
        top: (startMin - rangeStart) * pxPerMin + 2,
        height,
        left: `calc(${column * width}% + 4px)`,
        width: `calc(${width}% - 8px)`,
        backgroundColor: tint(color, cancelled ? 5 : 10),
        opacity: isDragging ? 0.35 : cancelled ? 0.65 : 1,
      }}
    >
      {/* Зүүн талын өнгөт зурвас */}
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 w-[3.5px] rounded-l-lg"
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

      {tiny ? (
        /* Багтахгүй болохоор цагийн эхлэл ба нэрийг нэг мөрөнд */
        <p
          className={`truncate text-[11px] font-semibold leading-tight text-sand-900 ${
            moneyMark ? "pr-4" : ""
          } ${cancelled ? "line-through" : ""}`}
        >
          <span
            className="mr-1 font-mono text-[10px] font-normal tabular-nums"
            style={{ color }}
          >
            {formatMinutes(startMin)}
          </span>
          {grouped ? (
            <span aria-hidden className="mr-0.5 text-sand-500">
              ⇄
            </span>
          ) : null}
          {appointment.client.name}
        </p>
      ) : (
        <>
          <p
            className="truncate font-mono text-[9.5px] tabular-nums opacity-90 md:text-[10.5px]"
            style={{ color }}
          >
            {formatMinutes(startMin)}–{formatMinutes(endMin)}
          </p>
          <p
            className={`truncate text-[12px] font-semibold text-sand-900 md:text-sm ${
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
            <p className="truncate text-[11px] md:text-[13px]" style={{ color }}>
              {appointment.items.map((item) => item.name).join(", ")}
            </p>
          ) : null}
        </>
      )}

      {/*
        Захиалгын мэдээллийг хуулах — үйлчлүүлэгч рүү баталгаажуулалт илгээхэд.
        Хулганаар дээгүүр очиход эсвэл гараар товч дээр очиход л гарч ирнэ,
        ингэснээр хуанли цэвэрхэн харагдана. Хүрэлцэх дэлгэцэд үргэлж харагдана.
        Богино (22px) блокт багтахгүй тул зөвхөн өндөр блокт гаргана —
        тэнд захиалгын цонхноос хуулж болно.
      */}
      {!tiny && (!compact || draggable) ? (
        <span className="absolute bottom-1 right-1 flex gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover/appt:opacity-100 [@media(hover:none)]:opacity-100">
          {!compact ? (
            <CopyButton
              compact
              label=""
              title="Захиалгын мэдээллийг хуулах"
              getText={() => copyTextFor(appointment)}
              className="flex size-5 items-center justify-center rounded-md border border-sand-300 bg-white/95 text-sand-600 shadow-sm transition hover:bg-sand-100 hover:text-sand-900 md:size-6"
            />
          ) : null}

          {/*
            Нэг товчоор цуцлах — цаг нь тэр даруй сул болно. Андуурсан бол
            хуанлийн дээд талын мэдэгдлээс «Буцаах».
          */}
          {draggable ? (
            <button
              type="button"
              title="Цуцлах — энэ цаг сул болно"
              aria-label={`${appointment.client.name} — захиалгыг цуцлах`}
              onClick={(event) => {
                event.stopPropagation();
                onCancel(appointment);
              }}
              className="flex size-5 items-center justify-center rounded-md border border-sand-300 bg-white/95 text-sand-600 shadow-sm transition hover:border-danger-200 hover:bg-danger-50 hover:text-danger-700 md:size-6"
            >
              <svg
                viewBox="0 0 24 24"
                className="size-3.5"
                aria-hidden
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
              >
                <path d="M6 6 18 18M18 6 6 18" />
              </svg>
            </button>
          ) : null}
        </span>
      ) : null}
    </div>
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
  pxPerMin,
}: {
  dateKey: string;
  rangeStart: number;
  rangeEnd: number;
  pxPerMin: number;
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
      className="pointer-events-none absolute inset-x-0 z-10 flex items-center pl-[31px] md:pl-[71px]"
      style={{ top: (minutes - rangeStart) * pxPerMin }}
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
