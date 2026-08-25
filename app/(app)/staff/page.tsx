import { requireUser } from "@/lib/auth";
import { getEffectiveRole } from "@/lib/preview";
import { getStaffAdmin } from "@/lib/queries";
import { StaffManager } from "@/components/staff/staff-manager";

export const metadata = { title: "Ажилтан" };

export default async function StaffPage() {
  const user = await requireUser();
  const effectiveRole = await getEffectiveRole(user);
  const canEdit = effectiveRole === "ADMIN";

  const branches = await getStaffAdmin();

  // Ресепшн идэвхгүй ажилтныг харах шаардлагагүй
  const visible = canEdit
    ? branches
    : branches.map((branch) => ({
        ...branch,
        staff: branch.staff.filter((member) => member.isActive),
      }));

  return <StaffManager branches={visible} canEdit={canEdit} />;
}
