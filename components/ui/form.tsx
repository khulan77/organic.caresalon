/*
  Оролтын талбарын нэгдсэн хэв маяг. Гар утсанд 16px-ээс ЖИЖИГ фонт өгвөл
  iOS Safari талбарт орохдоо дэлгэцийг томруулдаг тул `text-base` -ээр эхэлж,
  томоос дээш `text-sm` болгоно.
*/
const inputClass =
  "w-full rounded-lg border border-sand-300 bg-white px-3 py-2.5 text-base text-sand-900 outline-none transition placeholder:text-sand-400 hover:border-sand-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 disabled:bg-sand-50 disabled:text-sand-500 sm:py-2 sm:text-sm";

export { inputClass };

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-sand-800">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-sand-500">{hint}</span> : null}
    </label>
  );
}

export function Issues({ issues }: { issues: string[] }) {
  if (issues.length === 0) return null;
  return (
    <ul
      role="alert"
      className="space-y-1 rounded-lg bg-danger-50 px-3 py-2.5 text-sm text-danger-700 ring-1 ring-danger-200"
    >
      {issues.map((issue, index) => (
        <li key={index}>• {issue}</li>
      ))}
    </ul>
  );
}

export function PrimaryButton({
  children,
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={`rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-brand-700 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none ${className}`}
    >
      {children}
    </button>
  );
}

export function GhostButton({
  children,
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={`rounded-xl border border-sand-300 bg-white px-4 py-2.5 text-sm text-sand-700 transition hover:border-sand-400 hover:bg-sand-100 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
    >
      {children}
    </button>
  );
}
