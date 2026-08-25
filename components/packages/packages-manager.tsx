"use client";

import { useActionState, useEffect, useMemo, useState, useTransition } from "react";
import type { PackageAdmin, ServiceAdmin } from "@/lib/queries";
import { formatDuration, formatPrice } from "@/lib/labels";
import { effectivePrice } from "@/lib/pricing";
import type { ActionResult } from "@/lib/action-result";
import {
  deletePackage,
  savePackage,
  togglePackage,
} from "@/app/(app)/packages/actions";
import { PageHeader } from "@/components/page-header";
import { Modal } from "@/components/ui/modal";
import {
  Field,
  GhostButton,
  Issues,
  PrimaryButton,
  inputClass,
} from "@/components/ui/form";

type Pkg = PackageAdmin[number];

const PRESET_COLORS = [
  "#c0798c",
  "#c09b5c",
  "#4f7355",
  "#8b7ba8",
  "#7fa2c0",
  "#6ba39b",
  "#c08a5e",
  "#a39887",
];

export function PackagesManager({
  packages,
  categories,
  canEdit,
}: {
  packages: PackageAdmin;
  categories: ServiceAdmin;
  canEdit: boolean;
}) {
  const [editing, setEditing] = useState<{ pkg: Pkg | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function run(action: () => Promise<ActionResult>) {
    startTransition(async () => {
      const result = await action();
      setError(result.ok ? null : result.issues.join(" "));
    });
  }

  const activeCount = packages.filter((p) => p.isActive).length;

  return (
    <>
      <PageHeader
        title="Багц"
        subtitle={`${packages.length} багц${
          canEdit && activeCount !== packages.length
            ? ` · ${activeCount} идэвхтэй`
            : ""
        }`}
        action={
          canEdit ? (
            <PrimaryButton onClick={() => setEditing({ pkg: null })}>
              + Багц нэмэх
            </PrimaryButton>
          ) : null
        }
      />

      <div className="min-h-0 flex-1 overflow-auto scrollbar-slim p-4 md:p-6">
        {error ? (
          <div className="mb-4">
            <Issues issues={[error]} />
          </div>
        ) : null}

        {packages.length === 0 ? (
          <p className="rounded-xl border border-sand-200 bg-white px-4 py-10 text-center text-sand-500">
            Багц бүртгэгдээгүй байна.
            {canEdit
              ? " Хэд хэдэн үйлчилгээг нэг хямд үнээр нийлүүлж багц үүсгэнэ үү."
              : ""}
          </p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {packages.map((pkg) => (
              <PackageCard
                key={pkg.id}
                pkg={pkg}
                canEdit={canEdit}
                isPending={isPending}
                onEdit={() => setEditing({ pkg })}
                onToggle={() => run(() => togglePackage(pkg.id, !pkg.isActive))}
                onDelete={() => {
                  if (confirm(`«${pkg.name}» багцыг устгах уу?`)) {
                    run(() => deletePackage(pkg.id));
                  }
                }}
              />
            ))}
          </div>
        )}
      </div>

      {editing ? (
        <PackageModal
          pkg={editing.pkg}
          categories={categories}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </>
  );
}

/** Багцын үйлчилгээнүүдийн жагсаалтын үнэ ба хэмнэлт. */
function packageMath(pkg: Pkg) {
  const listTotal = pkg.items.reduce(
    (sum, item) => sum + effectivePrice(item.service),
    0,
  );
  const duration = pkg.items.reduce(
    (sum, item) => sum + item.service.durationMin,
    0,
  );
  const saving = Math.max(0, listTotal - pkg.price);
  const percent = listTotal > 0 ? Math.round((saving / listTotal) * 100) : 0;
  return { listTotal, duration, saving, percent };
}

function PackageCard({
  pkg,
  canEdit,
  isPending,
  onEdit,
  onToggle,
  onDelete,
}: {
  pkg: Pkg;
  canEdit: boolean;
  isPending: boolean;
  onEdit: () => void;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const { listTotal, duration, saving, percent } = packageMath(pkg);
  const color = pkg.color ?? "#a39887";

  return (
    <article
      className={`flex flex-col overflow-hidden rounded-xl border bg-white ${
        pkg.isActive ? "border-sand-200" : "border-sand-200 opacity-60"
      }`}
    >
      <div className="h-1" style={{ backgroundColor: color }} />

      <div className="flex flex-1 flex-col p-4">
        <div className="flex items-start justify-between gap-2">
          <h2 className="font-serif text-base text-sand-900">{pkg.name}</h2>
          <span className="flex shrink-0 items-center gap-1.5">
            {!pkg.isActive ? (
              <span className="rounded bg-sand-200 px-1.5 py-0.5 text-xs text-sand-600">
                идэвхгүй
              </span>
            ) : null}
            <span className="rounded bg-sand-100 px-1.5 py-0.5 text-xs tabular-nums text-sand-500">
              {formatDuration(duration)}
            </span>
          </span>
        </div>

        <p className="mt-1 min-h-[1.25rem] text-sm text-sand-600">
          {pkg.description ?? ""}
        </p>

        {/* Үйлчилгээний жагсаалт сунаж, доорх блокуудыг картын ёроолд түлхэнэ —
            ингэснээр өөр өөр тооны үйлчилгээтэй картууд эгнэж харагдана. */}
        <ul className="mt-3 flex-1 space-y-1 text-sm">
          {pkg.items.map((item) => (
            <li
              key={item.serviceId}
              className="flex justify-between gap-2 text-sand-700"
            >
              <span className="truncate">{item.service.name}</span>
              <span className="shrink-0 tabular-nums text-sand-500">
                {formatPrice(effectivePrice(item.service))}
              </span>
            </li>
          ))}
        </ul>

        <dl className="mt-3 space-y-1 border-t border-sand-100 pt-3 text-sm">
          {saving > 0 ? (
            <div className="flex justify-between">
              <dt className="text-sand-500">Тусад нь</dt>
              <dd className="tabular-nums text-sand-400 line-through">
                {formatPrice(listTotal)}
              </dd>
            </div>
          ) : null}
          <div className="flex items-baseline justify-between">
            <dt className="text-sand-600">Багцын үнэ</dt>
            <dd className="text-lg font-semibold tabular-nums text-sand-900">
              {formatPrice(pkg.price)}
            </dd>
          </div>
        </dl>

        {saving > 0 ? (
          <p className="mt-2 rounded-lg bg-brand-100 px-2.5 py-1.5 text-center text-xs font-medium text-brand-800">
            {formatPrice(saving)} хэмнэнэ · −{percent}%
          </p>
        ) : null}

        {canEdit ? (
          <div className="mt-3 flex gap-3 border-t border-sand-100 pt-3 text-sm">
            <button
              type="button"
              onClick={onEdit}
              className="text-sand-600 hover:text-sand-900"
            >
              Засах
            </button>
            <button
              type="button"
              disabled={isPending}
              onClick={onToggle}
              className="text-sand-600 hover:text-sand-900"
            >
              {pkg.isActive ? "Идэвхгүй" : "Идэвхжүүлэх"}
            </button>
            {pkg._count.appointments === 0 ? (
              <button
                type="button"
                disabled={isPending}
                onClick={onDelete}
                className="ml-auto text-[#9a5555] hover:underline"
              >
                Устгах
              </button>
            ) : (
              <span className="ml-auto text-xs text-sand-400">
                {pkg._count.appointments} захиалгад
              </span>
            )}
          </div>
        ) : null}
      </div>
    </article>
  );
}

function PackageModal({
  pkg,
  categories,
  onClose,
}: {
  pkg: Pkg | null;
  categories: ServiceAdmin;
  onClose: () => void;
}) {
  const [result, formAction, isPending] = useActionState<
    ActionResult | null,
    FormData
  >(savePackage, null);

  const [serviceIds, setServiceIds] = useState<string[]>(
    () => pkg?.items.map((item) => item.serviceId) ?? [],
  );
  const [color, setColor] = useState(pkg?.color ?? PRESET_COLORS[0]);
  const [price, setPrice] = useState<string>(pkg ? String(pkg.price) : "");

  useEffect(() => {
    if (result?.ok) onClose();
  }, [result, onClose]);

  const allServices = useMemo(
    () =>
      categories.flatMap((category) =>
        category.services
          .filter((service) => service.isActive)
          .map((service) => ({ ...service, categoryName: category.name, categoryColor: category.color })),
      ),
    [categories],
  );

  const selected = serviceIds
    .map((id) => allServices.find((s) => s.id === id))
    .filter((s): s is (typeof allServices)[number] => Boolean(s));

  const listTotal = selected.reduce((sum, s) => sum + effectivePrice(s), 0);
  const duration = selected.reduce((sum, s) => sum + s.durationMin, 0);
  const priceNumber = Number(price.replace(/\D/g, "")) || 0;
  const saving = Math.max(0, listTotal - priceNumber);
  const percent = listTotal > 0 ? Math.round((saving / listTotal) * 100) : 0;

  return (
    <Modal
      title={pkg ? "Багц засах" : "Шинэ багц"}
      onClose={onClose}
      wide
      footer={
        <>
          <GhostButton type="button" onClick={onClose}>
            Болих
          </GhostButton>
          <PrimaryButton
            type="submit"
            form="package-form"
            disabled={isPending || serviceIds.length < 2}
          >
            {isPending ? "Хадгалж байна…" : "Хадгалах"}
          </PrimaryButton>
        </>
      }
    >
      <form id="package-form" action={formAction} className="space-y-4">
        {pkg ? <input type="hidden" name="id" value={pkg.id} /> : null}
        <input type="hidden" name="color" value={color} />
        {serviceIds.map((id) => (
          <input key={id} type="hidden" name="serviceIds" value={id} />
        ))}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Багцын нэр">
            <input
              name="name"
              defaultValue={pkg?.name ?? ""}
              required
              autoFocus
              placeholder="Жишээ: Гар хөлний иж бүрдэл"
              className={inputClass}
            />
          </Field>

          <Field label="Багцын үнэ (₮)" hint="Жагсаалтын нийлбэрээс бага байна">
            <input
              name="price"
              type="number"
              min={0}
              step={1000}
              value={price}
              onChange={(event) => setPrice(event.target.value)}
              required
              className={inputClass}
            />
          </Field>
        </div>

        <Field label="Тайлбар">
          <input
            name="description"
            defaultValue={pkg?.description ?? ""}
            placeholder="Сурталчилгаанд харагдах богино тайлбар"
            className={inputClass}
          />
        </Field>

        {/* ── Үйлчилгээ сонгох ── */}
        <div>
          <span className="mb-2 block text-sm font-medium text-sand-800">
            Багцад орох үйлчилгээ
            <span className="ml-2 font-normal text-sand-500">
              {selected.length} сонгосон
            </span>
          </span>

          <div className="max-h-64 space-y-3 overflow-y-auto scrollbar-slim rounded-xl border border-sand-200 p-3">
            {categories.map((category) => {
              const services = category.services.filter((s) => s.isActive);
              if (services.length === 0) return null;
              return (
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
                    {services.map((service) => {
                      const active = serviceIds.includes(service.id);
                      const dotColor = service.color ?? category.color;
                      return (
                        <button
                          key={service.id}
                          type="button"
                          aria-pressed={active}
                          onClick={() =>
                            setServiceIds((current) =>
                              active
                                ? current.filter((id) => id !== service.id)
                                : [...current, service.id],
                            )
                          }
                          className={`rounded-lg border px-3 py-2 text-left text-xs transition hover:bg-sand-50 ${
                            active ? "" : "border-sand-300 text-sand-700"
                          }`}
                          style={
                            active
                              ? {
                                  borderColor: dotColor,
                                  backgroundColor: `color-mix(in srgb, ${dotColor} 10%, white)`,
                                }
                              : undefined
                          }

                        >
                          <span
                            className="block font-medium"
                            style={{ color: active ? dotColor : undefined }}
                          >
                            {service.name}
                          </span>
                          <span className="block text-[11px] text-sand-500">
                            {formatDuration(service.durationMin)} ·{" "}
                            {formatPrice(effectivePrice(service))}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Тооцоо ── */}
        {selected.length > 0 ? (
          <div className="rounded-xl bg-sand-100/70 px-4 py-3 text-sm">
            <p className="flex justify-between text-sand-600">
              <span>Тусад нь авбал</span>
              <span className="tabular-nums">{formatPrice(listTotal)}</span>
            </p>
            <p className="flex justify-between text-sand-600">
              <span>Нийт хугацаа</span>
              <span className="tabular-nums">{formatDuration(duration)}</span>
            </p>
            <p className="mt-1 flex justify-between border-t border-sand-200 pt-1 font-medium text-sand-900">
              <span>Багцын үнэ</span>
              <span className="tabular-nums">{formatPrice(priceNumber)}</span>
            </p>
            {saving > 0 ? (
              <p className="mt-0.5 flex justify-between font-medium text-[#3e5a47]">
                <span>Хэмнэлт</span>
                <span className="tabular-nums">
                  {formatPrice(saving)} · −{percent}%
                </span>
              </p>
            ) : null}
          </div>
        ) : null}

        <ColorRow value={color} onChange={setColor} />

        {result && !result.ok ? <Issues issues={result.issues} /> : null}
      </form>
    </Modal>
  );
}

function ColorRow({
  value,
  onChange,
}: {
  value: string;
  onChange: (color: string) => void;
}) {
  return (
    <div>
      <span className="mb-1.5 block text-sm font-medium text-sand-800">Өнгө</span>
      <div className="flex flex-wrap gap-1.5">
        {PRESET_COLORS.map((preset) => (
          <button
            key={preset}
            type="button"
            onClick={() => onChange(preset)}
            aria-label={`Өнгө ${preset}`}
            aria-pressed={value === preset}
            className={`size-7 rounded-full transition ${
              value === preset
                ? "ring-2 ring-sand-800 ring-offset-2"
                : "hover:scale-110"
            }`}
            style={{ backgroundColor: preset }}
          />
        ))}
      </div>
    </div>
  );
}
