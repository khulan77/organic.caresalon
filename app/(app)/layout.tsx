import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { AppRail } from "@/components/app-rail";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  // Хамгаалалт өгөгдөл хандах давхаргад — proxy дээрх шалгалтад ганцаараа найдахгүй.
  const user = await requireUser();

  // Түр нууц үгтэй хүн апп руу орохгүй. Энэ хуудас (app) бүлгээс ГАДНА
  // байгаа тул давталт үүсэхгүй.
  if (user.mustChangePassword) redirect("/change-password");

  return (
    <div className="flex h-screen overflow-hidden bg-shell">
      <AppRail user={user} />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-sand-50 pt-14 shadow-[-1px_0_0_rgba(0,0,0,0.04)] md:rounded-l-2xl md:pt-0">
        {children}
      </div>
    </div>
  );
}
