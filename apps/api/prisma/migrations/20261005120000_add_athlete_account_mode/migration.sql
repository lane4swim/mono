-- AlterTable
ALTER TABLE "athletes" ADD COLUMN     "accountMode" TEXT NOT NULL DEFAULT 'managed';

-- Profile, die bereits mit einem Nutzerkonto verknüpft sind oder für die
-- eine offene Athlet:innen-Einladung existiert, gelten als einladbar —
-- sonst widerspräche der neue Standard "managed" dem tatsächlichen Zustand.
UPDATE "athletes" SET "accountMode" = 'invitable'
WHERE "id" IN (SELECT "athleteId" FROM "users" WHERE "athleteId" IS NOT NULL)
   OR "id" IN (
     SELECT "athleteId" FROM "invitations"
     WHERE "role" = 'athlete' AND "athleteId" IS NOT NULL
       AND "usedAt" IS NULL AND "revokedAt" IS NULL
   );
