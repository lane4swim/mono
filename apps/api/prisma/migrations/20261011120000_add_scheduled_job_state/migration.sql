-- CreateTable
CREATE TABLE "scheduled_job_states" (
    "name" TEXT NOT NULL,
    "lockedBy" TEXT,
    "lockedUntil" TIMESTAMP(3),
    "runningSince" TIMESTAMP(3),
    "lastStartedAt" TIMESTAMP(3),
    "lastFinishedAt" TIMESTAMP(3),
    "lastStatus" TEXT,
    "lastSummary" JSONB NOT NULL DEFAULT '{}',
    "lastError" TEXT,
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "scheduled_job_states_pkey" PRIMARY KEY ("name")
);
