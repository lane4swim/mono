// apps/api/src/modules/sync/sync.permissions.ts
//
// Code-Review, Befund L2: aus sync.service.ts herausgelöst — eine von
// fünf Zuständigkeiten, die zuvor in einer 737-Zeilen-Datei steckten.
// Reines clubId-Scoping würde jeder authentifizierten Rolle denselben,
// vollständigen Vereinsdatensatz geben, lesend UND schreibend — diese
// Tabelle ist die EINE Stelle, die für jeden Store und jede Rolle
// zusätzlich festlegt, ob Lesen (Pull) bzw. Schreiben (Push:
// create/update/delete) erlaubt ist. push()/pull() (sync.service.ts)
// fragen ausschließlich diese Tabelle ab (canRead()/canWrite()), statt
// Rollen-Sonderfälle im Ablauf selbst zu verdrahten.
//
// BEWUSST als Whitelist, nicht als Blacklist einzelner verbotener
// Kombinationen: eine Rolle, die für einen Store nicht explizit gelistet
// ist, hat dort KEINEN Zugriff. Das ist die entscheidende Eigenschaft für
// Erweiterbarkeit — kommt künftig eine weitere Rolle hinzu (z. B.
// "co-trainer" oder "parent" in packages/shared-types/src/user.ts:
// RoleSchema), hat sie automatisch NIRGENDS Zugriff, bis sie hier für die
// passenden Stores explizit eingetragen wird. Ein Vergessen fällt so als
// "zu wenig Rechte" auf (leicht zu beheben), nicht als übersehene
// Sicherheitslücke. `Record<EntityStoreName, StoreAccess>` erzwingt
// zusätzlich zur Compile-Zeit, dass JEDER Store einen Eintrag hat — ein
// künftiger elfter Store ohne Zeile hier lässt sich nicht kompilieren.
//
// Rollen-Übersicht (siehe docs/backend-plan.md / packages/shared-types/src/
// user.ts): "superadmin" gehört zu keinem Verein und darf laut
// sync.route.ts (requireRole('trainer','admin','athlete')) ohnehin nie
// synchronisieren — taucht in keinem Set unten auf (== überall kein
// Zugriff), auch wenn requireRole() sich künftig einmal ändern sollte.
//
// Zusammenfassung Lese-/Schreibrechte je Store (R = lesen/Pull, W =
// schreiben/Push create+update+delete; "admin"/"trainer" sind für ALLE
// Stores außer "athletes" identisch, dort als "Coach" zusammengefasst):
//
//   Store          | trainer | admin | athlete | Begründung
//   ---------------|---------|-------|---------|--------------------
//   results        | R + W   | R + W   | R + W* | js/modules/times.js zeigt für ALLE Rollen identisch die volle Liste; *Schreiben für "athlete" seit Sicherheitsreview 2026-08 (Befund N1) zusätzlich auf die EIGENEN Ergebnisse verengt (Zeilenebene, siehe sync.service.ts: push() — ResultSchema.athleteId muss der eigenen athleteId entsprechen, sowohl bei einem betroffenen bestehenden Datensatz als auch im gesendeten Payload).
//   plans          | R + W   | R + W | R + W   | js/modules/plans.js: ebenso, für alle Rollen shared. BEWUSST kein athleteId-Scoping wie bei "results" (Befund N1 geprüft, aber nicht angewendet): PlanSchema hat keine Eigentümer:in auf Personenebene (nur groupId) — ein Trainingsplan ist ein Team-/Gruppendokument, kein individueller Datensatz.
//   athletes       | R only  | R + W | R only  | js/modules/athletes.js: die Seite selbst ist laut `roles:['trainer','admin']` für trainer sichtbar, aber Anlegen/Ändern des Athleten-Stamms (inkl. "notes") ist dort zusätzlich hinter isAdminOrSuperAdmin() versteckt ("Verteidigung in der Tiefe"-Kommentar in openAthleteModal()) — write bewusst NICHT im "Coach"-Profil (anders als die übrigen coachManaged-Stores unten), sonst wäre die UI-Restriktion nur Fassade. "notes" zusätzlich per scopeChangeForAthlete() beim Lesen redigiert (Zeilen-/Feldebene, siehe sync.athleteScope.ts).
//   groups         | R + W   | R + W | R only  | wird nur innerhalb von athletes.js verwaltet (kein eigenes Modul).
//   exercises      | R + W   | R + W | R only  | js/modules/catalog.js: `roles:['trainer','admin']`.
//   templates      | R + W   | R + W | R only  | js/modules/templates.js: `roles:['trainer','admin']`.
//   competitions   | R + W   | R + W | R only  | js/modules/competitions.js: `roles:['trainer','admin']`.
//   entries        | R + W   | R + W | R only  | dito (Startlisten-Verwaltung ist Teil von competitions.js).
//   actionItems    | R + W   | R + W | R only* | js/modules/actionItems.js: eigene rein lesende Athlet:innen-Ansicht (renderAthleteList); *zusätzlich per scopeChangeForAthlete() beim Lesen auf die EIGENEN Einträge gefiltert (Zeilenebene).
//   sessions       | R + W   | R + W | R only* | js/modules/sessions.js: eigene rein lesende Athlet:innen-Ansicht (renderAthleteView); *zusätzlich per scopeChangeForAthlete() beim Lesen auf die EIGENE attendance-Zeile reduziert (Zeilenebene).
//
// Diese Tabelle regelt nur die STORE-Ebene (ganzer Store lesbar/schreibbar
// ja/nein). Die mit * markierten, feineren Einschränkungen (nur eigene
// Zeile/eigenes Feld statt ganzer Store) bleiben zusätzlich über
// scopeChangeForAthlete() (Pull, siehe sync.athleteScope.ts) bzw. einer
// eigenen Prüfung in push() selbst (sync.service.ts — "results", seit
// Befund N1) abgedeckt — sie sind bewusst nicht Teil dieser generischen
// Rollen-Tabelle, da sie vom KONKRETEN Dateninhalt abhängen (eigene
// athleteId im Payload/Attendance-Eintrag/bestehenden Datensatz), nicht nur
// von Rolle+Store. canWrite() unten bleibt für "results" bewusst `shared`
// (store-weit erlaubt) — die Verengung auf eigene Datensätze passiert erst
// NACH diesem Guard, da sie den bereits geladenen "existing"-Datensatz
// braucht (push() lädt ihn ohnehin für die Konfliktentscheidung).
import type { EntityStoreName, ModuleKey, Role, SyncStore } from '@lane1/shared-types';
import { ENTITY_STORE_NAMES, MODULE_KEYS, MODULE_PACKAGES } from '@lane1/shared-types';

