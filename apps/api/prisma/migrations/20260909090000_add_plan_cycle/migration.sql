-- CreateTable
CREATE TABLE "plan_cycles" (
    "id" TEXT NOT NULL,
    "clubId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "weeks" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "plan_cycles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "plan_cycles_clubId_updatedAt_idx" ON "plan_cycles"("clubId", "updatedAt");

-- AddForeignKey
ALTER TABLE "plan_cycles" ADD CONSTRAINT "plan_cycles_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "clubs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
