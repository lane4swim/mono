-- CreateTable
CREATE TABLE "announcements" (
    "id" TEXT NOT NULL,
    "clubId" TEXT NOT NULL,
    "groupId" TEXT,
    "authorId" TEXT,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "announcements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "announcements_clubId_updatedAt_idx" ON "announcements"("clubId", "updatedAt");

-- CreateIndex
CREATE INDEX "announcements_groupId_idx" ON "announcements"("groupId");

-- AddForeignKey
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "clubs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