interface StoreAccess {
  read: ReadonlySet<Role>;
  write: ReadonlySet<Role>;
}

// Die drei Rollen, die überhaupt ein Vereinskonto haben und synchronisieren
// dürfen (siehe SyncRequester.clubId-Kommentar in sync.service.ts).
const TEAM_ROLES: readonly Role[] = ['trainer', 'admin', 'athlete'];

// Drei wiederkehrende Zugriffsprofile, um die Tabelle unten knapp zu
// halten (Bezeichner englisch, wie im übrigen Projekt üblich —
// Kommentare/Erklärungen weiterhin deutsch):
//   - shared: alle drei Rollen lesen UND schreiben (results, plans).
//   - coachManaged: alle drei Rollen lesen, nur trainer/admin schreiben
//     (sieben der übrigen acht Stores).
//   - adminManaged: alle drei Rollen lesen, NUR admin schreibt (athletes
//     — siehe Begründung in der Tabelle oben: js/modules/athletes.js
//     versteckt Anlegen/Ändern des Athleten-Stamms per isAdminOrSuperAdmin()
//     ausdrücklich auch vor "trainer", nicht nur vor "athlete"; ein
//     gemeinsames coachManaged-Profil würde diese UI-Restriktion serverseitig
//     unterlaufen — jede Person könnte per direktem Push an /api/sync
//     trotzdem als "trainer" schreiben).
const shared: StoreAccess = { read: new Set(TEAM_ROLES), write: new Set(TEAM_ROLES) };
const coachManaged: StoreAccess = { read: new Set(TEAM_ROLES), write: new Set(['trainer', 'admin']) };
const adminManaged: StoreAccess = { read: new Set(TEAM_ROLES), write: new Set(['admin']) };

export const STORE_PERMISSIONS: Record<EntityStoreName, StoreAccess> = {
  results: shared,
  plans: shared,
  athletes: adminManaged,
  groups: coachManaged,
  exercises: coachManaged,
  templates: coachManaged,
  competitions: coachManaged,
  entries: coachManaged,
  actionItems: coachManaged,
  sessions: coachManaged,
};

