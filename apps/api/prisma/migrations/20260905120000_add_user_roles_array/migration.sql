-- AlterTable
-- Phase A (docs/kampfrichter-modul-plan.md, Abschnitt 1.3, Schritt 1
-- "Expand"): neue Mehrfachrollen-Spalte, alte "role"-Spalte bleibt vorerst
-- unverändert bestehen (siehe Plan für die spätere "Contract"-Migration,
-- die "role" entfernt).
ALTER TABLE "users" ADD COLUMN "roles" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- Backfill: jede bestehende Zeile bekommt ihre bisherige Einzelrolle als
-- (einelementige) Rollenliste.
UPDATE "users" SET "roles" = ARRAY["role"];
