import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { logout } from "@/app/login/actions";
import { ChangePasswordForm } from "./change-password-form";

export const metadata = { title: "Нууц үг тохируулах" };

export default async function ChangePasswordPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const forced = user.mustChangePassword;

  return (
    <main className="flex min-h-screen items-center justify-center bg-shell px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-5 flex size-14 items-center justify-center rounded-full bg-brand-700 font-serif text-lg text-brand-50">
            OC
          </div>
          <p className="font-serif text-3xl tracking-tight text-sand-900">
            {forced ? "Нууц үгээ тохируулна уу" : "Нууц үг солих"}
          </p>
          <p className="mt-2 text-sm text-sand-600">
            {user.name} · {user.phone}
          </p>
        </div>

        {forced ? (
          <p className="mb-4 rounded-xl bg-warn-50 px-4 py-3 text-sm text-warn-700">
            Танд түр нууц үг олгосон байна. Үргэлжлүүлэхийн тулд зөвхөн өөрийн
            мэдэх шинэ нууц үг тохируулна уу.
          </p>
        ) : null}

        <div className="rounded-2xl border border-sand-200 bg-white p-6 shadow-sm">
          <ChangePasswordForm forced={forced} />
        </div>

        <form action={logout} className="mt-6 text-center">
          <button
            type="submit"
            className="text-xs text-sand-500 underline-offset-2 hover:underline"
          >
            Гарах
          </button>
        </form>
      </div>
    </main>
  );
}
