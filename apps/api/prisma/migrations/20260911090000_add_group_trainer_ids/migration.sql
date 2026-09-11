-- AlterTable
ALTER TABLE "groups" ADD COLUMN     "trainerIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
