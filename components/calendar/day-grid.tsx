"use client";

import { useRouter, useSearchParams } from "next/navigation";
import {
  useEffect,
  useMemo,
  useOptimistic,
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
import type { AppointmentStatus } from "@/lib/generated/prisma/enums";
import { formatMinutes, toDateKey, toLocalMinutes } from "@/lib/time";
import {
  activeTimeOffs,
  effectiveShift,
  isMarkedOff,
  isRestingAllDay,
} from "@/lib/day-shift";
import { formatPrice } from "@/lib/labels";
import { buildBookingText } from "@/lib/booking-text";
import { CopyButton } from "@/components/ui/copy-button";
import {
  PAYMENT_METHOD_LABELS,
  PAYMENT_METHODS,
  PAYMENT_STATE_LABELS,
  summarize,
} from "@/lib/payments";
import {
  moveAppointment,
  setAppointmentStatus,
} from "@/app/(app)/calendar/actions";
import { deleteTimeOff } from "@/app/(app)/staff/actions";
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
const PX_PER_MIN_MIN = 0.95; // 1 цаг ≈ 57px — үүнээс нягт болгохгүй, оронд нь гүйлгэнэ
const PX_PER_MIN_MAX = 1.9; // том дэлгэцэнд ч хэт сунгахгүй
/** Хуанлийн их бие дээрх зай (`pt-2.5`) ба доод захын амьсгал. */
const GRID_PADDING = 14;
/** Их биеийн дээд зай (`pt-2.5`) — үнэмлэхүй байрлалд тооцох ёстой. */
const GRID_TOP_PAD = 10;

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
 * Хуанли ҮРГЭЛЖ харуулах цагийн муж — 08:30-аас 20:30.
 *
 * Салбар 10:00-д нээдэг ч өглөө эрт ирсэн үйлчлүүлэгч, оройтож дуусах ажил
 * хоёулаа хуанлид байрлах ёстой. Ажлын цагаас гадуурх хэсэг нь саарлаар
 * (хаалттай) харагдана — тэнд дарж захиалга оруулахгүй.
 */
const VIEW_START_MIN = 8 * 60 + 30;
const VIEW_END_MIN = 20 * 60 + 30;
/**
 * Багана ба цагийн баганын өргөн.
 *
 * Баганууд дэлгэцэндээ ҮРГЭЛЖ багтана — утас, таблет, компьютер хамаагүй
 * хуанли хойшоо гүйхгүй. Бүх мастер зэрэг харагдана.
 */
const COL = "min-w-0 flex-1";
const GUTTER = "w-9 shrink-0 md:w-[76px]";

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

/**
 * Захиалгын блокны өнгөний багц.
 *
 * Салонд бүх үйлчилгээ ойролцоо өнгөтэй байдаг тул хуанли нэг өнгө болж
 * харагдахгүйн тулд өнгийг ЗАХИАЛГА тус бүрээр өгнө. Бүгд намуухан, цагаан
 * дэвсгэр дээр текст нь уншигдах гүнтэй.
 */
const BLOCK_COLORS = [
  "#a35b43", // тоосгон
  "#a38643", // шаргал
  "#96a343", // хайлаас
  "#6ba343", // ногоон
  "#43a353", // навч
  "#43a383", // номин
  "#439ba3", // тэнгис
  "#4378a3", // цэнхэр
  "#4356a3", // индиго
  "#5f43a3", // нил
  "#9043a3", // ягаан нил
  "#a34383", // чавга
];

/**
 * Дараалсан захиалгууд ХАМГИЙН ХОЛ өнгө авахын тулд палитрыг алгасаж түүнэ.
 * 5 ба 12 харилцан анхны тоо тул 12 өнгө бүгд эргэлтэнд орно, гэхдээ хөрш
 * захиалгууд өнгөний хүрээний эсрэг талаас өнгө авна.
 */
const COLOR_STRIDE = 5;

/**
 * Өнгийг цайруулж дэвсгэр болгоно.
 *
 * Хэт цайруулбал бүх захиалга нэг цагаан блок болж, аль нь аль болох нь
 * ялгарахаа больдог — өнгө нь ХАРАГДАХ хэмжээнд үлдэнэ.
 */
function tint(color: string, percent: number): string {
  return `color-mix(in srgb, ${color} ${percent}%, white)`;
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
  canWrite,
  isAdmin,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);

  /**
   * Өнөөдрийн одоогийн минут (өөр өдөр бол `null`).
   *
   * Хоёр зүйлд хэрэглэнэ: улаан шугам зурах, ӨНГӨРСӨН цагийг бүдгэрүүлж
   * дарагдахгүй болгох. Цагийг НЭГ л газраас захиалж авна.
   */
  const now = useSyncExternalStore(
    subscribeToClock,
    getClockSnapshot,
    getServerClockSnapshot,
  );
  const nowMin = now && toDateKey(now) === dateKey ? toLocalMinutes(now) : null;

  const isWide = useSyncExternalStore(
    subscribeToWidth,
    getWideSnapshot,
    getServerWideSnapshot,
  );

  /**
   * Хуанлийн их биед үлдэх ЦЭВЭР ӨНДӨР — ажилтны толгойг хассан.
   * Босоо масштабыг үүгээр тооцно.
   */
  const [box, setBox] = useState<{ height: number } | null>(null);

  useEffect(() => {
    const node = scrollRef.current;
    const head = headRef.current;
    if (!node || !head) return;

    // Ажиглалт эхлэхэд эхний хэмжилт өөрөө ирнэ — гараар дуудах шаардлагагүй
    const observer = new ResizeObserver(() => {
      setBox({
        height: node.clientHeight - head.offsetHeight - GRID_PADDING,
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
   * Баталгаажуулах товчны ӨӨДРӨГ төлөв.
   *
   * Сервер хариу ирэхийг хүлээвэл товч дарагдсан ч хэсэг зогсоод байдаг.
   * Иймд тэмдэг нь ТЭР ДОРОО солигдоно, сервер ард нь бичнэ. Алдвал шинэ
   * өгөгдөл ирэхэд өөрөө хуучин байдалдаа эргэнэ.
   *
   * Мөн хуанлийг бүхэлд нь бүдгэрүүлдэг `startAction`-ыг ЭНД хэрэглэхгүй —
   * нэг тэмдэг тавихад бүх дэлгэц царцах ёсгүй.
   */
  const [, startConfirm] = useTransition();
  const [statusPatch, patchStatus] = useOptimistic(
    {} as Record<string, AppointmentStatus>,
    (
      current: Record<string, AppointmentStatus>,
      next: { id: string; status: AppointmentStatus },
    ) => ({ ...current, [next.id]: next.status }),
  );

  /**
   * Хуанлийн дээд талын алдааны мэдэгдэл.
   *
   * Аль өдрийнх болохыг хамт хадгална: өөр өдөр рүү шилжихэд өмнөх өдрийн
   * мэдэгдэл өөрөө хамаагүй болж алга болно.
   */
  const [notice, setNotice] = useState<{
    dateKey: string;
    title: string;
    issues: string[];
  } | null>(null);
  const activeNotice = notice?.dateKey === dateKey ? notice : null;

  /** Цуцлагдсан захиалгыг хуанлиас нууна — тэр цаг сул мэт харагдана. */
  const [showCancelled, setShowCancelled] = useState(false);

  function showIssues(title: string, issues: string[]) {
    setNotice({ dateKey, title, issues });
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
    /** Өдрийн эцсийн тооцоо — бэлэн, POS, данс тус бүрээр */
    const perMethod = new Map<string, number>();
    let total = 0;
    let paid = 0;
    for (const appt of appointments) {
      if (appt.status === "CANCELLED" || appt.status === "NO_SHOW") continue;
      const row = perStaff.get(appt.staffId) ?? { count: 0, amount: 0 };
      row.count += 1;
      row.amount += appt.totalPrice;
      perStaff.set(appt.staffId, row);
      total += appt.totalPrice;
      for (const payment of appt.payments) {
        paid += payment.amount;
        perMethod.set(
          payment.method,
          (perMethod.get(payment.method) ?? 0) + payment.amount,
        );
      }
    }
    return { perStaff, perMethod, total, paid };
  }, [appointments]);

  /** Доод мөрний ажилтан тус бүрийн задаргаа нээлттэй эсэх. */
  const [breakdown, setBreakdown] = useState(false);

  /**
   * Цуцлагдсан захиалгын ТҮҮХ — цагийн дарааллаар, бүлгийг нэг мөрөнд.
   *
   * Хуанлинаас нуусан ч мөр нь эндээс олдоно: хэн, хэдэн цагт захиалсан,
   * хэн цуцалсан, ямар шалтгаантай. Дарвал захиалга нь нээгдэж «Сэргээх»
   * боломжтой.
   */
  const cancelledHistory = useMemo(() => {
    const seen = new Set<string>();
    const rows: DayAppointment[] = [];

    for (const appointment of [...appointments].sort(
      (a, b) => a.startAt.getTime() - b.startAt.getTime(),
    )) {
      if (appointment.status !== "CANCELLED") continue;
      const key = appointment.groupId ?? appointment.id;
      if (seen.has(key)) continue;
      seen.add(key);

      // Хамтарсан захиалгыг үндсэн мөрөөр нь төлөөлүүлнэ
      const primary = appointment.groupId
        ? (appointments.find(
            (a) => a.groupId === appointment.groupId && a.isPrimary,
          ) ?? appointment)
        : appointment;
      rows.push(primary);
    }

    return rows;
  }, [appointments]);

  /** Бүлгийн бүх ажилтны нэр — «Ankhmaa, Selenge». */
  function staffNamesOf(appointment: DayAppointment): string {
    const group = appointment.groupId
      ? appointments.filter((a) => a.groupId === appointment.groupId)
      : [appointment];
    return group
      .map((row) => staff.find((m) => m.id === row.staffId)?.name)
      .filter(Boolean)
      .join(", ");
  }

  /**
   * Хуанли дээр ЗУРАГДАХ захиалгууд.
   *
   * Цуцлагдсаныг нууна — ресепшн тэр цагийг шууд сул гэж харна. «Ирээгүй»
   * захиалга үлдэнэ: цаг нь бодитоор зарцуулагдсан, түүх нь харагдах ёстой.
   */
  const shownAppointments = useMemo(() => {
    // Дөнгөж дарсан баталгаажуулалтыг сервер бичиж амжаагүй байхад нь харуулна
    const patched = appointments.map((appointment) => {
      const status = statusPatch[appointment.id];
      return status && status !== appointment.status
        ? { ...appointment, status }
        : appointment;
    });

    return showCancelled
      ? patched
      : patched.filter((a) => a.status !== "CANCELLED");
  }, [appointments, showCancelled, statusPatch]);

  // Тогтмол мужаас гадуур ажлын цаг эсвэл захиалга байвал хуанли сунана
  const { rangeStart, rangeEnd } = useMemo(() => {
    let start = Math.min(VIEW_START_MIN, openMin);
    let end = Math.max(VIEW_END_MIN, closeMin);
    for (const appt of shownAppointments) {
      start = Math.min(start, toLocalMinutes(appt.startAt));
      const apptEnd = toLocalMinutes(appt.endAt);
      end = Math.max(end, apptEnd === 0 ? 24 * 60 : apptEnd);
    }
    // 30 минутын нүд рүү тэгшилнэ — 08:30 нь 08:00 болж бүдгэрэхгүй
    return {
      rangeStart: Math.floor(start / SLOT_STEP) * SLOT_STEP,
      rangeEnd: Math.ceil(end / SLOT_STEP) * SLOT_STEP,
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

  /**
   * Блокийн агуулгын үе шатны БОСГО — пикселээр.
   *
   * Блок доторх текстийн БОДИТ өндрөөс гаралтай:
   *   бүтэн (энгийн фонт)  ~71px
   *   шахуу (жижиг фонт)   ~44px — цаг, нэр, үйлчилгээ ГУРВУУЛАА үлдэнэ
   *   нэг мөр              ~20px
   * Босгоос доош орвол текст таслагдана, тиймээс мөр хасахын оронд эхлээд
   * ЖИЖИГРҮҮЛНЭ. Утсанд фонт анхнаасаа жижиг тул босго нь ч намхан.
   */
  const tiers = useMemo(
    () => (isWide ? { full: 74, tiny: 44 } : { full: 66, tiny: 40 }),
    [isWide],
  );

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
    const shift = working ? effectiveShift(working) : null;
    if (!working || !shift) return null;
    return {
      mode: "create",
      branchId: branch.id,
      dateKey,
      staffId: working.id,
      startMin: Math.max(openMin, shift.startMin),
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

  /**
   * Захиалга бүрийн өнгө.
   *
   * ӨДРИЙН ДАРААЛЛААР палитраас ээлжлэн оноодог тул хоёр захиалга санамсаргүй
   * ижил өнгө болох боломжгүй — өмнө нь хэшээр сонгодог байсан тул ойролцоо
   * өнгөнүүд давхцаж, бүх блок нэг өнгө мэт харагддаг байв.
   *
   * ХАМТАРСАН захиалгын бүх мөр нэг түлхүүртэй тул ЯГ ИЖИЛ өнгөтэй үлдэнэ.
   */
  const colorByKey = useMemo(() => {
    const map = new Map<string, string>();
    const ordered = [...appointments].sort(
      (a, b) =>
        a.startAt.getTime() - b.startAt.getTime() ||
        a.staffId.localeCompare(b.staffId),
    );
    for (const appointment of ordered) {
      const key = appointment.groupId ?? appointment.id;
      if (map.has(key)) continue;
      const index = (map.size * COLOR_STRIDE) % BLOCK_COLORS.length;
      map.set(key, BLOCK_COLORS[index]);
    }
    return map;
  }, [appointments]);

  function colorOf(appointment: DayAppointment): string {
    return colorByKey.get(appointment.groupId ?? appointment.id) ?? BLOCK_COLORS[0];
  }

  /**
   * Нэг дарж БАТАЛГААЖУУЛНА.
   *
   * Ресепшн үйлчлүүлэгчтэй утсаар ярьсны дараа хуанли дээрээс шууд тэмдэглэнэ
   * — захиалга нээх шаардлагагүй. Дахин дарвал буцаад «Захиалсан» болно.
   * Хамтарсан захиалгын бүх мөр хамт солигдоно (сервер тийнхүү бичдэг).
   */
  function toggleConfirmed(appointment: DayAppointment) {
    setNotice(null);
    const next: AppointmentStatus =
      appointment.status === "CONFIRMED" ? "BOOKED" : "CONFIRMED";

    startConfirm(async () => {
      // Бүлгийн бүх мөр хамт солигдоно — сервер тийнхүү бичдэг
      for (const row of appointments) {
        const sameGroup = appointment.groupId
          ? row.groupId === appointment.groupId
          : row.id === appointment.id;
        if (sameGroup) patchStatus({ id: row.id, status: next });
      }

      const result = await setAppointmentStatus(appointment.id, next);
      if (!result.ok) showIssues("Төлөв солиж чадсангүй.", result.issues);
    });
  }

  /**
   * Чөлөөг цуцлах — хуанли дээрээс шууд, ажилтны хуудас руу орохгүйгээр.
   * Ажилтны цаг тэр дороо сул болно. Дахин авах бол цонхны «Чөлөө» таб.
   */
  function removeTimeOff(timeOffId: string) {
    setNotice(null);
    startAction(async () => {
      const result = await deleteTimeOff(timeOffId);
      if (!result.ok) showIssues("Чөлөөг болиулж чадсангүй.", result.issues);
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

      {activeNotice ? (
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

      {/*
        Цуцлагдсан захиалгын түүх.

        Хаалттай үедээ зөвхөн нэг тоо — хуанли цэвэр хэвээр. Нээвэл цуцлагдсан
        захиалгууд хуанли дээр саарлаар эргэн гарч ирж, доор нь хэн цуцалсан,
        ямар шалтгаантай нь жагсаана.
      */}
      {cancelledHistory.length > 0 ? (
        <div className="no-print border-b border-sand-200 px-3 py-1 md:px-6 md:py-1.5">
          <button
            type="button"
            onClick={() => setShowCancelled((value) => !value)}
            aria-expanded={showCancelled}
            title="Цуцлагдсан захиалгын түүх"
            className={`flex items-center gap-1.5 rounded-lg px-2 py-0.5 text-xs transition ${
              showCancelled
                ? "bg-sand-200/70 font-medium text-sand-800"
                : "text-sand-500 hover:text-sand-800"
            }`}
          >
            <span aria-hidden className="text-[9px] leading-none">
              {showCancelled ? "▾" : "▸"}
            </span>
            Цуцлагдсан түүх
            <span className="rounded-full bg-sand-300/60 px-1.5 py-px font-medium tabular-nums text-sand-700">
              {cancelledHistory.length}
            </span>
          </button>

          {showCancelled ? (
            <ul className="mt-1.5 space-y-0.5 pb-1">
              {cancelledHistory.map((row) => {
                const startMin = toLocalMinutes(row.startAt);
                const endLocal = toLocalMinutes(row.endAt);
                const endMin = endLocal <= startMin ? 24 * 60 : endLocal;

                return (
                  <li key={row.id}>
                    <button
                      type="button"
                      onClick={() => {
                        clearNewParam();
                        setDialog({
                          mode: "edit",
                          branchId: branch.id,
                          dateKey,
                          appointment: row,
                          siblings: [row],
                          replacement: null,
                        });
                      }}
                      className="flex w-full flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded-lg px-2 py-1 text-left text-xs transition hover:bg-sand-100"
                    >
                      <span className="font-mono tabular-nums text-sand-500">
                        {formatMinutes(startMin)}–{formatMinutes(endMin)}
                      </span>
                      <span className="font-medium text-sand-800 line-through">
                        {row.client.name}
                      </span>
                      <span className="text-sand-500">
                        {staffNamesOf(row)}
                      </span>
                      <span className="truncate text-sand-400">
                        {row.items.map((item) => item.name).join(", ")}
                      </span>
                      <span className="ml-auto shrink-0 text-sand-500">
                        {row.cancelledBy?.name ? `${row.cancelledBy.name} цуцалсан` : "цуцалсан"}
                        {row.cancelledAt
                          ? ` · ${formatMinutes(toLocalMinutes(row.cancelledAt))}`
                          : ""}
                        {row.cancelReason ? ` · ${row.cancelReason}` : ""}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : null}
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
              // Амралттай ч захиалгатай тул баганад үлдсэн ажилтан
              const dayOff = isRestingAllDay(member);
              const markedOff = isMarkedOff(member);
              const day = money.perStaff.get(member.id);
              const count = day?.count ?? 0;
              const earned = day?.amount ?? 0;
              return (
                <div
                  key={member.id}
                  className={`${COL} border-l border-sand-200 px-1 py-1 text-center md:px-2 md:py-2`}
                >
                  {/*
                    Компьютер, таблет дээр зураг ба нэр НЭГ мөрөнд — толгой
                    намхан байх тусам хуанлийн их бие өндөр болно (масштаб нь
                    үлдсэн өндөрт өөрөө тааруулдаг). Утсанд багана нарийн тул
                    хуучнаараа дээр доор нь хэвээр.
                  */}
                  <div className="md:flex md:items-center md:justify-center md:gap-1.5">
                    <span
                      aria-hidden
                      className="mx-auto flex size-6 items-center justify-center rounded-full text-[10px] font-semibold tracking-wide text-white ring-2 ring-white md:mx-0 md:size-7 md:text-[11px] md:shrink-0"
                      style={{ backgroundColor: member.color }}
                    >
                      {initialsOf(member.name)}
                    </span>
                    <p className="mt-1 truncate text-[11px] font-medium text-sand-900 md:mt-0 md:text-[13px]">
                      {member.name}
                    </p>
                  </div>

                  {/*
                    Захиалгын тоо ба өдрийн орлого. Утсанд багана нарийн тул
                    дээр доороо, компьютер, таблет дээр нэг мөрөнд багтана.
                  */}
                  <div className="flex min-w-0 flex-col items-center leading-tight md:flex-row md:justify-center md:gap-1">
                    <p
                      className={`max-w-full truncate text-[10px] md:text-[11px] ${
                        dayOff ? "text-sand-400" : "text-sand-500"
                      }`}
                    >
                      {dayOff
                        ? markedOff
                          ? "Амарсан"
                          : "Амралттай"
                        : `${count} захиалга`}
                    </p>
                    {/* Орлого зөвхөн том дэлгэцэнд — утсанд хуанли л харагдана */}
                    {earned > 0 ? (
                      <p className="hidden max-w-full truncate text-[11px] font-semibold text-sand-800 md:block">
                        <span aria-hidden>· </span>
                        {formatPrice(earned)}
                      </p>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>

          {/* ── Хуанлийн их бие ── */}
          {/* Дээд талын зай — эхний цагийн шошго таслагдахаас сэргийлнэ */}
          <div className="relative flex pt-2.5">
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
                tiers={tiers}
                nowMin={nowMin}
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
                colorOf={colorOf}
                onConfirm={toggleConfirmed}
                onRemoveTimeOff={canWrite ? removeTimeOff : null}
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

            {/*
              Одоогийн цагийн шугам нь ИХ БИЕИЙН дотор байрлана — гадна нь
              байрлуулбал наалдамхай толгойн өндрөөр доошоо биш ДЭЭШЭЭ
              шилжиж, бодит цагаас зөрдөг байв.
            */}
            <CurrentTimeLine
              nowMin={nowMin}
              rangeStart={rangeStart}
              rangeEnd={rangeEnd}
              pxPerMin={pxPerMin}
            />
          </div>
        </div>
      </div>

      {/*
        Өдрийн нийт дүн — хуанлийн ЯГ доод талд, гүйлгэхгүйгээр үргэлж харагдана.
        «Нийт» нь захиалгын дүн, «Төлөгдсөн» нь бодитоор гарт орсон мөнгө.

        ГАР УТСАНД ОГТ ГАРАХГҮЙ: жижиг дэлгэцэнд хуанли өөрөө л чухал, мөнгөний
        мөр нь захиалгын нүднээс өндөр авдаг. Дүнг тайлангаас, эсвэл захиалга
        бүрийн цонхноос харна.
      */}
      <div className="hidden shrink-0 flex-col border-t border-sand-200 bg-sand-50 md:flex">
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

            {/* Ямар хэрэгслээр хэдэн төгрөг орсон — өдрийн эцсийн тооцоо */}
            {PAYMENT_METHODS.filter(
              (method) => (money.perMethod.get(method) ?? 0) !== 0,
            ).map((method) => (
              <span key={method}>
                {PAYMENT_METHOD_LABELS[method]}{" "}
                <b className="font-semibold text-sand-700">
                  {formatPrice(money.perMethod.get(method) ?? 0)}
                </b>
              </span>
            ))}

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
  tiers,
  nowMin,
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
  colorOf,
  onConfirm,
  onRemoveTimeOff,
}: {
  member: DayStaff;
  appointments: DayAppointment[];
  rangeStart: number;
  rangeEnd: number;
  gridHeight: number;
  timeMarks: number[];
  /** Нэг минутын өндөр — дэлгэцийн өргөнөөс хамаарна */
  pxPerMin: number;
  /** Блокийн агуулгыг хураах босго, пикселээр */
  tiers: { full: number; tiny: number };
  /** Өнөөдрийн одоогийн минут — өнгөрсөн цагийг хаахад. Өөр өдөр бол `null` */
  nowMin: number | null;
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
  colorOf: (appointment: DayAppointment) => string;
  onConfirm: (appointment: DayAppointment) => void;
  /** Чөлөө болиулах — эрхгүй хэрэглэгчид `null` */
  onRemoveTimeOff: ((timeOffId: string) => void) | null;
}) {
  const shift = effectiveShift(member);
  const dayOff = shift === null;
  // Амралттай ч захиалгатай тул харагдаж буй багана — шинэ цаг оруулахыг хаана
  const locked = dayOff || !canWrite;
  const laidOut = useMemo(() => layoutAppointments(appointments), [appointments]);

  function handleClick(event: React.MouseEvent<HTMLDivElement>) {
    if (locked) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const raw = rangeStart + (event.clientY - rect.top) / pxPerMin;
    // Дарсан цагийг 30 минутын нүд рүү бөөрөнхийлнө
    const snapped = Math.floor(raw / SLOT_STEP) * SLOT_STEP;

    /*
      Хуанли ажлын цагаас өмнө, хойш ч үргэлжилдэг (08:30–20:30). Тэр саарал
      хэсэгт дарвал захиалгыг ЭЭЛЖИНД нь оруулж өгнө — цонх нээгдээд шууд
      «энэ цаг болохгүй» гэж хэлэхээс дээр.
    */
    const startMin = Math.max(
      shift?.startMin ?? rangeStart,
      Math.min(snapped, (shift?.endMin ?? rangeEnd) - SLOT_STEP),
    );
    onCreate(startMin);
  }

  /** Хулганы босоо байрлалыг баганын минут болгоно. */
  function pointerMinutes(event: React.DragEvent<HTMLDivElement>): number {
    const rect = event.currentTarget.getBoundingClientRect();
    return rangeStart + (event.clientY - rect.top) / pxPerMin;
  }

  /*
    Амралттай багана ба бичих эрхгүй хэрэглэгч захиалга хүлээж авахгүй.
    ТОГТМОЛ МАСТЕРТАЙ захиалга нь зөвхөн ӨӨРИЙН баганадаа буудаг — цаг нь
    солигдож болно, хүн нь солигдохгүй (сервер ч татгалзана).
  */
  const acceptsDrop =
    drag !== null &&
    !locked &&
    !(drag.appointment.onlyThisStaff && drag.appointment.staffId !== member.id);

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
      className={`relative ${COL} border-l border-sand-200 ${
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
            to={shift.startMin}
            rangeStart={rangeStart}
            pxPerMin={pxPerMin}
          />
          <Shade
            from={shift.endMin}
            to={rangeEnd}
            rangeStart={rangeStart}
            pxPerMin={pxPerMin}
          />
        </>
      )}

      <div
        role="button"
        tabIndex={locked ? -1 : 0}
        aria-label={`${member.name} — шинэ цаг захиалах`}
        onClick={handleClick}
        className={`absolute inset-0 ${locked ? "cursor-not-allowed" : "cursor-copy"}`}
      />

      {/*
        Өнгөрсөн цаг — зөвхөн БҮДГЭРНЭ, хаагдахгүй.

        Бүртгэлгүй үлдсэн үйлчилгээг дууссаны дараа буцааж бүртгэх нь ресепшний
        өдөр тутмын ажил тул энд ч дарж захиалга оруулна. Өнгө нь «энэ аль
        хэдийн өнгөрсөн» гэдгийг л сануулна. `pointer-events-none` — доод талын
        дарах давхарга ажиллах ёстой.
      */}
      {nowMin !== null && nowMin > rangeStart ? (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 bg-sand-100/70"
          style={{ height: (Math.min(nowMin, rangeEnd) - rangeStart) * pxPerMin }}
        />
      ) : null}

      {/*
        Чөлөө — дарж захиалга оруулахыг ЭНД зогсооно. Захиалгын блокууд эдгээрээс
        хойш зурагдах тул тэдгээр дээр дарж нээх нь хэвээрээ.
      */}
      {(shift ? activeTimeOffs(member, member.timeOffs, shift) : member.timeOffs).map((off) => {
        const offStart = off.startMin ?? 0;
        const offEnd = off.endMin ?? 24 * 60;
        const height = (offEnd - offStart) * pxPerMin;
        return (
          <div
            key={off.id}
            title={`Чөлөөтэй${off.reason ? ` — ${off.reason}` : ""} · энэ цагт захиалга авахгүй`}
            className="day-off-shade absolute inset-x-0 flex cursor-not-allowed items-start justify-center gap-1 overflow-hidden px-1 pt-1 text-[11px] text-sand-500"
            style={{ top: (offStart - rangeStart) * pxPerMin, height }}
          >
            {/* Болиулах — мастер бодлоо өөрчилбөл цаг нь тэр дороо сул болно */}
            {onRemoveTimeOff ? (
              <button
                type="button"
                title="Чөлөөг болиулах — энэ цаг сул болно"
                aria-label={`${member.name} — чөлөөг болиулах`}
                onClick={(event) => {
                  event.stopPropagation();
                  onRemoveTimeOff(off.id);
                }}
                className="absolute right-0.5 top-0.5 flex size-[18px] cursor-pointer items-center justify-center rounded-md border border-sand-300 bg-white/90 text-sand-500 shadow-sm transition hover:border-danger-200 hover:bg-danger-50 hover:text-danger-700"
              >
                <svg
                  viewBox="0 0 24 24"
                  className="size-3"
                  aria-hidden
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2.5}
                  strokeLinecap="round"
                >
                  <path d="M6 6 18 18M18 6 6 18" />
                </svg>
              </button>
            ) : null}

            <svg
              viewBox="0 0 24 24"
              className="mt-[1px] size-3 shrink-0"
              aria-hidden
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="4.5" y="10.5" width="15" height="10" rx="2" />
              <path d="M8.5 10.5V7.5a3.5 3.5 0 0 1 7 0v3" />
            </svg>
            {height > 26 ? (
              <span className="truncate">{off.reason ?? "Чөлөө"}</span>
            ) : null}
          </div>
        );
      })}

      {laidOut.map(({ appointment, column, columns }) => (
        <AppointmentBlock
          key={appointment.id}
          appointment={appointment}
          rangeStart={rangeStart}
          pxPerMin={pxPerMin}
          tiers={tiers}
          column={column}
          columns={columns}
          copyTextFor={copyTextFor}
          onOpen={onOpen}
          canDrag={canWrite}
          isDragging={drag?.appointment.id === appointment.id}
          onDragStart={onDragStartAppointment}
          onDragEnd={onDragEndAppointment}
          color={colorOf(appointment)}
          onConfirm={onConfirm}
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
  tiers,
  column,
  columns,
  copyTextFor,
  onOpen,
  canDrag,
  isDragging,
  onDragStart,
  onDragEnd,
  color,
  onConfirm,
}: {
  appointment: DayAppointment;
  rangeStart: number;
  pxPerMin: number;
  tiers: { full: number; tiny: number };
  column: number;
  columns: number;
  copyTextFor: (appointment: DayAppointment) => string;
  onOpen: (appointment: DayAppointment) => void;
  /** Энэ салбарт бичих эрхтэй эсэх — эрхгүй бол чирэгдэхгүй */
  canDrag: boolean;
  isDragging: boolean;
  onDragStart: (appointment: DayAppointment, grabMin: number) => void;
  onDragEnd: () => void;
  /** Энэ захиалгын өнгө — өдрийн дараалалаар DayGrid оноодог */
  color: string;
  onConfirm: (appointment: DayAppointment) => void;
}) {
  const startMin = toLocalMinutes(appointment.startAt);
  const endLocal = toLocalMinutes(appointment.endAt);
  const endMin = endLocal <= startMin ? 24 * 60 : endLocal;
  const duration = endMin - startMin;

  const cancelled = appointment.status === "CANCELLED";
  const noShow = appointment.status === "NO_SHOW";

  /**
   * Баталгаажсан эсэх — «Захиалсан» бол хараахан үгүй.
   *
   * Ирсэн/дууссан захиалга нь мэдээж баталгаажсан тул тэмдэг нь дүүрэн
   * харагдана, гэхдээ буцааж «Захиалсан» болгохгүй — тэр нь ухраалт болно.
   */
  const confirmed = !cancelled && !noShow && appointment.status !== "BOOKED";
  const canConfirm =
    canDrag &&
    (appointment.status === "BOOKED" || appointment.status === "CONFIRMED");
  const showCheck = !cancelled && !noShow;

  const width = 100 / columns;
  const height = Math.max(duration * pxPerMin - 4, 22);
  /** Маш намхан блок — цаг ба нэрийг НЭГ мөрөнд шахна. */
  const tiny = height < tiers.tiny;
  /**
   * Намхан блок — мөр хасахгүй, зөвхөн фонтыг жижигрүүлж бүгдийг багтаана.
   * Ингэснээр үйлчилгээний нэр таслагдалгүй бүтнээрээ харагдана.
   */
  const dense = !tiny && height < tiers.full;

  const timeClass = dense
    ? "text-[9px] leading-tight"
    : "text-[9.5px] md:text-[10.5px]";
  const nameClass = dense
    ? "text-[11px] leading-tight"
    : "text-[12px] md:text-sm";
  const serviceClass = dense
    ? "text-[9.5px] leading-tight"
    : "text-[11px] md:text-[13px]";

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

  /** Баруун дээд булангийн тэмдгүүд текстийг дарахгүйн тулд үлдээх зай. */
  const cornerPad =
    (moneyMark ? 1 : 0) + (showCheck ? 1 : 0) === 2
      ? "pr-10"
      : moneyMark || showCheck
        ? "pr-6"
        : "";

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
      title={`${appointment.client.name} · ${formatMinutes(startMin)}–${formatMinutes(endMin)} · ${appointment.items.map((i) => i.name).join(", ")}${appointment.onlyThisStaff ? " · тогтмол мастер" : ""}${grouped ? " · хамтарсан захиалга" : ""}${appointment.allowOverlap ? " · давхар захиалга" : ""}${moneyMark ? ` · ${moneyMark.title}` : ""}${draggable ? " · чирж өөр мастер эсвэл цаг руу зөөнө" : ""}`}
      className={`group/appt absolute overflow-hidden rounded-lg pl-2 pr-1.5 text-left md:pl-3.5 md:pr-2.5 shadow-[0_1px_2px_rgba(34,32,29,0.08)] ring-1 ring-inset ring-sand-900/10 transition duration-150 hover:z-10 hover:shadow-md focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 ${
        draggable ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"
      } ${tiny || dense ? "py-0.5" : "py-2"} ${noShow ? "hatched" : ""}`}
      style={{
        top: (startMin - rangeStart) * pxPerMin + 2,
        height,
        left: `calc(${column * width}% + 4px)`,
        width: `calc(${width}% - 8px)`,
        backgroundColor: tint(color, cancelled ? 14 : 28),
        opacity: isDragging ? 0.35 : cancelled ? 0.65 : 1,
      }}
    >
      {/* Зүүн талын өнгөт зурвас */}
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 w-[5px] rounded-l-lg"
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

      {/*
        Баруун ДЭЭД булан — төлбөрийн тэмдэг ба баталгаажуулах нүд.
        Нэг харцаар: төлсөн үү, баталгаажсан уу.
      */}
      {moneyMark || showCheck ? (
        <span className="absolute right-1 top-1 flex items-center gap-1">
          {moneyMark ? (
            <span
              title={moneyMark.title}
              className="flex size-4 items-center justify-center rounded-full text-[10px] font-bold leading-none"
              style={{
                backgroundColor: PAYMENT_STATE_LABELS[money.state].bg,
                color: PAYMENT_STATE_LABELS[money.state].color,
              }}
            >
              {moneyMark.text}
            </span>
          ) : null}

          {/*
            БАТАЛГААЖУУЛАХ — нэг дарахад. Дүүрэн бол утсаар ярьж баталсан.
            Ирсэн/дууссан захиалга дээр дүүрэн боловч дарагдахгүй — ухраалт
            болох тул. Ресепшн өдөрт олон удаа дардаг тул үргэлж харагдана.
          */}
          {showCheck ? (
            <button
              type="button"
              disabled={!canConfirm}
              title={
                confirmed
                  ? canConfirm
                    ? "Баталгаажсан — буцаах бол дарна"
                    : "Баталгаажсан"
                  : "Баталгаажуулах"
              }
              aria-pressed={confirmed}
              aria-label={`${appointment.client.name} — баталгаажуулах`}
              onClick={(event) => {
                event.stopPropagation();
                if (canConfirm) onConfirm(appointment);
              }}
              className={`flex size-[18px] items-center justify-center rounded-md border shadow-sm transition ${
                confirmed
                  ? "border-brand-600 bg-brand-600 text-white"
                  : "border-sand-400 bg-white/90 text-transparent hover:border-brand-500 hover:text-brand-300"
              } ${canConfirm ? "" : "cursor-default"}`}
            >
              <svg
                viewBox="0 0 24 24"
                className="size-3"
                aria-hidden
                fill="none"
                stroke="currentColor"
                strokeWidth={3}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="m5 13 4 4L19 7" />
              </svg>
            </button>
          ) : null}
        </span>
      ) : null}

      {tiny ? (
        /* Багтахгүй болохоор цагийн эхлэл ба нэрийг нэг мөрөнд */
        <p
          className={`truncate text-[11px] font-semibold leading-tight text-sand-900 ${cornerPad} ${
            cancelled ? "line-through" : ""
          }`}
        >
          <span
            className="mr-1 font-mono text-[10px] font-normal tabular-nums"
            style={{ color }}
          >
            {formatMinutes(startMin)}
          </span>
          {appointment.onlyThisStaff ? (
            <span aria-hidden className="mr-0.5 text-warn-600">
              ★
            </span>
          ) : null}
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
            className={`truncate font-mono tabular-nums opacity-90 ${cornerPad} ${timeClass}`}
            style={{ color }}
          >
            {formatMinutes(startMin)}–{formatMinutes(endMin)}
          </p>
          <p
            className={`truncate font-semibold text-sand-900 ${nameClass} ${
              cancelled ? "line-through" : ""
            }`}
          >
            {appointment.onlyThisStaff ? (
              <span
                aria-hidden
                title="Тогтмол мастер — зөвхөн энэ хүнд үйлчлүүлдэг"
                className="mr-1 text-warn-600"
              >
                ★
              </span>
            ) : null}
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
          {/*
            Үйлчилгээний нэр ба МӨНГӨН ДҮН — намхан блокт ч хасагдахгүй, зөвхөн
            жижигрэнэ. Дүн нь баруун захдаа тогтоно: нэр урт бол нэр нь
            таслагдана, дүн нь ҮРГЭЛЖ бүтнээрээ харагдана.
          */}
          <p
            className={`flex items-baseline gap-1.5 ${dense ? "" : "pr-6"} ${serviceClass}`}
            style={{ color }}
          >
            <span className="min-w-0 flex-1 truncate">
              {appointment.items.map((item) => item.name).join(", ")}
            </span>
            {/*
              Утсанд гаргахгүй: багана 70px орчим нарийсдаг тул дүн нь
              үйлчилгээний нэрийг бүтнээр нь идчихнэ. Таблет, компьютер дээр —
              ресепшн ажилладаг дэлгэц — бүрэн харагдана.
            */}
            {appointment.totalPrice > 0 ? (
              <span className="hidden shrink-0 font-semibold tabular-nums text-sand-800 md:inline">
                {formatPrice(appointment.totalPrice)}
              </span>
            ) : null}
          </p>
        </>
      )}

      {/*
        Захиалгын мэдээллийг хуулах — үйлчлүүлэгч рүү баталгаажуулалт илгээхэд.
        Үргэлж харагдана, зөвхөн бүтэн өндөртэй блокт (намханд зай алга).
      */}
      {!tiny && !dense ? (
        <span className="absolute bottom-0.5 right-0.5 opacity-70 transition-opacity focus-within:opacity-100 group-hover/appt:opacity-100 md:bottom-1 md:right-1">
          <CopyButton
            compact
            label=""
            title="Захиалгын мэдээллийг хуулах"
            getText={() => copyTextFor(appointment)}
            className="flex size-[18px] items-center justify-center rounded-md border border-sand-300 bg-white/90 text-sand-500 shadow-sm transition hover:border-sand-400 hover:bg-white hover:text-sand-900 md:size-5"
          />
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
  const timer = setInterval(onChange, 10_000);
  // Таб руу буцаж ирэхэд шууд шинэчилнэ — унтуулсан хөтөч завсарлага алгасдаг
  const onWake = () => onChange();
  document.addEventListener("visibilitychange", onWake);
  window.addEventListener("focus", onWake);
  return () => {
    clearInterval(timer);
    document.removeEventListener("visibilitychange", onWake);
    window.removeEventListener("focus", onWake);
  };
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

/**
 * Одоогийн цагийн шугам — зөвхөн өнөөдрийн харагдацад.
 *
 * Цагийн баганад ЯГ ХЭДЭН ЦАГ болж байгааг бичнэ: ресепшн «одоо хаана явж
 * байна» гэдгийг нэг харцаар мэднэ. Минут тутам өөрөө шилжинэ.
 */
function CurrentTimeLine({
  nowMin,
  rangeStart,
  rangeEnd,
  pxPerMin,
}: {
  /** Өнөөдрийн одоогийн минут — өөр өдрийн харагдацад `null` */
  nowMin: number | null;
  rangeStart: number;
  rangeEnd: number;
  pxPerMin: number;
}) {
  if (nowMin === null) return null;
  if (nowMin < rangeStart || nowMin > rangeEnd) return null;

  return (
    <div
      className="pointer-events-none absolute inset-x-0 z-10 flex items-center"
      style={{ top: GRID_TOP_PAD + (nowMin - rangeStart) * pxPerMin }}
    >
      {/* Цагийн баганад — яг одоогийн цаг */}
      <span
        className={`flex ${GUTTER} items-center justify-end pr-0.5 md:pr-2.5`}
      >
        <span className="rounded bg-rose-500 px-1 py-px font-mono text-[9px] font-semibold leading-tight tabular-nums text-white shadow-sm md:px-1.5 md:text-[11px]">
          {formatMinutes(nowMin)}
        </span>
      </span>
      <span className="h-[2px] flex-1 rounded-full bg-rose-500" />
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
