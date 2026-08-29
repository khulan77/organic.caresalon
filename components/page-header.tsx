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
    <header className="no-print shrink-0 border-b border-sand-200 bg-sand-50 py-3.5 pl-16 pr-4 md:px-6 md:py-4">
      {/*
        Гар утсанд: гарчиг ба үйлдэл ХОЁР мөр болж, товч бүтэн өргөнөө авна —
        урт гарчиг товчийг шахахгүй. Компьютерт: нэг мөр, товч баруун талд.
      */}
      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:gap-6">
        <div className="min-w-0">
          <h1 className="truncate font-serif text-lg text-sand-900 md:text-xl">
            {title}
          </h1>
          {subtitle ? (
            <p className="mt-0.5 truncate text-sm text-sand-500">{subtitle}</p>
          ) : null}
        </div>

        {action ? (
          <div className="flex shrink-0 flex-wrap gap-2 sm:ml-auto">{action}</div>
        ) : null}
      </div>
    </header>
  );
}
