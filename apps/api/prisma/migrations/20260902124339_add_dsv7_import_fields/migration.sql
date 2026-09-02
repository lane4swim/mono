-- AlterTable
ALTER TABLE "athletes" ADD COLUMN     "nationalID" TEXT,
ADD COLUMN     "nationalIDType" TEXT;

-- AlterTable
ALTER TABLE "clubs" ADD COLUMN     "nationalID" TEXT,
ADD COLUMN     "nationalIDType" TEXT;

-- AlterTable
ALTER TABLE "results" ADD COLUMN     "comments" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "splits" JSONB,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'OK',
ADD COLUMN     "statusNote" TEXT,
ALTER COLUMN "time" DROP NOT NULL;
