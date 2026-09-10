// Rollen-/Modul-Matrix für die generische Sync-API: legt je Store fest, wer
// lesen (Pull) und wer schreiben (Push) darf. Reines clubId-Scoping gäbe
// sonst jeder authentifizierten Rolle den vollständigen Vereinsdatensatz,
// lesend UND schreibend. push()/pull() (sync.service.ts) fragen
// ausschließlich canRead()/canWrite() ab, statt Rollen-Sonderfälle im
// Ablauf zu verdrahten.
//
// Whitelist, nicht Blacklist: eine Rolle, die für einen Store nicht
// gelistet ist, hat dort keinen Zugriff. Eine künftige Rolle (RoleSchema in
// packages/shared-types/src/user.ts) kommt damit automatisch nirgends
// hinein, bis sie hier eingetragen wird — ein Versehen fällt als "zu wenig
// Rechte" auf, nicht als Lücke. `Record<EntityStoreName, StoreAccess>`
// erzwingt zusätzlich zur Compile-Zeit, dass jeder Store einen Eintrag hat.
// "superadmin" fehlt bewusst überall: das Konto gehört zu keinem Verein.
//
// Diese Datei regelt NUR die Store-Ebene. Die feineren Einschränkungen für
// Athlet:innen (nur eigene Zeile/eigenes Feld) hängen vom Dateninhalt ab
// und sitzen deshalb in sync.athleteScope.ts (Pull) bzw. in push() selbst
// ("results", Eigentümerprüfung gegen den bereits geladenen Datensatz).
import type { EntityStoreName, ModuleKey, Role, SyncStore } from '@lane1/shared-types';
import { ENTITY_STORE_NAMES, MODULE_KEYS, MODULE_PACKAGES } from '@lane1/shared-types';

interface StoreAccess {
  read: ReadonlySet<Role>;
  write: ReadonlySet<Role>;
}

// Die drei Rollen, die überhaupt ein Vereinskonto haben und synchronisieren
// dürfen (siehe SyncRequester.clubId-Kommentar in sync.service.ts).
const TEAM_ROLES: readonly Role[] = ['trainer', 'admin', 'athlete'];

// Drei wiederkehrende Zugriffsprofile. `adminManaged` gilt allein für
// "athletes" und ist bewusst enger als `coachManaged`: die Athleten-Stamm-
// daten sind in der Oberfläche auch vor "trainer" verborgen, nicht nur vor
// "athlete" — ein gemeinsames Profil ließe diese Restriktion per direktem
// Push an /api/sync umgehen.
const shared: StoreAccess = { read: new Set(TEAM_ROLES), write: new Set(TEAM_ROLES) };
const coachManaged: StoreAccess = { read: new Set(TEAM_ROLES), write: new Set(['trainer', 'admin']) };
const adminManaged: StoreAccess = { read: new Set(TEAM_ROLES), write: new Set(['admin']) };

export const STORE_PERMISSIONS: Record<EntityStoreName, StoreAccess> = {
  results: shared,
  plans: shared,
  // Wie "templates": Athlet:innen lesen mit, anlegen/bearbeiten/anwenden
  // bleibt trainer/admin vorbehalten (docs/Plans/trainingsplanung-phase1-plan.md,
  // Abschnitt 1.5).
  planCycles: coachManaged,
  athletes: adminManaged,
  groups: coachManaged,
  exercises: coachManaged,
  templates: coachManaged,
  competitions: coachManaged,
  entries: coachManaged,
  actionItems: coachManaged,
  sessions: coachManaged,
  // Vereinsinterne Nachrichten/Ankündigungen (Phase 2, Abschnitt 4.1):
  // wie "templates"/"planCycles" — alle drei Team-Rollen lesen,
  // anlegen/bearbeiten bleibt trainer/admin vorbehalten.
  announcements: coachManaged,
};

// Nimmt den weiteren Wire-Typ `SyncStore` entgegen, nicht nur
// `EntityStoreName`: `SyncStore` führt zusätzlich "users", das die
// Sync-API nicht bedient (Nutzerverwaltung läuft über modules/auth). Ein
// Store ohne Eintrag gilt konsequent als weder lesbar noch schreibbar —
// eine künftige Erweiterung von `SyncStore` rutscht so nicht durch.
export function isKnownStore(store: SyncStore): store is EntityStoreName {
  return store in STORE_PERMISSIONS;
}

// Store -> Modul-Paket(e), die ihn freischalten. Gilt zusätzlich und
// unabhängig zur Rollenprüfung: der Verein muss mindestens eines der
// gelisteten Pakete gebucht haben. Aus MODULE_PACKAGES invertiert statt von
// Hand gepflegt, damit beide Tabellen nicht auseinanderlaufen. "results" ist
// die Ausnahme — Bestzeiten (times) und Wettkampfergebnisse (competitions)
// teilen sich den Store, eines der beiden Pakete genügt.
const STORE_MODULE_MAP: Record<EntityStoreName, readonly ModuleKey[]> = (() => {
  const map = Object.fromEntries(ENTITY_STORE_NAMES.map((store) => [store, [] as ModuleKey[]])) as Record<EntityStoreName, ModuleKey[]>;
  for (const key of MODULE_KEYS) {
    for (const store of MODULE_PACKAGES[key].stores) map[store].push(key);
  }
  map.results = ['times', 'competitions'];
  return map;
})();

// Ein Konto kann mehrere Rollen tragen (docs/Plans/kampfrichter-modul-plan.md,
// Abschnitt 1.4/1.5): es genügt, wenn EINE davon berechtigt ist
// (Vereinigung, nicht Gleichheit).
export function canRead(store: SyncStore, roles: readonly Role[], enabledModules: readonly string[]): boolean {
  return (
    isKnownStore(store) &&
    roles.some((role) => STORE_PERMISSIONS[store].read.has(role)) &&
    STORE_MODULE_MAP[store].some((m) => enabledModules.includes(m))
  );
}

export function canWrite(store: SyncStore, roles: readonly Role[], enabledModules: readonly string[]): boolean {
  return (
    isKnownStore(store) &&
    roles.some((role) => STORE_PERMISSIONS[store].write.has(role)) &&
    STORE_MODULE_MAP[store].some((m) => enabledModules.includes(m))
  );
}

// Die Athlet:innen-Einschränkungen auf Zeilen-/Feldebene (sync.athleteScope.ts,
// "results" in sync.service.ts) greifen nur ohne Staff-Rolle: ein Konto mit
// roles: ['trainer','athlete'] wäre sonst fälschlich auf die eigenen Daten
// verengt. Geprüft wird bewusst "keine Staff-Rolle", nicht "ausschließlich
// athlete" — eine künftige, mit "athlete" kombinierbare Rolle ohne eigenen
// Sync-Zugriff soll daran nichts ändern.
export function isAthleteScoped(roles: readonly Role[]): boolean {
  return roles.includes('athlete') && !roles.some((r) => r === 'trainer' || r === 'admin');
}
