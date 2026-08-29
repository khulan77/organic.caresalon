/**
 * Хуудас солигдох үеийн завсрын дэлгэц.
 *
 * Ингэснээр удаан хариу ирэхэд дэлгэц хоосон болж «унасан» юм шиг
 * харагдахгүй — ресепшн юу болж байгааг мэднэ.
 */
export default function Loading() {
  return (
    <div className="grid min-h-0 flex-1 place-items-center bg-sand-50">
      <div className="flex items-center gap-3 text-sm text-sand-500">
        <span
          aria-hidden
          className="size-4 animate-spin rounded-full border-2 border-sand-300 border-t-brand-600"
        />
        Ачаалж байна…
      </div>
    </div>
  );
}
