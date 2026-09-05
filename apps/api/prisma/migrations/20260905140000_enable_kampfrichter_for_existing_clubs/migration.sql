-- Datenmigration (docs/kampfrichter-modul-plan.md, Abschnitt 6,
-- Entscheidung 4): das neue Kampfrichter-Modul wird bestehenden Vereinen
-- automatisch zugebucht, analog zum Standardverhalten neuer Vereine
-- (enabledModules: input.enabledModules ?? [...MODULE_KEYS]). Ein
-- Superadmin kann das Paket danach jederzeit über die bestehende
-- Checkbox-Liste in clubForm.js wieder deaktivieren.
UPDATE "clubs"
SET "enabledModules" = array_append("enabledModules", 'kampfrichter')
WHERE NOT ("enabledModules" @> ARRAY['kampfrichter']::text[]);
