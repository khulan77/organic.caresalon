import { requireUser } from "@/lib/auth";
import { getEffectiveRole } from "@/lib/preview";
import { getServiceAdmin } from "@/lib/queries";
import { ServicesManager } from "@/components/services/services-manager";

export const metadata = { title: "Үйлчилгээ" };

export default async function ServicesPage() {
  const user = await requireUser();
  const effectiveRole = await getEffectiveRole(user);
  const canEdit = effectiveRole === "ADMIN";

  const categories = await getServiceAdmin();

  // Ресепшн идэвхгүй үйлчилгээг харах шаардлагагүй
  const visible = canEdit
    ? categories
    : categories.map((category) => ({
        ...category,
        services: category.services.filter((service) => service.isActive),
      }));

  return <ServicesManager categories={visible} canEdit={canEdit} />;
}
