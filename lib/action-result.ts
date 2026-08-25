/** Server Action-уудын нэгдсэн хариу. */
export type ActionResult =
  | { ok: true }
  | { ok: false; issues: string[] };

/** Алдааг хэрэглэгчид ойлгомжтой хэлбэрт оруулна. */
export function fail(...issues: string[]): ActionResult {
  return { ok: false, issues };
}

/** Формоос эерэг бүхэл тоо унших. */
export function readAmount(value: FormDataEntryValue | null): number | null {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!digits) return null;
  const parsed = Number(digits);
  return Number.isSafeInteger(parsed) ? parsed : null;
}
