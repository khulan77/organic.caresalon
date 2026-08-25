import { requireUser } from "@/lib/auth";
import { getEffectiveRole } from "@/lib/preview";
import { getStaffAdmin, getUsersAdmin } from "@/lib/queries";
import { StaffManager } from "@/components/staff/staff-manager";

export const metadata = { title: "Ажилтан" };

export default async function StaffPage() {
  const user = await requireUser();
  const effectiveRole = await getEffectiveRole(user);
  const canEdit = effectiveRole === "ADMIN";

  // Нэвтрэх эрхийн жагсаалтыг ЗӨВХӨН жинхэнэ админ уншина. `canEdit` нь
  // урьдчилан харах горимд өөрчлөгддөг тул түүнд найдахгүй — хэрэглэгчийн
  // бодит эрхээр шалгана.
  const [branches, users] = await Promise.all([
    getStaffAdmin(),
    user.role === "ADMIN" ? getUsersAdmin() : Promise.resolve([]),
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
