import { requireUser } from "@/lib/auth";
import { getStaffAdmin, getUsersAdmin } from "@/lib/queries";
import { StaffManager } from "@/components/staff/staff-manager";

export const metadata = { title: "Ажилтан" };

export default async function StaffPage() {
  const user = await requireUser();
  const canEdit = user.role === "ADMIN";

  const [branches, users] = await Promise.all([
    getStaffAdmin(),
    canEdit ? getUsersAdmin() : Promise.resolve([]),
  ]);

  // Ресепшн идэвхгүй ажилтныг харах шаардлагагүй
  const visible = canEdit
    ? branches
    : branches.map((branch) => ({
        ...branch,
        staff: branch.staff.filter((member) => member.isActive),
      }));

  return <StaffManager branches={visible} users={users} canEdit={canEdit} />;
}
