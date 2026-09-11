-- CreateTable
CREATE TABLE "parent_links" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "athleteId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "parent_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "parent_links_athleteId_idx" ON "parent_links"("athleteId");

-- CreateIndex
CREATE UNIQUE INDEX "parent_links_userId_athleteId_key" ON "parent_links"("userId", "athleteId");

-- AddForeignKey
ALTER TABLE "parent_links" ADD CONSTRAINT "parent_links_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parent_links" ADD CONSTRAINT "parent_links_athleteId_fkey" FOREIGN KEY ("athleteId") REFERENCES "athletes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
