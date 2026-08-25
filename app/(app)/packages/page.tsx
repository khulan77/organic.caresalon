import { requireUser } from "@/lib/auth";
import { getEffectiveRole } from "@/lib/preview";
import { getPackageAdmin, getServiceAdmin } from "@/lib/queries";
import { PackagesManager } from "@/components/packages/packages-manager";

export const metadata = { title: "Багц" };

export default async function PackagesPage() {
  const user = await requireUser();
  const effectiveRole = await getEffectiveRole(user);
  const canEdit = effectiveRole === "ADMIN";

  const [packages, categories] = await Promise.all([
    getPackageAdmin(),
    getServiceAdmin(),
  ]);

  // Ресепшн зөвхөн идэвхтэй багцыг харна
  const visible = canEdit ? packages : packages.filter((p) => p.isActive);

  return (
    <PackagesManager
      packages={visible}
      categories={categories}
      canEdit={canEdit}
    />
  );
}
