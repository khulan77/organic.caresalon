"use client";

import { useRouter } from "next/navigation";
import { startTransition, useOptimistic } from "react";

/** Үйлчлүүлэгчийн жагсаалтын хайлт — утга URL-д хадгалагдана. */
export function ClientSearch({ defaultValue }: { defaultValue: string }) {
  const router = useRouter();
  const [value, setValue] = useOptimistic(defaultValue);

  function search(next: string) {
    startTransition(() => {
      setValue(next);
      router.push(next ? `/clients?q=${encodeURIComponent(next)}` : "/clients");
    });
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const input = event.currentTarget.elements.namedItem(
          "q",
        ) as HTMLInputElement;
        search(input.value.trim());
      }}
      className="flex w-full gap-2 sm:w-auto"
    >
      <input
        name="q"
        defaultValue={value}
        placeholder="Нэр эсвэл утсаар хайх…"
        className="w-full min-w-0 rounded-lg border sm:w-52 border-sand-300 px-2.5 py-1.5 text-sm outline-none placeholder:text-sand-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
      />
      <button
        type="submit"
        className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-brand-700"
      >
        Хайх
      </button>
    </form>
  );
}
