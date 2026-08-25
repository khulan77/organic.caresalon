const inputClass =
  "w-full rounded-lg border border-sand-300 bg-white px-3 py-2 text-sm text-sand-900 outline-none placeholder:text-sand-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20";

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
      className="space-y-1 rounded-lg bg-[#f6e8e8] px-3 py-2.5 text-sm text-[#7d3f3f]"
    >
      {issues.map((issue, index) => (
        <li key={index}>• {issue}</li>
      ))}
    </ul>
  );
}

export function PrimaryButton({
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-700 disabled:opacity-50"
    >
      {children}
    </button>
  );
}

export function GhostButton({
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className="rounded-xl border border-sand-300 px-4 py-2 text-sm text-sand-700 transition hover:bg-sand-100 disabled:opacity-50"
    >
      {children}
    </button>
  );
}
