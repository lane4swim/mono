-- CreateTable
-- docs/kampfrichter-modul-plan.md, Abschnitt 5.2.
CREATE TABLE "referee_assignments" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clubId" TEXT NOT NULL,
    "competitionName" TEXT NOT NULL,
    "competitionPlace" TEXT NOT NULL DEFAULT '',
    "competitionId" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "function" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "createdByAdminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "referee_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "referee_assignments_userId_deletedAt_idx" ON "referee_assignments"("userId", "deletedAt");

-- CreateIndex
CREATE INDEX "referee_assignments_clubId_date_idx" ON "referee_assignments"("clubId", "date");

-- AddForeignKey
ALTER TABLE "referee_assignments" ADD CONSTRAINT "referee_assignments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referee_assignments" ADD CONSTRAINT "referee_assignments_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "clubs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referee_assignments" ADD CONSTRAINT "referee_assignments_competitionId_fkey" FOREIGN KEY ("competitionId") REFERENCES "competitions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referee_assignments" ADD CONSTRAINT "referee_assignments_createdByAdminId_fkey" FOREIGN KEY ("createdByAdminId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
