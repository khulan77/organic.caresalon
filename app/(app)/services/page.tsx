import { requireUser } from "@/lib/auth";
import { getBranches, getServiceAdmin } from "@/lib/queries";
import { ServicesManager } from "@/components/services/services-manager";

export const metadata = { title: "Үйлчилгээ" };

export default async function ServicesPage() {
  const user = await requireUser();
  const canEdit = user.role === "ADMIN";

  const [categories, branches] = await Promise.all([
    getServiceAdmin(),
    getBranches(),
  ]);

  // Ресепшн идэвхгүй үйлчилгээг харах шаардлагагүй
  const visible = canEdit
    ? categories
    : categories.map((category) => ({
        ...category,
        services: category.services.filter((service) => service.isActive),
      }));

  return (
    <ServicesManager
      categories={visible}
      branches={branches.map((branch) => ({ id: branch.id, name: branch.name }))}
      canEdit={canEdit}
    />
  );
}
