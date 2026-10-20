-- CreateTable
CREATE TABLE "calendar_entries" (
    "id" TEXT NOT NULL,
    "clubId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "groupId" TEXT,
    "weekdays" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "startTime" TEXT,
    "endTime" TEXT,
    "pauseDuring" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "poolLength" TEXT,
    "location" TEXT NOT NULL DEFAULT '',
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "calendar_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "calendar_entries_clubId_updatedAt_idx" ON "calendar_entries"("clubId", "updatedAt");

-- CreateIndex
CREATE INDEX "calendar_entries_groupId_idx" ON "calendar_entries"("groupId");

-- AddForeignKey
ALTER TABLE "calendar_entries" ADD CONSTRAINT "calendar_entries_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "clubs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_entries" ADD CONSTRAINT "calendar_entries_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

