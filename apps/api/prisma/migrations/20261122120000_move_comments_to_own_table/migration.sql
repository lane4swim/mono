-- Issue #141: Kommentare als eigene Tabelle statt eingebetteter JSON-Arrays.
--
-- Reihenfolge: Tabelle anlegen, bestehende Kommentare aus allen fünf
-- Fundstellen übernehmen, die eingebetteten Kommentare aus den
-- verbleibenden JSON-Spalten entfernen und erst danach die nun leeren
-- Spalten löschen. Prisma führt die Datei als Ganzes aus; schlägt ein
-- Schritt fehl, bleibt die Migration als fehlgeschlagen markiert und die
-- alten Spalten bestehen weiter.
--
-- Fundstellen (zuvor apps/api/src/modules/shared/commentLocations.ts):
--   plans.comments, plans.days[].sets[].comments (auch in Blöcken),
--   exercises.comments, templates.sets[].comments,
--   section_templates.entries[].comments, results.comments.

-- CreateTable
CREATE TABLE "comments" (
    "id" TEXT NOT NULL,
    "clubId" TEXT NOT NULL,
    "targetStore" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "entryId" TEXT,
    "authorId" TEXT,
    "authorName" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "editedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "comments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "comments_clubId_updatedAt_idx" ON "comments"("clubId", "updatedAt");

-- CreateIndex
CREATE INDEX "comments_targetStore_targetId_idx" ON "comments"("targetStore", "targetId");

-- CreateIndex
CREATE INDEX "comments_authorId_idx" ON "comments"("authorId");

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "clubs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Übernimmt die Kommentare eines Arrays in die neue Tabelle. Neue ids
-- (die eingebetteten waren frei wählbare, nicht eindeutige Strings).
-- Einträge ohne Text werden übersprungen; eine authorId, die keine UUID
-- ist, wird zu NULL (Altbestand ohne Zuordnung). createdAt war ein
-- ISO-String mit Zeitzone, die Spalten speichern UTC ohne Zeitzone.
CREATE FUNCTION "lane1_tmp_copy_comments"(
  p_club_id TEXT, p_target_store TEXT, p_target_id TEXT, p_entry_id TEXT, p_comments JSONB
) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF jsonb_typeof(p_comments) IS DISTINCT FROM 'array' THEN
    RETURN;
  END IF;
  INSERT INTO "comments" ("id", "clubId", "targetStore", "targetId", "entryId", "authorId", "authorName", "text", "createdAt", "updatedAt")
  SELECT
    gen_random_uuid()::text,
    p_club_id,
    p_target_store,
    p_target_id,
    p_entry_id,
    CASE WHEN c->>'authorId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN c->>'authorId' END,
    COALESCE(NULLIF(left(c->>'authorName', 200), ''), '—'),
    left(c->>'text', 5000),
    COALESCE(
      CASE WHEN c->>'createdAt' ~ '^\d{4}-\d{2}-\d{2}T' THEN ((c->>'createdAt')::timestamptz AT TIME ZONE 'UTC') END,
      CURRENT_TIMESTAMP
    ),
    clock_timestamp()
  FROM jsonb_array_elements(p_comments) AS c
  WHERE jsonb_typeof(c) = 'object' AND btrim(COALESCE(c->>'text', '')) <> '';
END;
$$;

-- Entfernt den Schlüssel "comments" aus jedem Objekt einer beliebig tief
-- verschachtelten Satz-Struktur (Sätze, Blöcke, Abschnitte, Plan-Tage).
CREATE FUNCTION "lane1_tmp_strip_comments"(j JSONB) RETURNS JSONB LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF jsonb_typeof(j) = 'object' THEN
    RETURN COALESCE(
      (SELECT jsonb_object_agg(k, "lane1_tmp_strip_comments"(v)) FROM jsonb_each(j) AS e(k, v) WHERE k <> 'comments'),
      '{}'::jsonb
    );
  ELSIF jsonb_typeof(j) = 'array' THEN
    RETURN COALESCE(
      (SELECT jsonb_agg("lane1_tmp_strip_comments"(v) ORDER BY o) FROM jsonb_array_elements(j) WITH ORDINALITY AS a(v, o)),
      '[]'::jsonb
    );
  END IF;
  RETURN j;
END;
$$;

-- Flache Arrays: Plan, Übung, Ergebnis.
SELECT "lane1_tmp_copy_comments"("clubId", 'plans', "id", NULL, "comments") FROM "plans" WHERE "comments" <> '[]'::jsonb;
SELECT "lane1_tmp_copy_comments"("clubId", 'exercises', "id", NULL, "comments") FROM "exercises" WHERE "comments" <> '[]'::jsonb;
SELECT "lane1_tmp_copy_comments"("clubId", 'results', "id", NULL, "comments") FROM "results" WHERE "comments" <> '[]'::jsonb;

-- Verschachtelte Sätze: jedes Objekt mit einem "comments"-Array, in jeder
-- Tiefe. `strict` statt des Standard-Modus `lax`: lax entpackt Arrays bei
-- `.**` automatisch und lieferte dadurch denselben Satz mehrfach.
SELECT "lane1_tmp_copy_comments"(p."clubId", 'plans', p."id", node->>'id', node->'comments')
FROM "plans" p, jsonb_path_query(p."days", 'strict $.** ? (@.type() == "object" && @.comments.type() == "array")') AS node;
SELECT "lane1_tmp_copy_comments"(t."clubId", 'templates', t."id", node->>'id', node->'comments')
FROM "templates" t, jsonb_path_query(t."sets", 'strict $.** ? (@.type() == "object" && @.comments.type() == "array")') AS node;
SELECT "lane1_tmp_copy_comments"(s."clubId", 'sectionTemplates', s."id", node->>'id', node->'comments')
FROM "section_templates" s, jsonb_path_query(s."entries", 'strict $.** ? (@.type() == "object" && @.comments.type() == "array")') AS node;

-- Kommentare aus den verbleibenden JSON-Spalten entfernen. updatedAt wird
-- gesetzt, damit jedes Gerät die bereinigte Fassung beim nächsten Pull
-- erhält und keine Kopie der Kommentare im lokalen Speicher behält.
-- Gilt auch für Zeilen, deren flache "comments"-Spalte gleich wegfällt.
UPDATE "plans" SET
  "days" = "lane1_tmp_strip_comments"("days"),
  "updatedAt" = clock_timestamp()
WHERE "comments" <> '[]'::jsonb OR jsonb_path_exists("days", 'strict $.** ? (@.type() == "object" && exists(@.comments))');
UPDATE "templates" SET
  "sets" = "lane1_tmp_strip_comments"("sets"),
  "updatedAt" = clock_timestamp()
WHERE jsonb_path_exists("sets", 'strict $.** ? (@.type() == "object" && exists(@.comments))');
UPDATE "section_templates" SET
  "entries" = "lane1_tmp_strip_comments"("entries"),
  "updatedAt" = clock_timestamp()
WHERE jsonb_path_exists("entries", 'strict $.** ? (@.type() == "object" && exists(@.comments))');
UPDATE "exercises" SET "updatedAt" = clock_timestamp() WHERE "comments" <> '[]'::jsonb;
UPDATE "results" SET "updatedAt" = clock_timestamp() WHERE "comments" <> '[]'::jsonb;

DROP FUNCTION "lane1_tmp_copy_comments"(TEXT, TEXT, TEXT, TEXT, JSONB);
DROP FUNCTION "lane1_tmp_strip_comments"(JSONB);

-- AlterTable
ALTER TABLE "exercises" DROP COLUMN "comments";

-- AlterTable
ALTER TABLE "plans" DROP COLUMN "comments";

-- AlterTable
ALTER TABLE "results" DROP COLUMN "comments";
