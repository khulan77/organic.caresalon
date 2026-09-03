"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import type { StaffAdmin, StaffMember, UsersAdmin } from "@/lib/queries";
import { WEEKDAYS, WEEKDAYS_SHORT } from "@/lib/labels";
import { formatMinutes, toDateKey, todayKey } from "@/lib/time";
import type { ActionResult } from "@/lib/action-result";
import {
  addTimeOff,
  deleteStaff,
  deleteTimeOff,
  saveStaff,
  toggleStaff,
} from "@/app/(app)/staff/actions";
import { PageHeader } from "@/components/page-header";
import { ReceptionSection } from "@/components/staff/reception-manager";
import { Modal } from "@/components/ui/modal";
import {
  Field,
  GhostButton,
  Issues,
  PrimaryButton,
  inputClass,
} from "@/components/ui/form";

const PRESET_COLORS = [
  "#c0798c",
  "#c09b5c",
  "#4f7355",
  "#6b8f70",
  "#8b7ba8",
  "#7fa2c0",
  "#6ba39b",
  "#c08a5e",
  "#a98598",
  "#a39887",
];

type Editing =
  | { kind: "staff"; branchId: string; member: StaffMember | null }
  | { kind: "timeOff"; member: StaffMember }
  | { kind: "delete"; member: StaffMember }
  | null;

export function StaffManager({
  branches,
  users,
  isAdmin,
  writableBranchIds,
}: {
  branches: StaffAdmin;
  users: UsersAdmin;
  /** Ресепшний хэрэглэгч, чөлөө зэрэг зөвхөн админд байх хэсгүүдэд */
  isAdmin: boolean;
  /** Ажилтан нэмж, засаж болох салбарууд — ресепшнд зөвхөн харьяа нь */
  writableBranchIds: string[];
}) {
  /** Тухайн салбарт ажилтан нэмэх, засах эрхтэй эсэх. */
  function canEditBranch(branchId: string): boolean {
    return writableBranchIds.includes(branchId);
  }

  /** Шинэ ажилтан хаана нэмэх вэ — эрхтэй эхний салбар. */
  const defaultBranchId = branches.find((b) => canEditBranch(b.id))?.id ?? "";
  const [editing, setEditing] = useState<Editing>(null);
  const [error, setError] = useState<string[] | null>(null);
  const [isPending, startTransition] = useTransition();

  const total = branches.reduce((sum, b) => sum + b.staff.length, 0);
  const active = branches.reduce(
    (sum, b) => sum + b.staff.filter((s) => s.isActive).length,
    0,
  );

  function run(action: () => Promise<ActionResult>) {
    startTransition(async () => {
      const result = await action();
      setError(result.ok ? null : result.issues);
    });
  }

  return (
    <>
      <PageHeader
        title="Ажилтан ба хуваарь"
        subtitle={`${total} ажилтан${active !== total ? ` · ${active} идэвхтэй` : ""} · ${branches.length} салбар`}
        action={
          defaultBranchId ? (
            <PrimaryButton
              onClick={() =>
                setEditing({
                  kind: "staff",
                  branchId: defaultBranchId,
                  member: null,
                })
              }
            >
              + Ажилтан нэмэх
            </PrimaryButton>
          ) : null
        }
      />

      <div className="min-h-0 flex-1 overflow-auto scrollbar-slim p-4 md:p-6">
        {error ? (
          <div className="mb-4">
            <Issues issues={error} />
          </div>
        ) : null}

        <div className="space-y-6">
          {branches.map((branch) => (
            <section key={branch.id}>
              <div className="mb-2 flex items-center gap-2">
                <h2 className="font-serif text-base text-sand-900">
                  {branch.name}
                </h2>
                <span className="text-sm text-sand-500">
                  {formatMinutes(branch.openMin)}–{formatMinutes(branch.closeMin)}
                </span>
                {canEditBranch(branch.id) ? (
                  <button
                    type="button"
                    onClick={() =>
                      setEditing({
                        kind: "staff",
                        branchId: branch.id,
                        member: null,
                      })
                    }
                    className="ml-auto text-sm text-brand-700 hover:underline"
                  >
                    + Ажилтан
                  </button>
                ) : null}
              </div>

              {branch.staff.length === 0 ? (
                <p className="rounded-xl border border-dashed border-sand-300 px-4 py-6 text-sm text-sand-500">
                  Ажилтан бүртгэгдээгүй.
                </p>
              ) : (
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {branch.staff.map((member) => (
                    <StaffCard
                      key={member.id}
                      member={member}
                      canEdit={canEditBranch(branch.id)}
                      isAdmin={isAdmin}
                      isPending={isPending}
                      onEdit={() =>
                        setEditing({
                          kind: "staff",
                          branchId: branch.id,
                          member,
                        })
                      }
                      onTimeOff={() => setEditing({ kind: "timeOff", member })}
                      onToggle={() =>
                        run(() => toggleStaff(member.id, !member.isActive))
                      }
                      onDelete={() => setEditing({ kind: "delete", member })}
                      onRemoveTimeOff={(id) => run(() => deleteTimeOff(id))}
                    />
                  ))}
                </div>
              )}
            </section>
          ))}

          <ReceptionSection
            users={users}
            branches={branches}
            canEdit={isAdmin}
          />
        </div>
      </div>

      {editing?.kind === "staff" ? (
        <StaffModal
          branches={branches.filter((b) => canEditBranch(b.id))}
          branchId={editing.branchId}
          member={editing.member}
          onClose={() => setEditing(null)}
        />
      ) : null}

      {editing?.kind === "timeOff" ? (
        <TimeOffModal
          member={editing.member}
          onClose={() => setEditing(null)}
        />
      ) : null}

      {editing?.kind === "delete" ? (
        <DeleteStaffModal
          member={editing.member}
          isAdmin={isAdmin}
          isPending={isPending}
          onClose={() => setEditing(null)}
          onDeactivate={() => {
            const id = editing.member.id;
            setEditing(null);
            run(() => toggleStaff(id, false));
          }}
          onConfirm={() => {
            const { id, _count } = editing.member;
            setEditing(null);
            run(() => deleteStaff(id, _count.appointments > 0));
          }}
        />
      ) : null}
    </>
  );
}

