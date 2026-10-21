-- AlterTable
ALTER TABLE "competitions" ADD COLUMN     "disciplines" JSONB NOT NULL DEFAULT '[]';
