-- Datenmigration (Issue #54, analog zu
-- 20260905140000_enable_kampfrichter_for_existing_clubs): das
-- Qualifikationsmanagement wurde beim Backfill in
-- 20260826090000_add_club_enabled_modules nicht für Bestandsvereine
-- zugebucht. Dadurch scheitert GET /api/qualification-settings — von
-- der Kampfrichter-Seite für die Anzeige der Erinnerungs-Schwellen
-- mitgenutzt (siehe qualifications.route.ts: selfGuard) — für jeden
-- Bestandsverein ohne manuell zugebuchtes 'qualifications'-Paket, auch
-- für Admin-Konten, die nur die Kampfrichter-Funktion nutzen wollen.
-- Ein Superadmin kann das Paket danach jederzeit über die bestehende
-- Checkbox-Liste in clubForm.js wieder deaktivieren.
UPDATE "clubs"
SET "enabledModules" = array_append("enabledModules", 'qualifications')
WHERE NOT ("enabledModules" @> ARRAY['qualifications']::text[]);
