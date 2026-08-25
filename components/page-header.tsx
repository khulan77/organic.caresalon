/**
 * Дотоод хуудсуудын толгой.
 * Брэндийн нэр хажуугийн цэсэнд байгаа тул энд давтахгүй.
 * Гар утсанд зүүн дээд буланд цэс нээх товч хөвдөг тул зай үлдээнэ.
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
    <header className="no-print flex shrink-0 flex-wrap items-center gap-x-6 gap-y-3 border-b border-sand-200 bg-sand-50 py-4 pl-16 pr-4 md:px-6">
      <div className="min-w-0">
        <h1 className="truncate font-serif text-lg text-sand-900 md:text-xl">
          {title}
        </h1>
        {subtitle ? (
          <p className="mt-0.5 text-sm text-sand-500">{subtitle}</p>
        ) : null}
      </div>
      <div className="flex-1" />
      {action}
    </header>
  );
}
