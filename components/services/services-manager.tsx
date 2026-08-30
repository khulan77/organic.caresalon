"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import type { ServiceAdmin } from "@/lib/queries";
import { formatDuration, formatPrice } from "@/lib/labels";
import { isSaleActive, salePercent } from "@/lib/pricing";
import { toDateKey } from "@/lib/time";
import type { ActionResult } from "@/lib/action-result";
import {
  deleteCategory,
  deleteService,
  saveCategory,
  saveService,
} from "@/app/(app)/services/actions";
import { PageHeader } from "@/components/page-header";
import { Modal } from "@/components/ui/modal";
import {
  Field,
  GhostButton,
  Issues,
  PrimaryButton,
  inputClass,
} from "@/components/ui/form";

type Category = ServiceAdmin[number];
type Service = Category["services"][number];
type BranchOption = { id: string; name: string };

/** Салбарын шүүлтүүрийн утга: null = бүгд, "" = зөвхөн нийтлэг. */
type BranchFilter = string | null;

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
  | { kind: "category"; category: Category | null }
  | { kind: "service"; categoryId: string; service: Service | null }
  | null;

export function ServicesManager({
  categories: allCategories,
  branches,
  canEdit,
}: {
  categories: ServiceAdmin;
  branches: BranchOption[];
  canEdit: boolean;
}) {
  const [editing, setEditing] = useState<Editing>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [branchFilter, setBranchFilter] = useState<BranchFilter>(null);

  /**
   * Салбараар шүүсэн жагсаалт. Нийтлэг үйлчилгээ (branchId = null) нь
   * салбар сонгосон үед ч харагдана — тэр салбарт бодитоор захиалагдана.
   */
  const categories =
    branchFilter === null
      ? allCategories
      : allCategories.map((category) => ({
          ...category,
          services: category.services.filter(
            (service) =>
              service.branchId === null || service.branchId === branchFilter,
          ),
        }));

  const totalServices = categories.reduce((sum, c) => sum + c.services.length, 0);
  const onSale = categories
    .flatMap((c) => c.services)
    .filter((s) => isSaleActive(s)).length;

  function run(action: () => Promise<ActionResult>) {
    startTransition(async () => {
      const result = await action();
      setError(result.ok ? null : result.issues.join(" "));
    });
  }

  return (
    <>
      <PageHeader
        title="Үйлчилгээ ба үнэ"
        subtitle={`${categories.length} ангилал · ${totalServices} үйлчилгээ${
          onSale > 0 ? ` · ${onSale} хямдралтай` : ""
        }`}
        action={
          canEdit ? (
            <div className="flex gap-2">
              <GhostButton
                onClick={() => setEditing({ kind: "category", category: null })}
              >
                + Ангилал
              </GhostButton>
              <PrimaryButton
                disabled={categories.length === 0}
                onClick={() =>
                  setEditing({
                    kind: "service",
                    categoryId: categories[0]?.id ?? "",
                    service: null,
                  })
                }
              >
                + Үйлчилгээ
              </PrimaryButton>
            </div>
          ) : null
        }
      />

      {branches.length > 1 ? (
        <div className="scrollbar-slim flex shrink-0 items-center gap-2 overflow-x-auto border-b border-sand-200 bg-sand-50 px-4 py-2.5 md:px-6">
          <span className="shrink-0 text-xs text-sand-500">Салбар</span>
          <div className="flex shrink-0 items-center gap-1 rounded-full bg-sand-200/70 p-1">
            <FilterPill
              active={branchFilter === null}
              onClick={() => setBranchFilter(null)}
            >
              Бүгд
            </FilterPill>
            {branches.map((branch) => (
              <FilterPill
                key={branch.id}
                active={branchFilter === branch.id}
                onClick={() => setBranchFilter(branch.id)}
              >
                {branch.name}
              </FilterPill>
            ))}
          </div>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto scrollbar-slim p-4 md:p-6">
        {error ? (
          <div className="mb-4">
            <Issues issues={[error]} />
          </div>
        ) : null}

        {categories.length === 0 ? (
          <p className="rounded-xl border border-sand-200 bg-white px-4 py-10 text-center text-sand-500">
            Ангилал бүртгэгдээгүй байна.
            {canEdit ? " Дээрх «+ Ангилал» товчоор эхлүүлнэ үү." : ""}
          </p>
        ) : (
          <div className="space-y-6">
            {categories.map((category) => (
              <section key={category.id}>
                <div className="mb-2 flex items-center gap-2">
                  <span
                    aria-hidden
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: category.color }}
                  />
                  <h2 className="font-serif text-base text-sand-900">
                    {category.name}
                  </h2>
                  <span className="text-sm text-sand-400">
                    {category.services.length}
                  </span>
                  {canEdit ? (
                    <div className="ml-auto flex gap-3 text-sm">
                      <button
                        type="button"
                        onClick={() =>
                          setEditing({ kind: "service", categoryId: category.id, service: null })
                        }
                        className="text-brand-700 hover:underline"
                      >
                        + Үйлчилгээ
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditing({ kind: "category", category })}
                        className="text-sand-500 hover:text-sand-800"
                      >
                        Засах
                      </button>
                      {category.services.length === 0 ? (
                        <button
                          type="button"
                          disabled={isPending}
                          onClick={() => run(() => deleteCategory(category.id))}
                          className="text-danger-600 hover:underline"
                        >
                          Устгах
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>

                {category.services.length === 0 ? (
                  <p className="rounded-2xl border border-dashed border-sand-300 px-4 py-5 text-sm text-sand-500">
                    Үйлчилгээ алга.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {category.services.map((service) => (
                      <ServiceCard
                        key={service.id}
                        service={service}
                        categoryColor={category.color}
                        showBranch={branches.length > 1}
                        canEdit={canEdit}
                        isPending={isPending}
                        onEdit={() =>
                          setEditing({
                            kind: "service",
                            categoryId: category.id,
                            service,
                          })
                        }
                        onDelete={() => {
                          if (confirm(`«${service.name}»-г бүрмөсөн устгах уу?`)) {
                            run(() => deleteService(service.id));
                          }
                        }}
                      />
                    ))}
                  </ul>
                )}
              </section>
            ))}
          </div>
        )}
      </div>

      {editing?.kind === "category" ? (
        <CategoryModal
          category={editing.category}
          onClose={() => setEditing(null)}
        />
      ) : null}

      {editing?.kind === "service" ? (
        <ServiceModal
          categories={allCategories}
          branches={branches}
          categoryId={editing.categoryId}
          service={editing.service}
          defaultBranchId={branchFilter}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </>
  );
}

/** Салбарын шүүлтүүрийн товч. */
function FilterPill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm transition ${
        active
          ? "bg-white font-medium text-sand-900 shadow-sm"
          : "text-sand-500 hover:text-sand-800"
      }`}
    >
      {children}
    </button>
  );
}

/**
 * Үйлчилгээний нэг карт.
 *
 * Зүүн талд өнгөт хавтан (үйлчилгээний хуанли дээрх өнгө), голд нэр ба
 * үнэ/хугацаа, баруун талд ЗӨВХӨН «Засах», «Устгах» хоёр товч.
 * Идэвхтэй эсэхийг засах цонхноос сольдог.
 */
function ServiceCard({
  service,
  categoryColor,
  showBranch,
  canEdit,
  isPending,
  onEdit,
  onDelete,
}: {
  service: Service;
  categoryColor: string;
  showBranch: boolean;
  canEdit: boolean;
  isPending: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const sale = isSaleActive(service);
  const percent = salePercent(service);
  const color = service.color ?? categoryColor;
  const initial = service.name.trim().slice(0, 1).toLocaleUpperCase("mn-MN");

  return (
    <li>
      <div
        className={`flex items-center gap-3 rounded-2xl border border-sand-200 bg-white p-2.5 transition hover:border-sand-300 hover:shadow-sm sm:p-3 ${
          service.isActive ? "" : "opacity-60"
        }`}
      >
        {/* Өнгөт хавтан — хуанли дээр энэ өнгөөр харагдана */}
        <span
          aria-hidden
          className="flex size-12 shrink-0 items-center justify-center rounded-2xl font-serif text-lg"
          style={{
            backgroundColor: `color-mix(in srgb, ${color} 16%, white)`,
            color: `color-mix(in srgb, ${color} 78%, #22201d)`,
          }}
        >
          {initial}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="truncate font-medium text-sand-900">
              {service.name}
            </span>
            {sale ? (
              <span className="shrink-0 rounded-full bg-warn-50 px-2 py-0.5 text-xs font-medium text-warn-700">
                −{percent}%
              </span>
            ) : null}
            {!service.isActive ? (
              <span className="shrink-0 rounded-full bg-sand-200 px-2 py-0.5 text-xs text-sand-600">
                идэвхгүй
              </span>
            ) : null}
            {showBranch ? (
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${
                  service.branch
                    ? "bg-brand-50 text-brand-700"
                    : "bg-sand-100 text-sand-500"
                }`}
              >
                {service.branch?.name ?? "бүх салбар"}
              </span>
            ) : null}
          </div>

          <p className="mt-0.5 text-sm text-sand-500">
            {sale ? (
              <>
                <span className="line-through">{formatPrice(service.price)}</span>{" "}
                <span className="font-semibold text-warn-600">
                  {formatPrice(service.salePrice as number)}
                </span>
              </>
            ) : (
              <span className="font-medium text-sand-800">
                {formatPrice(service.price)}
              </span>
            )}
            {" · "}
            {formatDuration(service.durationMin)}
          </p>

          {sale && service.saleEndsAt ? (
            <p className="mt-0.5 text-xs text-sand-400">
              {toDateKey(service.saleEndsAt)} хүртэл
            </p>
          ) : null}
        </div>

        {canEdit ? (
          <div className="flex shrink-0 items-center gap-1 sm:gap-2">
            <button
              type="button"
              onClick={onEdit}
              className="rounded-full border border-sand-300 px-3 py-1.5 text-sm text-sand-700 transition hover:bg-sand-100 sm:px-4"
            >
              Засах
            </button>
            <button
              type="button"
              disabled={isPending}
              onClick={onDelete}
              className="rounded-full px-2.5 py-1.5 text-sm text-danger-600 transition hover:bg-danger-50 disabled:opacity-50 sm:px-3"
            >
              Устгах
            </button>
          </div>
        ) : null}
      </div>
    </li>
  );
}

function CategoryModal({
  category,
  onClose,
}: {
  category: Category | null;
  onClose: () => void;
}) {
  const [result, formAction, isPending] = useActionState<
    ActionResult | null,
    FormData
  >(saveCategory, null);
  const [color, setColor] = useState(category?.color ?? PRESET_COLORS[0]);

  useEffect(() => {
    if (result?.ok) onClose();
  }, [result, onClose]);

  return (
    <Modal
      title={category ? "Ангилал засах" : "Шинэ ангилал"}
      onClose={onClose}
      footer={
        <>
          <GhostButton type="button" onClick={onClose}>
            Болих
          </GhostButton>
          <PrimaryButton type="submit" form="category-form" disabled={isPending}>
            {isPending ? "Хадгалж байна…" : "Хадгалах"}
          </PrimaryButton>
        </>
      }
    >
      <form id="category-form" action={formAction} className="space-y-4">
        {category ? <input type="hidden" name="id" value={category.id} /> : null}
        <input type="hidden" name="color" value={color} />
        <input
          type="hidden"
          name="sortOrder"
          value={category?.sortOrder ?? 0}
        />

        <Field label="Нэр">
          <input
            name="name"
            defaultValue={category?.name ?? ""}
            required
            autoFocus
            placeholder="Жишээ: Маникюр"
            className={inputClass}
          />
        </Field>

        <ColorPicker value={color} onChange={setColor} />

        {result && !result.ok ? <Issues issues={result.issues} /> : null}
      </form>
    </Modal>
  );
}

function ServiceModal({
  categories,
  branches,
  categoryId,
  service,
  defaultBranchId,
  onClose,
}: {
  categories: ServiceAdmin;
  branches: BranchOption[];
  categoryId: string;
  service: Service | null;
  /** Шүүлтүүрт салбар сонгосон бол шинэ үйлчилгээ түүнд өгөгдөнө */
  defaultBranchId: BranchFilter;
  onClose: () => void;
}) {
  const [result, formAction, isPending] = useActionState<
    ActionResult | null,
    FormData
  >(saveService, null);

  const category = categories.find((c) => c.id === categoryId);
  const [color, setColor] = useState(
    service?.color ?? category?.color ?? PRESET_COLORS[0],
  );
  const [hasSale, setHasSale] = useState(service?.salePrice != null);

  useEffect(() => {
    if (result?.ok) onClose();
  }, [result, onClose]);

  return (
    <Modal
      title={service ? "Үйлчилгээ засах" : "Шинэ үйлчилгээ"}
      onClose={onClose}
      wide
      footer={
        <>
          <GhostButton type="button" onClick={onClose}>
            Болих
          </GhostButton>
          <PrimaryButton type="submit" form="service-form" disabled={isPending}>
            {isPending ? "Хадгалж байна…" : "Хадгалах"}
          </PrimaryButton>
        </>
      }
    >
      <form id="service-form" action={formAction} className="space-y-4">
        {service ? <input type="hidden" name="id" value={service.id} /> : null}
        <input type="hidden" name="color" value={color} />

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Ангилал">
            <select
              name="categoryId"
              defaultValue={categoryId}
              className={inputClass}
            >
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Нэр">
            <input
              name="name"
              defaultValue={service?.name ?? ""}
              required
              autoFocus
              placeholder="Жишээ: Гель будалт"
              className={inputClass}
            />
          </Field>

          <Field
            label="Салбар"
            hint="«Бүх салбар» бол хаана ч захиалагдана"
          >
            <select
              name="branchId"
              defaultValue={service?.branchId ?? defaultBranchId ?? ""}
              className={inputClass}
            >
              <option value="">Бүх салбар</option>
              {branches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Хугацаа (минут)" hint="Хуанли дээр эзлэх зай">
            <input
              name="durationMin"
              type="number"
              min={5}
              step={5}
              defaultValue={service?.durationMin ?? 60}
              required
              className={inputClass}
            />
          </Field>

          <Field label="Үнэ (₮)">
            <input
              name="price"
              type="number"
              min={0}
              step={1000}
              defaultValue={service?.price ?? ""}
              required
              className={inputClass}
            />
          </Field>
        </div>

        {/* ── Хямдрал ── */}
        <div className="rounded-xl border border-sand-200 p-3">
          <label className="flex cursor-pointer items-center gap-2.5">
            <input
              type="checkbox"
              checked={hasSale}
              onChange={(event) => setHasSale(event.target.checked)}
              className="size-4 accent-warn-600"
            />
            <span className="text-sm font-medium text-sand-800">
              Хямдралтай үнэ тавих
            </span>
          </label>

          {hasSale ? (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Field label="Хямдралтай үнэ (₮)">
                <input
                  name="salePrice"
                  type="number"
                  min={0}
                  step={1000}
                  defaultValue={service?.salePrice ?? ""}
                  className={inputClass}
                />
              </Field>
              <Field
                label="Дуусах огноо"
                hint="Хоосон бол хугацаагүй үргэлжилнэ"
              >
                <input
                  name="saleEndsAt"
                  type="date"
                  defaultValue={
                    service?.saleEndsAt ? toDateKey(service.saleEndsAt) : ""
                  }
                  className={inputClass}
                />
              </Field>
            </div>
          ) : null}
        </div>

        <ColorPicker
          value={color}
          onChange={setColor}
          hint="Хуанли дээрх блокийн өнгө"
        />

        {/* Идэвхгүй үйлчилгээ шинэ захиалгын жагсаалтад гарахгүй */}
        <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-sand-200 p-3">
          <input
            type="checkbox"
            name="isActive"
            defaultChecked={service?.isActive ?? true}
            className="mt-0.5 size-4 accent-brand-600"
          />
          <span>
            <span className="block text-sm font-medium text-sand-800">
              Идэвхтэй
            </span>
            <span className="mt-0.5 block text-xs text-sand-500">
              Тэмдэглэгээг авбал шинэ цаг захиалахад энэ үйлчилгээ сонголтод
              гарахгүй. Хуучин захиалгууд хэвээрээ үлдэнэ.
            </span>
          </span>
        </label>

        {result && !result.ok ? <Issues issues={result.issues} /> : null}
      </form>
    </Modal>
  );
}

function ColorPicker({
  value,
  onChange,
  hint,
}: {
  value: string;
  onChange: (color: string) => void;
  hint?: string;
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
      {hint ? <span className="mt-1.5 block text-xs text-sand-500">{hint}</span> : null}
    </div>
  );
}
