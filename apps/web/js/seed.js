// ============================================================
// seed.js — legacy demo-data cleanup. The demo data itself and the
// "reset to demo data" button that used to (re)generate it in the
// settings panel have been removed: every real account starts on a
// real, empty club and gets its content from the backend via sync.
// What remains here is wipeDemoDataIfPresent() — needed only to clean
// up devices that still carry local demo data from before this
// removal (see its own comment below).
// ============================================================
import { get, remove, clearStore, CLUB_SCOPED_STORES } from './db.js';

// Marker in 'meta' — previously set whenever local demo data was
// (re)generated (auto-seeding on first launch, since removed, or the
// former "Auf Demo-Daten zurücksetzen" button in the settings panel,
// also removed). Consumed by wipeDemoDataIfPresent() below on the next
// transition into the authenticated app (see app.js:
// startAuthenticatedApp()). Indicates that the data currently in
// IndexedDB is ONLY that local demo dataset (no clubId) and was never
// connected to a real account — relevant only for devices with
// leftovers from before this removal; on a genuinely fresh device the
// marker is never set at all.
const DEMO_SEED_META_KEY = 'demoDataSeeded';

// Entfernt den lokalen Demo-Datensatz, falls er noch vorhanden ist —
// aufgerufen unmittelbar bei jedem Übergang in die authentifizierte App
// (siehe app.js: startAuthenticatedApp()), sowohl nach frischem Login als
// auch nach Registrierung/Einladung-Annahme, aber VOR dem ersten
// Sync-Zyklus. Auf einem wirklich frischen Gerät ist das heute ein No-op
// (kein automatisches Seeding mehr und kein Reset-Button mehr, siehe
// Dateikopf) — die Funktion bleibt aber wichtig als Aufräumschritt für
// Geräte, die noch von einer älteren Version dieser App automatisch
// geseedet oder über den inzwischen entfernten "Auf Demo-Daten
// zurücksetzen"-Button in den Einstellungen zurückgesetzt wurden: meldet
// sich danach jemand mit einem echten Konto an, ohne vorher erneut
// zurückzusetzen, sollen die Demo-Datensätze weichen. Diese Demo-
// Datensätze trugen bewusst KEINE clubId und würden sich sonst nach dem
// Login mit den echten, vom Server gepullten Daten des Vereins vermischen
// — sichtbar an verdoppelten Einträgen in den Listen, und schlimmer: eine
// spätere Bearbeitung eines solchen Demo-Datensatzes schlägt beim
// Sync-Push fehl (fehlende clubId bzw. Fremdschlüssel-Verweis auf lokale,
// dem Server unbekannte ids). Läuft dank des Markers DEMO_SEED_META_KEY
// nur einmal — jeder weitere Aufruf (z. B. bei einer
// Sitzungswiederherstellung nach einem Seiten-Reload) ist ein No-op, das
// lokal bereits synchronisierte echte Daten NICHT anrührt. Gibt zurück,
// ob tatsächlich etwas entfernt wurde (für einen optionalen Hinweis-Toast
// in app.js).
export async function wipeDemoDataIfPresent() {
  const flag = await get('meta', DEMO_SEED_META_KEY);
  if (!flag?.active) return false;
  for (const store of CLUB_SCOPED_STORES) await clearStore(store);
  await remove('meta', DEMO_SEED_META_KEY);
  return true;
}
