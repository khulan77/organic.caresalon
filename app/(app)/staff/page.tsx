import { requireUser } from "@/lib/auth";
import { getStaffAdmin, getUsersAdmin } from "@/lib/queries";
import { StaffManager } from "@/components/staff/staff-manager";

export const metadata = { title: "Ажилтан" };

export default async function StaffPage() {
  const user = await requireUser();
  const isAdmin = user.role === "ADMIN";

  const [branches, users] = await Promise.all([
    getStaffAdmin(),
    isAdmin ? getUsersAdmin() : Promise.resolve([]),
  ]);

  /**
   * Аль салбарын ажилтныг ӨӨРЧИЛЖ болох вэ.
   *
   * Ресепшн харьяа салбартаа шинэ мастер нэмж, хуваарийг нь засна — админ
   * хүлээх шаардлагагүй. Бусад салбарын жагсаалтыг зөвхөн харна.
   */
  const writableBranchIds = branches
    .filter((branch) => isAdmin || branch.id === user.branchId)
    .map((branch) => branch.id);

  // Идэвхгүй ажилтан зөвхөн өөрчлөх эрхтэй салбарт харагдана — тэнд л
  // буцааж идэвхжүүлэх утгатай, бусад салбарын жагсаалтыг дэмий уртасгахгүй
  const visible = branches.map((branch) =>
    writableBranchIds.includes(branch.id)
      ? branch
      : {
          ...branch,
          staff: branch.staff.filter((member) => member.isActive),
        },
  );

  return (
    <StaffManager
      branches={visible}
      users={users}
      isAdmin={isAdmin}
      writableBranchIds={writableBranchIds}
    />
  );
}
