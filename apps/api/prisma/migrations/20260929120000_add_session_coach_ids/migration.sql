-- AlterTable
ALTER TABLE "sessions" ADD COLUMN     "coachIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
