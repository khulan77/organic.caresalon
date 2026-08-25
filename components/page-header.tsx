/**
 * Дотоод хуудсуудын толгой.
 * Брэндийн нэр хажуугийн цэсэнд байгаа тул энд давтахгүй.
 */
export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <header className="no-print flex shrink-0 flex-wrap items-center gap-x-6 gap-y-3 border-b border-sand-200 bg-sand-50 px-6 py-4">
      <div className="min-w-0">
        <h1 className="truncate font-serif text-xl text-sand-900">{title}</h1>
        {subtitle ? (
          <p className="mt-0.5 truncate text-sm text-sand-500">{subtitle}</p>
        ) : null}
      </div>
      <div className="flex-1" />
      {action}
    </header>
  );
}
