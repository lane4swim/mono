// packages/shared-types/src/modules.ts
//
// Vertrag für die pro-Verein aktivierbaren Feature-Pakete (z. B. das
// Wettkampfmodul). Module werden bewusst nicht einzeln, sondern als
// benannte PAKETE an-/abgeschaltet: ein Paket kann mehrere Frontend-
// Router-Module (apps/web/js/router.js: MODULES[*].id) UND mehrere
// Sync-Stores (EntityStoreName, siehe entities.ts) bündeln.
//
// Beispiel: Wettkampfliste (apps/web/js/modules/competitions.js),
// Live-Modus (competitionLive.js) und Stoppuhr (stopwatch.js) gehören
// fachlich zusammen und dürfen nur gemeinsam an-/ausgeschaltet werden.
// competitionLive.js/stopwatch.js sind heute keine eigenen Router-
// Einträge (nur intern von competitions.js genutzt, siehe deren
// render()) — Invariante: bekommen sie künftig eigene Routen, MÜSSEN
// diese hier im selben Paket (`competitions`) ergänzt werden, nie ein
// eigenständiges Paket werden.
//
// Diese Tabelle ist die EINE Quelle der Wahrheit für:
//   - welche Router-IDs zu einem Paket gehören (Frontend-Sichtbarkeit,
//     apps/web/js/router.js: visibleModules())
//   - welche Sync-Stores ein Paket freischaltet (Backend-Durchsetzung,
//     apps/api/src/modules/sync/sync.permissions.ts: STORE_MODULE_MAP)
//   - welche Pakete im Superadmin-Formular als Checkboxen erscheinen
//     (apps/web/js/modules/clubForm.js)
//
// "results" (Bestzeiten) taucht bewusst in KEINEM Paket auf: der Store
// wird sowohl von times.js (Bestzeiten-Verwaltung) als auch von
// competitionLive.js (Wettkampf-Ergebnisse) geschrieben/gelesen — er
// gehört zu keinem der beiden Pakete exklusiv. Die Sonderregel dafür
// lebt direkt in STORE_MODULE_MAP (sync.permissions.ts), nicht hier.
import { z } from 'zod';
import type { EntityStoreName } from './entities.js';

interface ModulePackage {
  // apps/web/js/router.js: MODULES[*].id, die zu diesem Paket gehören.
  routeIds: readonly string[];
  // EntityStoreName-Werte, deren Sync-Zugriff dieses Paket freischaltet
  // (zusätzlich zur ohnehin geltenden Rollen-Prüfung).
  stores: readonly EntityStoreName[];
}

export const MODULE_PACKAGES = {
  athletes: { routeIds: ['athletes'], stores: ['athletes', 'groups'] },
  competitions: { routeIds: ['competitions'], stores: ['competitions', 'entries'] },
  times: { routeIds: ['times'], stores: [] },
  plans: { routeIds: ['plans'], stores: ['plans'] },
  templates: { routeIds: ['templates'], stores: ['templates'] },
  catalog: { routeIds: ['catalog'], stores: ['exercises'] },
  sessions: { routeIds: ['sessions'], stores: ['sessions'] },
  actionitems: { routeIds: ['actionitems'], stores: ['actionItems'] },
  stats: { routeIds: ['stats'], stores: [] },
} as const satisfies Record<string, ModulePackage>;

export type ModuleKey = keyof typeof MODULE_PACKAGES;

export const MODULE_KEYS = Object.keys(MODULE_PACKAGES) as ModuleKey[];

export const ModuleKeySchema = z.enum(MODULE_KEYS as [ModuleKey, ...ModuleKey[]]);

// Router-ID (apps/web/js/router.js: MODULES[*].id) -> Paket-Key, aus
// MODULE_PACKAGES abgeleitet statt separat gepflegt. Nutzt eine Router-ID
// ROUTE_TO_PACKAGE statt enabledModules direkt gegen die Router-ID zu
// prüfen: bündelt ein Paket künftig mehrere Router-IDs, greift die Sperre
// automatisch für alle, ohne Konsumenten anzupassen.
export const ROUTE_TO_PACKAGE: Record<string, ModuleKey> = Object.fromEntries(
  MODULE_KEYS.flatMap((key) => MODULE_PACKAGES[key].routeIds.map((routeId) => [routeId, key])),
);
