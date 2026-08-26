-- AlterTable
ALTER TABLE "appointments" ADD COLUMN     "groupId" TEXT,
ADD COLUMN     "isPrimary" BOOLEAN NOT NULL DEFAULT true;

-- CreateIndex
CREATE INDEX "appointments_groupId_idx" ON "appointments"("groupId");

