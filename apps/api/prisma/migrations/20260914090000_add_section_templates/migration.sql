-- CreateTable
CREATE TABLE "section_templates" (
    "id" TEXT NOT NULL,
    "clubId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "entries" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "section_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "section_templates_clubId_updatedAt_idx" ON "section_templates"("clubId", "updatedAt");

-- AddForeignKey
ALTER TABLE "section_templates" ADD CONSTRAINT "section_templates_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "clubs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
