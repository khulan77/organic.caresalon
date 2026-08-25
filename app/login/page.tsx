import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { LoginForm } from "./login-form";

export const metadata = { title: "Нэвтрэх" };

export default async function LoginPage() {
  // Аль хэдийн нэвтэрсэн бол хуанли руу шууд оруулна
  if (await getCurrentUser()) redirect("/calendar");

  return (
    <main className="flex min-h-screen items-center justify-center bg-shell px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-5 flex size-14 items-center justify-center rounded-full bg-brand-700 font-serif text-lg text-brand-50">
            OC
          </div>
          <p className="font-serif text-3xl tracking-tight text-sand-900">
            Organic Care
          </p>
          <p className="mt-2 text-[11px] font-medium uppercase tracking-[0.14em] text-sand-500">
            Захиалгын самбар
          </p>
        </div>

        <div className="rounded-2xl border border-sand-200 bg-white p-6 shadow-sm">
          <LoginForm />
        </div>

        <p className="mt-6 text-center text-xs text-sand-500">
          Нэвтрэх эрхээ мартсан бол админд хандана уу.
        </p>
      </div>
    </main>
  );
}
