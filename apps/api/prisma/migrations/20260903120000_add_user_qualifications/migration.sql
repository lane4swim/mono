-- CreateTable
CREATE TABLE "user_qualifications" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "acquiredOn" TIMESTAMP(3) NOT NULL,
    "expiresOn" TIMESTAMP(3),
    "renewalCourseOrganizedOn" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "user_qualifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qualification_reminder_logs" (
    "id" TEXT NOT NULL,
    "qualificationId" TEXT NOT NULL,
    "thresholdDays" INTEGER NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "qualification_reminder_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "club_qualification_reminder_settings" (
    "id" TEXT NOT NULL,
    "clubId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "thresholdsDays" INTEGER[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "club_qualification_reminder_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_qualifications_userId_deletedAt_idx" ON "user_qualifications"("userId", "deletedAt");

-- CreateIndex
CREATE INDEX "user_qualifications_expiresOn_idx" ON "user_qualifications"("expiresOn");

-- CreateIndex
CREATE UNIQUE INDEX "club_qualification_reminder_settings_clubId_type_key" ON "club_qualification_reminder_settings"("clubId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "qualification_reminder_logs_qualificationId_thresholdDays_key" ON "qualification_reminder_logs"("qualificationId", "thresholdDays");

-- AddForeignKey
ALTER TABLE "user_qualifications" ADD CONSTRAINT "user_qualifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qualification_reminder_logs" ADD CONSTRAINT "qualification_reminder_logs_qualificationId_fkey" FOREIGN KEY ("qualificationId") REFERENCES "user_qualifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "club_qualification_reminder_settings" ADD CONSTRAINT "club_qualification_reminder_settings_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "clubs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
