-- DropForeignKey
ALTER TABLE "appointments" DROP CONSTRAINT "appointments_packageId_fkey";

-- DropForeignKey
ALTER TABLE "package_services" DROP CONSTRAINT "package_services_packageId_fkey";

-- DropForeignKey
ALTER TABLE "package_services" DROP CONSTRAINT "package_services_serviceId_fkey";

-- DropIndex
DROP INDEX "services_categoryId_name_key";

-- AlterTable
ALTER TABLE "appointments" DROP COLUMN "packageId";

-- AlterTable
ALTER TABLE "branches" ALTER COLUMN "slotMin" SET DEFAULT 30;

-- AlterTable
ALTER TABLE "services" ADD COLUMN     "branchId" TEXT;

-- DropTable
DROP TABLE "package_services";

-- DropTable
DROP TABLE "packages";

-- CreateIndex
CREATE INDEX "services_branchId_idx" ON "services"("branchId");

-- CreateIndex
CREATE UNIQUE INDEX "services_categoryId_branchId_name_key" ON "services"("categoryId", "branchId", "name");

-- AddForeignKey
ALTER TABLE "services" ADD CONSTRAINT "services_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Байгаа салбаруудыг 30 минутын нүд рүү шилжүүлнэ (өмнө нь 15 байсан)
UPDATE "branches" SET "slotMin" = 30 WHERE "slotMin" <> 30;
