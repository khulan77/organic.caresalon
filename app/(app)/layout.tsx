import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getEffectiveRole } from "@/lib/preview";
import { AppRail } from "@/components/app-rail";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  // Хамгаалалт өгөгдөл хандах давхаргад — proxy дээрх шалгалтад ганцаараа найдахгүй.
  const user = await requireUser();

  // Түр нууц үгтэй хүн апп руу орохгүй. Энэ хуудас (app) бүлгээс ГАДНА
  // байгаа тул давталт үүсэхгүй.
  if (user.mustChangePassword) redirect("/change-password");

  // Админ «Ресепшн» харагдацыг урьдчилан харж болно (зөвхөн UI, хамгаалалт биш)
  const effectiveRole = await getEffectiveRole(user);

  return (
    <div className="flex h-screen overflow-hidden bg-shell">
      <AppRail user={user} effectiveRole={effectiveRole} />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-l-2xl bg-sand-50 shadow-[-1px_0_0_rgba(0,0,0,0.04)]">
        {children}
      </div>
    </div>
  );
}
