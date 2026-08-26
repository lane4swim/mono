-- AlterTable
ALTER TABLE "clubs" ADD COLUMN "enabledModules" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- Backfill: bestehende Vereine dürfen durch diese Migration nichts
-- verlieren — alle heute existierenden Module bleiben für sie aktiv.
-- Ein künftig NEU hinzukommendes Modul wird bewusst NICHT automatisch für
-- Altkunden freigeschaltet (siehe packages/shared-types/src/modules.ts) —
-- diese Liste ist daher als fester Schnappschuss zu verstehen, nicht als
-- "alle jemals existierenden Module".
UPDATE "clubs" SET "enabledModules" = ARRAY[
  'athletes',
  'competitions',
  'times',
  'plans',
  'templates',
  'catalog',
  'sessions',
  'actionitems',
  'stats'
];
