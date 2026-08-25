/*
  Warnings:

  - You are about to drop the column `purgedAt` on the `data_deletion_requests` table. All the data in the column will be lost.
  - You are about to drop the column `status` on the `data_deletion_requests` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "data_deletion_requests_status_purgeAfter_idx";

-- AlterTable
ALTER TABLE "data_deletion_requests" DROP COLUMN "purgedAt",
DROP COLUMN "status";

-- CreateIndex
CREATE INDEX "data_deletion_requests_purgeAfter_idx" ON "data_deletion_requests"("purgeAfter");