// Nimmt bewusst den weiteren Wire-Typ `SyncStore` entgegen (nicht nur
// `EntityStoreName`): `SyncStore` (packages/shared-types/src/syncEvent.ts)
// führt zusätzlich "users" — für die generische Sync-API (noch) kein
// echter, per ENTITY_SCHEMAS/STORE_PERMISSIONS bekannter Store (Nutzer-
// verwaltung läuft über eigene REST-Endpunkte, siehe modules/auth). Ein
// Store ohne Tabelleneintrag gilt konsequent als nicht lesbar/schreibbar
// (sicherer Default), statt bei einer künftigen Erweiterung von
// `SyncStore` einen fehlenden Eintrag hier stillschweigend durchzulassen.
export function isKnownStore(store: SyncStore): store is EntityStoreName {
  return store in STORE_PERMISSIONS;
}

// Store -> welches/welche Modul-Paket(e) (packages/shared-types/src/
// modules.ts: MODULE_PACKAGES) diesen Store freischalten — zusätzlich zur
// reinen Rollen-Prüfung oben MUSS der Verein mindestens eines der hier
// gelisteten Pakete gebucht haben (STORE_PERMISSIONS betrifft dagegen
// AUSSCHLIESSLICH Vereine, die das Modul überhaupt haben — die beiden
// Prüfungen sind unabhängig voneinander UND kombiniert erforderlich).
//
// Aus MODULE_PACKAGES[*].stores invertiert, statt redundant von Hand
// gepflegt — ein Store, der dort einem Paket zugeordnet wird, landet
// automatisch hier, ohne dass beide Tabellen synchron gehalten werden
// müssen. "results" (Bestzeiten) ist die einzige Ausnahme: der Store wird
// von ZWEI Paketen gemeinsam benutzt (times.js für die Bestzeiten-
// Verwaltung, competitionLive.js — Teil des competitions-Pakets — für
// Wettkampf-Ergebnisse) und gehört daher zu keinem der beiden exklusiv;
// Zugriff genügt, wenn EINES der beiden Pakete aktiv ist.
const STORE_MODULE_MAP: Record<EntityStoreName, readonly ModuleKey[]> = (() => {
  const map = Object.fromEntries(ENTITY_STORE_NAMES.map((store) => [store, [] as ModuleKey[]])) as Record<EntityStoreName, ModuleKey[]>;
  for (const key of MODULE_KEYS) {
    for (const store of MODULE_PACKAGES[key].stores) map[store].push(key);
  }
  map.results = ['times', 'competitions'];
  return map;
})();

// docs/kampfrichter-modul-plan.md, Abschnitt 1.4/1.5: ein Konto kann
// mehrere Rollen gleichzeitig haben — canRead()/canWrite() prüfen daher,
// ob MINDESTENS EINE der Rollen die Berechtigung hat (Vereinigung, nicht
// Gleichheit). Für die drei bestehenden Team-Rollen ist "trainer"/"admin"
// ohnehin eine Obermenge von "athlete" (siehe STORE_PERMISSIONS oben),
// eine Kombination wie ['trainer','athlete'] verhält sich damit
// automatisch wie ein reiner Trainer.
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

// Athlet:innen-spezifische Einschränkungen (Zeilen-/Feldebene beim Pull in
// sync.athleteScope.ts, Eigentümer-Verengung bei "results" in
// sync.service.ts) gelten nur, wenn KEINE der Rollen einer Person eine
// Staff-Rolle ("trainer"/"admin") ist — sonst würde ein Konto mit z. B.
// roles: ['trainer','athlete'] fälschlich auf "nur eigene Daten"
// eingeschränkt, obwohl die Trainer-Rolle vollen Zugriff verleiht. Eine
// künftig hinzukommende, mit "athlete" kombinierbare Rolle ohne eigenen
// Sync-Zugriff (siehe docs/kampfrichter-modul-plan.md, Abschnitt 1.5) soll
// an dieser Einschränkung NICHTS ändern — deshalb hier bewusst geprüft
// "keine Staff-Rolle vorhanden", nicht "ausschließlich athlete".
export function isAthleteScoped(roles: readonly Role[]): boolean {
  return roles.includes('athlete') && !roles.some((r) => r === 'trainer' || r === 'admin');
}
