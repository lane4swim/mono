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
//   results        | R + W   | R + W | R + W   | js/modules/times.js zeigt/bearbeitet für ALLE Rollen identisch die volle Liste.
//   plans          | R + W   | R + W | R + W   | js/modules/plans.js: ebenso, für alle Rollen shared.
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
// scopeChangeForAthlete() (Pull, siehe sync.athleteScope.ts) bzw.
// canWrite() (Push, sperrt den Store hier bereits komplett) abgedeckt —
// sie sind bewusst nicht Teil dieser generischen Rollen-Tabelle, da sie
// vom KONKRETEN Dateninhalt abhängen (eigene athleteId im
// Payload/Attendance-Eintrag), nicht nur von Rolle+Store.
import type { EntityStoreName, Role, SyncStore } from '@lane1/shared-types';

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

export function canRead(store: SyncStore, role: Role): boolean {
  return isKnownStore(store) && STORE_PERMISSIONS[store].read.has(role);
}

export function canWrite(store: SyncStore, role: Role): boolean {
  return isKnownStore(store) && STORE_PERMISSIONS[store].write.has(role);
}
