-- AlterTable
ALTER TABLE "users" ADD COLUMN     "mfaFailedCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "mfaFailedWindowStart" TIMESTAMP(3),
ADD COLUMN     "mfaLockedUntil" TIMESTAMP(3),
ADD COLUMN     "mfaLockoutCount" INTEGER NOT NULL DEFAULT 0;
