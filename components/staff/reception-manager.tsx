"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import type { StaffAdmin, UserRow, UsersAdmin } from "@/lib/queries";
import { ROLE_LABELS } from "@/lib/labels";
import {
  deleteUser,
  resetUserPassword,
  saveUser,
  toggleUser,
  type UserActionResult,
} from "@/app/(app)/staff/user-actions";
import { Modal } from "@/components/ui/modal";
import {
  Field,
  GhostButton,
  Issues,
  PrimaryButton,
  inputClass,
} from "@/components/ui/form";

/**
 * Системд нэвтрэх эрх удирдах хэсэг.
 *
 * Ажилтан (Staff) ба нэвтрэх эрх (User) хоёр ӨӨР зүйл гэдгийг UI дээр
 * тодорхой салгасан — мастер бүр нэвтрэх эрхтэй байх шаардлагагүй,
 * ресепшн хуанли дээр багана эзэлдэггүй.
 */
export function ReceptionSection({
  users,
  branches,
  canEdit,
}: {
  users: UsersAdmin;
  branches: StaffAdmin;
  canEdit: boolean;
}) {
  const [editing, setEditing] = useState<UserRow | null | "new">(null);
  const [credential, setCredential] = useState<
    { name: string; phone: string; password: string } | null
  >(null);
  const [error, setError] = useState<string[] | null>(null);
  const [isPending, startTransition] = useTransition();

  if (!canEdit) return null;

  function run(action: () => Promise<UserActionResult>) {
    startTransition(async () => {
      const result = await action();
      setError(result.ok ? null : result.issues);
    });
  }

  const active = users.filter((u) => u.isActive).length;

  return (
    <section>
      <div className="mb-2 flex items-center gap-2">
        <h2 className="font-serif text-base text-sand-900">Нэвтрэх эрх</h2>
        <span className="text-sm text-sand-500">
          {users.length} хэрэглэгч
          {active !== users.length ? ` · ${active} идэвхтэй` : ""}
        </span>
        <button
          type="button"
          onClick={() => setEditing("new")}
          className="ml-auto text-sm text-brand-700 hover:underline"
        >
          + Ресепшн нэмэх
        </button>
      </div>

      <p className="mb-3 text-xs text-sand-500">
        Хуанли дээрх мастеруудаас тусдаа. Энд байгаа хүмүүс системд нэвтэрч
        захиалга бүртгэнэ.
      </p>

      {error ? (
        <div className="mb-3">
          <Issues issues={error} />
        </div>
      ) : null}

      <div className="scrollbar-slim overflow-x-auto rounded-xl border border-sand-200 bg-white">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="border-b border-sand-200 bg-sand-50 text-left text-xs text-sand-600">
            <tr>
              <th className="px-4 py-2 font-medium">Нэр</th>
              <th className="w-28 px-4 py-2 font-medium">Утас</th>
              <th className="w-24 px-4 py-2 font-medium">Эрх</th>
              <th className="w-36 px-4 py-2 font-medium">Салбар</th>
              <th className="w-28 px-4 py-2 font-medium">Төлөв</th>
              <th className="w-52 px-4 py-2 text-right font-medium">Үйлдэл</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-sand-100">
            {users.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-sand-500">
                  Нэвтрэх эрхтэй хэрэглэгч алга.
                </td>
              </tr>
            ) : (
              users.map((user) => (
                <tr
                  key={user.id}
                  className={user.isActive ? "" : "bg-sand-50/60 text-sand-500"}
                >
                  <td className="px-4 py-2.5 font-medium text-sand-900">
                    {user.name}
                  </td>
                  <td className="px-4 py-2.5 tabular-nums">{user.phone}</td>
                  <td className="px-4 py-2.5">
                    <span
                      className={`rounded-md px-1.5 py-0.5 text-xs ${
                        user.role === "ADMIN"
                          ? "bg-brand-100 text-brand-800"
                          : "bg-sand-100 text-sand-700"
                      }`}
                    >
                      {ROLE_LABELS[user.role]}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-sand-600">
                    {user.branch?.name ?? "—"}
                  </td>
                  <td className="px-4 py-2.5 text-xs">
                    {!user.isActive ? (
                      <span className="text-sand-500">Идэвхгүй</span>
                    ) : user.mustChangePassword ? (
                      <span className="text-[#8a6d3b]">Нууц үг солиогүй</span>
                    ) : user.lastLoginAt ? (
                      <span className="text-sand-500">Нэвтэрсэн</span>
                    ) : (
                      <span className="text-sand-400">Нэвтрээгүй</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1 text-xs">
                      <button
                        type="button"
                        disabled={isPending}
                        onClick={() => setEditing(user)}
                        className="text-brand-700 hover:underline disabled:opacity-50"
                      >
                        Засах
                      </button>
                      <button
                        type="button"
                        disabled={isPending}
                        onClick={() => {
                          if (
                            confirm(
                              `«${user.name}»-д шинэ түр нууц үг үүсгэх үү?\n\nХуучин нууц үг ажиллахаа болино.`,
                            )
                          ) {
                            startTransition(async () => {
                              const result = await resetUserPassword(user.id);
                              if (result.ok && result.tempPassword) {
                                setError(null);
                                setCredential({
                                  name: user.name,
                                  phone: user.phone,
                                  password: result.tempPassword,
                                });
                              } else if (!result.ok) {
                                setError(result.issues);
                              }
                            });
                          }
                        }}
                        className="text-sand-600 hover:underline disabled:opacity-50"
                      >
                        Нууц үг сэргээх
                      </button>
                      <button
                        type="button"
                        disabled={isPending}
                        onClick={() =>
                          run(() => toggleUser(user.id, !user.isActive))
                        }
                        className="text-sand-600 hover:underline disabled:opacity-50"
                      >
                        {user.isActive ? "Идэвхгүй" : "Идэвхжүүлэх"}
                      </button>
                      <button
                        type="button"
                        disabled={isPending}
                        onClick={() => {
                          if (
                            confirm(`«${user.name}»-г бүрмөсөн устгах уу?`)
                          ) {
                            run(() => deleteUser(user.id));
                          }
                        }}
                        className="text-[#9a4b4b] hover:underline disabled:opacity-50"
                      >
                        Устгах
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {editing ? (
        <UserModal
          user={editing === "new" ? null : editing}
          branches={branches}
          onClose={() => setEditing(null)}
          onCreated={(info) => {
            setEditing(null);
            setCredential(info);
          }}
        />
      ) : null}

      {credential ? (
        <CredentialModal
          {...credential}
          onClose={() => setCredential(null)}
        />
      ) : null}
    </section>
  );
}

// ─────────────────────────── Нэмэх / засах цонх ───────────────────────

function UserModal({
  user,
  branches,
  onClose,
  onCreated,
}: {
  user: UserRow | null;
  branches: StaffAdmin;
  onClose: () => void;
  onCreated: (info: {
    name: string;
    phone: string;
    password: string;
  }) => void;
}) {
  const [state, formAction, isPending] = useActionState<
    UserActionResult | null,
    FormData
  >(saveUser, null);

  const [name, setName] = useState(user?.name ?? "");
  const [phone, setPhone] = useState(user?.phone ?? "");

  useEffect(() => {
    if (!state?.ok) return;
    // Шинээр үүсгэсэн бол түр нууц үгийг админд харуулна
    if (state.tempPassword) {
      onCreated({ name, phone, password: state.tempPassword });
    } else {
      onClose();
    }
    // Хариу нэг л удаа боловсруулагдана
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <Modal
      title={user ? `${user.name} — засах` : "Ресепшн нэмэх"}
      onClose={onClose}
      footer={
        <>
          <GhostButton type="button" onClick={onClose} disabled={isPending}>
            Болих
          </GhostButton>
          <PrimaryButton type="submit" form="user-form" disabled={isPending}>
            {isPending ? "Хадгалж байна…" : user ? "Хадгалах" : "Нэмэх"}
          </PrimaryButton>
        </>
      }
    >
      <form id="user-form" action={formAction} className="space-y-4">
        {user ? <input type="hidden" name="id" value={user.id} /> : null}

        {state && !state.ok ? <Issues issues={state.issues} /> : null}

        <Field label="Нэр">
          <input
            name="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoFocus
            placeholder="Болормаа"
            className={inputClass}
          />
        </Field>

        <Field
          label="Утасны дугаар"
          hint="Энэ дугаараар системд нэвтэрнэ. 8 оронтой."
        >
          <input
            name="phone"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            required
            type="tel"
            inputMode="numeric"
            placeholder="99104657"
            className={inputClass}
          />
        </Field>

        <Field
          label="Эрх"
          hint="Ресепшн захиалга бүртгэнэ. Админ нэмээд тохиргоо, үнэ, ажилтан өөрчилнө."
        >
          <select
            name="role"
            defaultValue={user?.role ?? "RECEPTION"}
            className={inputClass}
          >
            <option value="RECEPTION">Ресепшн</option>
            <option value="ADMIN">Админ</option>
          </select>
        </Field>

        <Field
          label="Үндсэн салбар"
          hint="Нэвтрэхэд анхны сонголт болно. Бүх салбарын захиалгыг харна."
        >
          <select
            name="branchId"
            defaultValue={user?.branchId ?? ""}
            className={inputClass}
          >
            <option value="">— сонгоогүй —</option>
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name}
              </option>
            ))}
          </select>
        </Field>

        {!user ? (
          <p className="rounded-lg bg-sand-100 px-3 py-2.5 text-xs text-sand-600">
            Хадгалахад систем <strong>түр нууц үг</strong> үүсгэж харуулна.
            Түүнийг ажилтандаа хэлж өгнө. Тэр хүн анх нэвтрэхдээ өөрийн нууц
            үгээ заавал шинээр тохируулна.
          </p>
        ) : null}
      </form>
    </Modal>
  );
}

// ──────────────────────── Түр нууц үг харуулах цонх ───────────────────

function CredentialModal({
  name,
  phone,
  password,
  onClose,
}: {
  name: string;
  phone: string;
  password: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <Modal
      title="Түр нууц үг"
      onClose={onClose}
      footer={
        <PrimaryButton type="button" onClick={onClose}>
          Хаах
        </PrimaryButton>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-sand-700">
          <strong>{name}</strong>-д доорх мэдээллийг хэлж өгнө үү. Энэ нууц үг{" "}
          <strong>дахин харагдахгүй</strong> — цонхыг хаахаас өмнө тэмдэглэж
          аваарай.
        </p>

        <dl className="divide-y divide-sand-200 rounded-xl border border-sand-200">
          <div className="flex items-center justify-between px-4 py-3">
            <dt className="text-sm text-sand-600">Нэвтрэх дугаар</dt>
            <dd className="font-mono text-base tabular-nums text-sand-900">
              {phone}
            </dd>
          </div>
          <div className="flex items-center justify-between px-4 py-3">
            <dt className="text-sm text-sand-600">Түр нууц үг</dt>
            <dd className="font-mono text-lg tracking-wider text-sand-900">
              {password}
            </dd>
          </div>
        </dl>

        <button
          type="button"
          onClick={() => {
            navigator.clipboard
              ?.writeText(`Дугаар: ${phone}\nНууц үг: ${password}`)
              .then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              })
              .catch(() => undefined);
          }}
          className="w-full rounded-xl border border-sand-300 px-4 py-2 text-sm text-sand-700 transition hover:bg-sand-100"
        >
          {copied ? "✓ Хуулагдлаа" : "Хуулах"}
        </button>

        <p className="text-xs text-sand-500">
          Тэр хүн анх нэвтрэхэд систем нууц үгээ солихыг шаардана. Мартвал энэ
          хүснэгтээс «Нууц үг сэргээх» дарж шинийг үүсгэнэ.
        </p>
      </div>
    </Modal>
  );
}
