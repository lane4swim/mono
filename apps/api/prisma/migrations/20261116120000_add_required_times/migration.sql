-- AlterTable
ALTER TABLE "competitions" ADD COLUMN     "manualRequirements" JSONB NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE "required_time_sets" (
    "id" TEXT NOT NULL,
    "clubId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "rules" JSONB NOT NULL DEFAULT '[]',
    "qualifyingWindow" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "required_time_sets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "required_time_sets_clubId_updatedAt_idx" ON "required_time_sets"("clubId", "updatedAt");

-- AddForeignKey
ALTER TABLE "required_time_sets" ADD CONSTRAINT "required_time_sets_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "clubs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