function StaffCard({
  member,
  canEdit,
  isAdmin,
  isPending,
  onEdit,
  onTimeOff,
  onToggle,
  onDelete,
  onRemoveTimeOff,
}: {
  member: StaffMember;
  /** Энэ салбарын ажилтныг өөрчлөх эрхтэй эсэх */
  canEdit: boolean;
  /** Чөлөө нь зөвхөн админд — хуанлийн цонхтой ижил дүрэм */
  isAdmin: boolean;
  isPending: boolean;
  onEdit: () => void;
  onTimeOff: () => void;
  onToggle: () => void;
  onDelete: () => void;
  onRemoveTimeOff: (id: string) => void;
}) {
  return (
    <article
      className={`flex flex-col rounded-xl border border-sand-200 bg-white p-4 ${
        member.isActive ? "" : "opacity-60"
      }`}
    >
      <div className="mb-3 flex items-center gap-2.5">
        <span
          aria-hidden
          className="flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-medium text-white"
          style={{ backgroundColor: member.color }}
        >
          {member.name.trim().slice(0, 2).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 truncate font-medium text-sand-900">
            {member.name}
            {!member.isActive ? (
              <span className="rounded bg-sand-200 px-1.5 py-0.5 text-xs font-normal text-sand-600">
                идэвхгүй
              </span>
            ) : null}
          </p>
          <p className="truncate text-xs text-sand-500">
            {[member.position, member.phone].filter(Boolean).join(" · ") || "—"}
          </p>
        </div>
      </div>

      {/* Долоо хоногийн хуваарь */}
      <div className="grid grid-cols-7 gap-1 text-center">
        {Array.from({ length: 7 }, (_, weekday) => {
          const shift = member.schedules.find((s) => s.weekday === weekday);
          const off = !shift || shift.isDayOff;
          return (
            <div key={weekday}>
              <p className="mb-1 text-[11px] text-sand-500">
                {WEEKDAYS_SHORT[weekday]}
              </p>
              <div
                title={
                  off
                    ? "Амралт"
                    : `${formatMinutes(shift.startMin)}–${formatMinutes(shift.endMin)}`
                }
                className={`rounded py-1 text-[10px] leading-tight ${
                  off ? "bg-sand-100 text-sand-400" : "bg-brand-50 text-brand-800"
                }`}
              >
                {off ? "—" : formatMinutes(shift.startMin)}
              </div>
            </div>
          );
        })}
      </div>

      {/* Ойрын чөлөө */}
      {member.timeOffs.length > 0 ? (
        <ul className="mt-3 space-y-1 border-t border-sand-100 pt-2 text-xs text-sand-600">
          {member.timeOffs.map((off) => (
            <li key={off.id} className="flex items-center justify-between gap-2">
              <span className="truncate">
                <span className="tabular-nums">{toDateKey(off.date)}</span>
                {" · "}
                {off.startMin == null
                  ? "Бүтэн өдөр"
                  : `${formatMinutes(off.startMin)}–${formatMinutes(off.endMin ?? 0)}`}
                {off.reason ? ` · ${off.reason}` : ""}
              </span>
              {canEdit ? (
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => onRemoveTimeOff(off.id)}
                  aria-label="Чөлөө хасах"
                  className="shrink-0 text-sand-400 transition hover:text-danger-600"
                >
                  ✕
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {canEdit ? (
        <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 border-t border-sand-100 pt-3 text-sm">
          <button
            type="button"
            onClick={onEdit}
            className="text-sand-600 hover:text-sand-900"
          >
            Засах
          </button>
          {isAdmin ? (
            <button
              type="button"
              onClick={onTimeOff}
              className="text-sand-600 hover:text-sand-900"
            >
              Чөлөө
            </button>
          ) : null}
          <button
            type="button"
            disabled={isPending}
            onClick={onToggle}
            className="text-sand-600 hover:text-sand-900"
          >
            {member.isActive ? "Идэвхгүй" : "Идэвхжүүлэх"}
          </button>
          {member._count.appointments > 0 ? (
            <span className="ml-auto self-center text-xs text-sand-400">
              {member._count.appointments} захиалга
            </span>
          ) : null}
          <button
            type="button"
            disabled={isPending}
            onClick={onDelete}
            className={`text-danger-600 hover:underline ${
              member._count.appointments > 0 ? "" : "ml-auto"
            }`}
          >
            Устгах
          </button>
        </div>
      ) : null}
    </article>
  );
}

/**
 * Ажилтан устгах баталгаажуулалт.
 *
 * Захиалгагүй ажилтан бол энгийн асуулт. Захиалгатай бол ЮУ УСТАХЫГ нь
 * шулуухан хэлж, «Идэвхгүй болгох» гэсэн аюулгүй гарцыг хамт санал болгоно —
 * ихэнх тохиолдолд ажилтан гарсан ч түүх нь үлдэх ёстой.
 */
function DeleteStaffModal({
  member,
  isAdmin,
  isPending,
  onClose,
  onDeactivate,
  onConfirm,
}: {
  member: StaffMember;
  /** Түүхтэй ажилтныг устгах нь зөвхөн админд — тайлангийн дүн өөрчлөгддөг */
  isAdmin: boolean;
  isPending: boolean;
  onClose: () => void;
  onDeactivate: () => void;
  onConfirm: () => void;
}) {
  const count = member._count.appointments;
  /** Захиалгын түүхтэй ажилтныг ресепшн устгахгүй — зөвхөн идэвхгүй болгоно. */
  const canDelete = count === 0 || isAdmin;

  return (
    <Modal
      title="Ажилтан устгах"
      onClose={onClose}
      footer={
        <>
          <GhostButton onClick={onClose}>Болих</GhostButton>
          {count > 0 && member.isActive ? (
            <GhostButton disabled={isPending} onClick={onDeactivate}>
              Идэвхгүй болгох
            </GhostButton>
          ) : null}
          {canDelete ? (
            <button
              type="button"
              disabled={isPending}
              onClick={onConfirm}
              className="rounded-xl bg-danger-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:brightness-95 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isPending ? "Устгаж байна…" : "Бүрмөсөн устгах"}
            </button>
          ) : null}
        </>
      }
    >
      <p className="text-sm text-sand-700">
        <strong className="font-medium text-sand-900">{member.name}</strong>
        {count === 0
          ? "-г бүрмөсөн устгах уу? Буцаах боломжгүй."
          : canDelete
            ? "-г бүрмөсөн устгах гэж байна."
            : ` нь ${count} захиалгатай тул зөвхөн админ устгана.`}
      </p>

      {count > 0 && !canDelete ? (
        <p className="mt-3 rounded-lg bg-sand-100 px-3 py-2.5 text-sm text-sand-600">
          Та «Идэвхгүй» болгож болно — тэр ажилтан хуанлид гарахгүй, шинэ
          захиалга ч авахгүй, харин өмнөх захиалгын түүх нь бүрэн үлдэнэ.
        </p>
      ) : null}

      {count > 0 && canDelete ? (
        <div className="mt-3 space-y-2 rounded-lg bg-danger-50 px-3 py-2.5 text-sm text-danger-700 ring-1 ring-danger-200">
          <p className="font-medium">
            {count} захиалга нь хамт устана — буцаах боломжгүй.
          </p>
          <ul className="list-inside list-disc space-y-0.5 text-[13px]">
            <li>Тухайн захиалгуудын үйлчилгээ, нэмэлт төлбөр</li>
            <li>Хүлээж авсан төлбөр, урьдчилгааны бичилтүүд</li>
            <li>Хамтарсан захиалга бол нөгөө мастерын мөр нь ч хамт</li>
          </ul>
          <p className="text-[13px]">
            Өнгөрсөн өдрүүдийн тайлангийн орлого ТҮҮНИЙ ХЭМЖЭЭГЭЭР буурна.
            Түүхээ хадгалах бол «Идэвхгүй» болгоно уу — тэр ажилтан хуанлид
            гарахгүй, шинэ захиалга ч авахгүй болно.
          </p>
        </div>
      ) : null}
    </Modal>
  );
}

function StaffModal({
  branches,
  branchId,
  member,
  onClose,
}: {
  branches: StaffAdmin;
  branchId: string;
  member: StaffMember | null;
  onClose: () => void;
}) {
  const [result, formAction, isPending] = useActionState<
    ActionResult | null,
    FormData
  >(saveStaff, null);

  const branch = branches.find((b) => b.id === branchId) ?? branches[0];
  const [color, setColor] = useState(member?.color ?? PRESET_COLORS[0]);

  // Шинэ ажилтны анхны хуваарь — салбарын ажлын цаг, Ням амралт
  const [shifts, setShifts] = useState(() =>
    Array.from({ length: 7 }, (_, weekday) => {
      const existing = member?.schedules.find((s) => s.weekday === weekday);
      if (existing) {
        return {
          isDayOff: existing.isDayOff,
          start: formatMinutes(existing.startMin),
          end: formatMinutes(existing.endMin),
        };
      }
      return {
        isDayOff: weekday === 0,
        start: formatMinutes(branch?.openMin ?? 600),
        end: formatMinutes(branch?.closeMin ?? 1140),
      };
    }),
  );

  useEffect(() => {
    if (result?.ok) onClose();
  }, [result, onClose]);

  function update(weekday: number, patch: Partial<(typeof shifts)[number]>) {
    setShifts((current) =>
      current.map((s, i) => (i === weekday ? { ...s, ...patch } : s)),
    );
  }

  /** Нэг өдрийн цагийг бүх ажлын өдөрт хуулна. */
  function applyToAll(weekday: number) {
    const source = shifts[weekday];
    setShifts((current) =>
      current.map((s) =>
        s.isDayOff ? s : { ...s, start: source.start, end: source.end },
      ),
    );
  }

  return (
    <Modal
      title={member ? "Ажилтан засах" : "Шинэ ажилтан"}
      onClose={onClose}
      wide
      footer={
        <>
          <GhostButton type="button" onClick={onClose}>
            Болих
          </GhostButton>
          <PrimaryButton type="submit" form="staff-form" disabled={isPending}>
            {isPending ? "Хадгалж байна…" : "Хадгалах"}
          </PrimaryButton>
        </>
      }
    >
      <form id="staff-form" action={formAction} className="space-y-5">
        {member ? <input type="hidden" name="id" value={member.id} /> : null}
        <input type="hidden" name="color" value={color} />

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Нэр">
            <input
              name="name"
              defaultValue={member?.name ?? ""}
              required
              autoFocus
              placeholder="Жишээ: Сарнай"
              className={inputClass}
            />
          </Field>

          <Field label="Утас">
            <input
              name="phone"
              type="tel"
              inputMode="numeric"
              defaultValue={member?.phone ?? ""}
              placeholder="99xxxxxx"
              className={inputClass}
            />
          </Field>

          <Field label="Албан тушаал">
            <input
              name="position"
              defaultValue={member?.position ?? "Маникюрист"}
              className={inputClass}
            />
          </Field>

          <Field label="Салбар">
            <select
              name="branchId"
              defaultValue={branchId}
              className={inputClass}
            >
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div>
          <span className="mb-1.5 block text-sm font-medium text-sand-800">
            Хуанли дээрх өнгө
          </span>
          <div className="flex flex-wrap gap-1.5">
            {PRESET_COLORS.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => setColor(preset)}
                aria-label={`Өнгө ${preset}`}
                aria-pressed={color === preset}
                className={`size-7 rounded-full transition ${
                  color === preset
                    ? "ring-2 ring-sand-800 ring-offset-2"
                    : "hover:scale-110"
                }`}
                style={{ backgroundColor: preset }}
              />
            ))}
          </div>
        </div>

        {/* ── Долоо хоногийн хуваарь ── */}
        <div>
          <span className="mb-2 block text-sm font-medium text-sand-800">
            Долоо хоногийн хуваарь
          </span>
          <div className="space-y-1.5">
            {shifts.map((shift, weekday) => (
              <div
                key={weekday}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-sand-200 px-3 py-2"
              >
                <span className="w-16 shrink-0 text-sm text-sand-700">
                  {WEEKDAYS[weekday]}
                </span>

                <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-sm text-sand-600">
                  <input
                    type="checkbox"
                    name={`dayOff-${weekday}`}
                    checked={shift.isDayOff}
                    onChange={(event) =>
                      update(weekday, { isDayOff: event.target.checked })
                    }
                    className="size-4 accent-brand-600"
                  />
                  Амралт
                </label>

                {!shift.isDayOff ? (
                  <>
                    <input
                      type="time"
                      name={`start-${weekday}`}
                      step={900}
                      value={shift.start}
                      onChange={(event) =>
                        update(weekday, { start: event.target.value })
                      }
                      className="rounded-lg border border-sand-300 px-2 py-1 text-sm outline-none focus:border-brand-500"
                    />
                    <span className="text-sand-400">–</span>
                    <input
                      type="time"
                      name={`end-${weekday}`}
                      step={900}
                      value={shift.end}
                      onChange={(event) =>
                        update(weekday, { end: event.target.value })
                      }
                      className="rounded-lg border border-sand-300 px-2 py-1 text-sm outline-none focus:border-brand-500"
                    />
                    <button
                      type="button"
                      onClick={() => applyToAll(weekday)}
                      className="ml-auto text-xs text-brand-700 hover:underline"
                    >
                      Бүх өдөрт
                    </button>
                  </>
                ) : (
                  <>
                    {/* Амралтын өдөрт ч сервер рүү утга явуулна */}
                    <input type="hidden" name={`start-${weekday}`} value={shift.start} />
                    <input type="hidden" name={`end-${weekday}`} value={shift.end} />
                  </>
                )}
              </div>
            ))}
          </div>
        </div>

        {result && !result.ok ? <Issues issues={result.issues} /> : null}
      </form>
    </Modal>
  );
}

function TimeOffModal({
  member,
  onClose,
}: {
  member: StaffMember;
  onClose: () => void;
}) {
  const [result, formAction, isPending] = useActionState<
    ActionResult | null,
    FormData
  >(addTimeOff, null);
  const [wholeDay, setWholeDay] = useState(true);

  useEffect(() => {
    if (result?.ok) onClose();
  }, [result, onClose]);

  return (
    <Modal
      title={`${member.name} — чөлөө нэмэх`}
      onClose={onClose}
      footer={
        <>
          <GhostButton type="button" onClick={onClose}>
            Болих
          </GhostButton>
          <PrimaryButton type="submit" form="timeoff-form" disabled={isPending}>
            {isPending ? "Хадгалж байна…" : "Нэмэх"}
          </PrimaryButton>
        </>
      }
    >
      <form id="timeoff-form" action={formAction} className="space-y-4">
        <input type="hidden" name="staffId" value={member.id} />

        <Field label="Огноо">
          <input
            type="date"
            name="date"
            defaultValue={todayKey()}
            required
            className={inputClass}
          />
        </Field>

        <label className="flex cursor-pointer items-center gap-2.5">
          <input
            type="checkbox"
            name="wholeDay"
            checked={wholeDay}
            onChange={(event) => setWholeDay(event.target.checked)}
            className="size-4 accent-brand-600"
          />
          <span className="text-sm font-medium text-sand-800">Бүтэн өдөр</span>
        </label>

        {!wholeDay ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Эхлэх">
              <input
                type="time"
                name="startTime"
                step={900}
                defaultValue="12:00"
                className={inputClass}
              />
            </Field>
            <Field label="Дуусах">
              <input
                type="time"
                name="endTime"
                step={900}
                defaultValue="13:00"
                className={inputClass}
              />
            </Field>
          </div>
        ) : null}

        <Field label="Шалтгаан">
          <input
            name="reason"
            placeholder="Жишээ: Чөлөө, Өвчтэй, Сургалт"
            className={inputClass}
          />
        </Field>

        {result && !result.ok ? <Issues issues={result.issues} /> : null}
      </form>
    </Modal>
  );
}
