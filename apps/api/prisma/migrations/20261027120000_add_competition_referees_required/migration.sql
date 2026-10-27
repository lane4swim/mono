-- AlterTable
ALTER TABLE "competitions" ADD COLUMN     "refereesRequired" INTEGER;

-- CreateIndex
CREATE INDEX "referee_assignments_competitionId_idx" ON "referee_assignments"("competitionId");
