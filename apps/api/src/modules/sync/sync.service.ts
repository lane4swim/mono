// apps/api/src/modules/sync/sync.service.ts
//
// Kern von Phase 3 (Backend-Entwicklungsplan, Abschnitt 6): generische
// Push/Pull-Sync-API. "Generisch" heißt hier konkret — kein separater
// Codepfad je fachlichem Store, sondern:
//   - Validierung des Payloads über ENTITY_SCHEMAS[store] (Phase 2,
//     packages/shared-types/src/entities.ts)
//   - Konfliktentscheidung über resolveConflict() (Phase 0,
//     packages/sync-protocol) — dieselbe Logik, die dort schon seit
//     Phase 0 fertig und getestet bereitliegt
//   - Anwenden über den generischen SyncGateway (Phase 2 Entity-Registry)
import { randomUUID } from 'node:crypto';
import {
  SyncEventSchema,
  ENTITY_SCHEMAS,
  type SyncEventResult,
  type SyncChange,
  type SyncStore,
  type EntityStoreName,
  type Role,
} from '@lane1/shared-types';
import { resolveConflict } from '@lane1/sync-protocol';
import type { SyncGateway, ChangedRecord } from './sync.gateway.js';

export interface SyncRequester {
  clubId: string; // Superadmin (clubId: null) darf nicht synchronisieren — siehe sync.route.ts (requireRole).
  // Für die Rollen-Scopierung unten (Sicherheitsreview, "Fehlende
  // Rollen-Scopierung in der Sync-API") — clubId allein reicht nicht:
  // ein Athlet:innen-Konto darf zwar denselben Verein sehen wie
  // Trainer:innen/Admins, aber nicht dieselbe Datentiefe (siehe Kommentar
  // bei STORE_PERMISSIONS unten).
  role: Role;
  athleteId: string | null;
}

const PULL_PAGE_SIZE = 200;

// Sicherheitsnetz für den in splitAtSafeTimestampBoundary() beschriebenen
// Extremfall (das GESAMTE Blickfenster von PULL_PAGE_SIZE+1 Zeilen teilt
// sich einen einzigen Zeitstempel): eine gezielte Nachfrage GENAU dieses
// Zeitstempels darf nicht unbegrenzt viele Zeilen laden — dieser Wert
// deckelt sie. Deutlich größer als PULL_PAGE_SIZE, da er einen praktisch
// nie erreichten Rand abdeckt, nicht den Normalfall.
const PULL_TIE_SAFETY_LIMIT = 5000;

// ---- Rollen-/Store-Berechtigungsmatrix ------------------------------------
//
// Hintergrund (siehe Sicherheitsreview): die generische Sync-API kannte
// ursprünglich NUR clubId-Scoping — jede authentifizierte Rolle bekam
// denselben, vollständigen Vereinsdatensatz, lesend UND schreibend. Diese
// Tabelle ist die EINE Stelle, die für jeden Store und jede Rolle festlegt,
// ob Lesen (Pull) bzw. Schreiben (Push: create/update/delete) erlaubt ist —
// push()/pull() unten fragen ausschließlich diese Tabelle ab (canRead()/
// canWrite()), statt Rollen-Sonderfälle im Ablauf selbst zu verdrahten.
//
// BEWUSST als Whitelist (statt der früheren Blacklist
// "ATHLETE_WRITE_FORBIDDEN_STORES", die nur "athlete" kannte): eine Rolle,
// die für einen Store nicht explizit gelistet ist, hat dort KEINEN Zugriff.
// Das ist die entscheidende Eigenschaft für Erweiterbarkeit — kommt künftig
// eine weitere Rolle hinzu (z. B. "co-trainer" oder "parent" in
// packages/shared-types/src/user.ts: RoleSchema), hat sie automatisch
// NIRGENDS Zugriff, bis sie hier für die passenden Stores explizit
// eingetragen wird. Ein Vergessen fällt so als "zu wenig Rechte" auf (leicht
// zu beheben), nicht als übersehene Sicherheitslücke (siehe genau der Fall,
// der zur bisherigen Erweiterung von ATHLETE_WRITE_FORBIDDEN_STORES führte).
// `Record<EntityStoreName, StoreAccess>` erzwingt zusätzlich zur Compile-
// Zeit, dass JEDER Store einen Eintrag hat — ein künftiger elfter Store
// ohne Zeile hier lässt sich nicht kompilieren.
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
//   athletes       | R only  | R + W | R only  | js/modules/athletes.js: die Seite selbst ist laut `roles:['trainer','admin']` für trainer sichtbar, aber Anlegen/Ändern des Athleten-Stamms (inkl. "notes") ist dort zusätzlich hinter isAdminOrSuperAdmin() versteckt ("Verteidigung in der Tiefe"-Kommentar in openAthleteModal()) — write bewusst NICHT im "Coach"-Profil (anders als die übrigen coachManaged-Stores unten), sonst wäre die UI-Restriktion nur Fassade. "notes" zusätzlich per scopeChangeForAthlete() beim Lesen redigiert (Zeilen-/Feldebene, siehe unten).
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
// scopeChangeForAthlete() (Pull) bzw. die ATHLETE_WRITE_FORBIDDEN_STORES-
// Vorgängerin ersetzenden canWrite()-Prüfung (Push, sperrt den Store hier
// bereits komplett) abgedeckt — sie sind bewusst nicht Teil dieser
// generischen Rollen-Tabelle, da sie vom KONKRETEN Dateninhalt abhängen
// (eigene athleteId im Payload/Attendance-Eintrag), nicht nur von Rolle+Store.
interface StoreAccess {
  read: ReadonlySet<Role>;
  write: ReadonlySet<Role>;
}

// Die drei Rollen, die überhaupt ein Vereinskonto haben und synchronisieren
// dürfen (siehe SyncRequester.clubId-Kommentar oben).
const TEAM_ROLES: readonly Role[] = ['trainer', 'admin', 'athlete'];

// Drei wiederkehrende Zugriffsprofile, um die Tabelle unten knapp zu halten
// (Code-Review, Befund W2: hießen zuvor "geteilt"/"coachVerwaltet"/
// "adminVerwaltet" — deutsche Bezeichner inmitten einer sonst
// durchgängig englischen Codebasis, direkt neben STORE_PERMISSIONS/
// canRead/canWrite. Konvention wie im übrigen Projekt: Bezeichner
// englisch, Kommentare/Erklärungen weiterhin deutsch):
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

const STORE_PERMISSIONS: Record<EntityStoreName, StoreAccess> = {
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
function isKnownStore(store: SyncStore): store is EntityStoreName {
  return store in STORE_PERMISSIONS;
}

function canRead(store: SyncStore, role: Role): boolean {
  return isKnownStore(store) && STORE_PERMISSIONS[store].read.has(role);
}

function canWrite(store: SyncStore, role: Role): boolean {
  return isKnownStore(store) && STORE_PERMISSIONS[store].write.has(role);
}

// ---- Fremdschlüssel-Eigentümerprüfung ------------------------------------
//
// Sicherheitsreview (Nachtrag): das Vereins-Scoping oben deckt nur die
// clubId des Top-Level-Datensatzes selbst ab. Mehrere Stores referenzieren
// aber ZUSÄTZLICH andere fachliche Entitäten über eine ID (athleteId,
// groupId, competitionId, planId, assignedTrainerId) — die Zod-Schemas in
// packages/shared-types/src/entities.ts prüfen dafür nur das UUID-Format,
// nicht die Zugehörigkeit zum eigenen Verein. Ohne diese Prüfung könnte
// z. B. ein Trainer aus Verein A ein Ergebnis mit clubId=A, aber einer
// bekannten/erratenen athleteId aus Verein B einreichen — Prismas
// Fremdschlüssel-Constraint verlangt nur, dass die Zeile IRGENDWO
// existiert, nicht im richtigen Verein. Das ermöglichte sowohl eine
// Cross-Tenant-Datenverknüpfung (fabrizierte Ergebnisse/Handlungsfelder an
// fremde Athlet:innen-IDs) als auch ein Existenz-Orakel über
// Vereinsgrenzen hinweg (unterscheidbare Antworten für "existiert
// nirgends" vs. "existiert in fremdem Verein"). Analog zum bereits
// bestehenden Muster in invitations.service.ts (AthleteClubMismatchError)
// wird hier für jedes referenzierte Feld geprüft, dass die Zielentität
// TATSÄCHLICH zum eigenen Verein gehört.
type ForeignKeyRef =
  | { field: string; store: EntityStoreName } // referenziert einen der zehn fachlichen Sync-Stores
  | { field: string; kind: 'user' } // referenziert users.id (kein Sync-Store, siehe findClubIdForUser())
  | { kind: 'nested'; store: EntityStoreName; extract: (payload: Record<string, unknown>) => string[] }; // mehrere Referenzen verschachtelt im Payload, siehe collectSetExerciseIds() unten

// "templates.sets" und "plans.days[].sets" tragen dieselbe SetEntry[]-Struktur
// (packages/shared-types/src/entities.ts: PlainSetSchema/RepeatBlockSchema)
// wie das Frontend in js/modules/setEditor.js verwendet: ein Eintrag ist
// entweder ein einzelner Satz (kind: 'set', trägt optional eine exerciseId)
// oder ein Block (kind: 'block'), der wiederum mehrere einzelne Sätze
// enthält (keine verschachtelten Blöcke). Anders als athleteId/groupId/
// competitionId/assignedTrainerId ist exerciseId hier NICHT top-level,
// sondern beliebig tief in diesem Array verschachtelt — die generische
// { field, store }-Form von ForeignKeyRef (die nur payload[field] liest)
// erreicht sie nicht. Diese Funktion sammelt alle gesetzten exerciseId-Werte
// aus einem SetEntry[]-Array unabhängig von der Verschachtelung ein, damit
// assertForeignKeysWithinClub() jede davon genauso gegen den eigenen Verein
// prüfen kann wie jede andere Fremdschlüssel-Referenz.
function collectSetExerciseIds(sets: unknown): string[] {
  if (!Array.isArray(sets)) return [];
  const ids: string[] = [];
  for (const entry of sets) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as { kind?: unknown; exerciseId?: unknown; sets?: unknown };
    if (e.kind === 'set') {
      if (typeof e.exerciseId === 'string') ids.push(e.exerciseId);
    } else if (e.kind === 'block') {
      ids.push(...collectSetExerciseIds(e.sets));
    }
  }
  return ids;
}

const FOREIGN_KEY_REFS: Partial<Record<EntityStoreName, ForeignKeyRef[]>> = {
  athletes: [{ field: 'groupId', store: 'groups' }],
  results: [
    { field: 'athleteId', store: 'athletes' },
    { field: 'competitionId', store: 'competitions' },
  ],
  entries: [
    { field: 'athleteId', store: 'athletes' },
    { field: 'competitionId', store: 'competitions' },
  ],
  actionItems: [
    { field: 'athleteId', store: 'athletes' },
    { field: 'assignedTrainerId', kind: 'user' },
  ],
  templates: [
    { kind: 'nested', store: 'exercises', extract: (payload) => collectSetExerciseIds(payload.sets) },
  ],
  plans: [
    { field: 'groupId', store: 'groups' },
    {
      kind: 'nested',
      store: 'exercises',
      extract: (payload) =>
        Array.isArray(payload.days)
          ? (payload.days as unknown[]).flatMap((day) => collectSetExerciseIds((day as { sets?: unknown } | null)?.sets))
          : [],
    },
  ],
  sessions: [
    { field: 'groupId', store: 'groups' },
    { field: 'planId', store: 'plans' },
  ],
};

// Bewusst dieselbe Formulierung wie describeSyncError() für Prismas
// "P2003" (siehe unten) — macht "Referenz existiert gar nicht" und
// "Referenz gehört einem fremden Verein" für den Aufrufer ununterscheidbar
// und schließt so das Existenz-Orakel, statt es nur zu verschieben.
const FOREIGN_ENTITY_ERROR =
  'Die referenzierte Person oder der referenzierte Datensatz existiert nicht mehr (wurde vermutlich zwischenzeitlich endgültig gelöscht).';

// Prüft alle für `store` relevanten Fremdschlüsselfelder eines bereits
// Zod-validierten Payloads: jede gesetzte (nicht-null/undefined) Referenz
// muss zu genau `clubId` gehören. `findById()` ist bereits club-gescoped
// (liefert null sowohl bei "nicht gefunden" als auch bei "fremder
// Verein", siehe sync.gateway.ts) — das reicht hier direkt aus, ohne
// zwischen beiden Fällen unterscheiden zu müssen.
async function assertForeignKeysWithinClub(
  gateway: SyncGateway,
  store: EntityStoreName,
  payload: Record<string, unknown>,
  clubId: string,
): Promise<string | null> {
  const refs = FOREIGN_KEY_REFS[store];
  if (!refs) return null;

  for (const ref of refs) {
    if ('kind' in ref && ref.kind === 'nested') {
      for (const value of ref.extract(payload)) {
        const ownedByClub = (await gateway.findById(ref.store, value, clubId)) !== null;
        if (!ownedByClub) return FOREIGN_ENTITY_ERROR;
      }
      continue;
    }

    const value = payload[ref.field];
    if (value === null || value === undefined) continue; // optionale Referenz, nicht gesetzt

    const ownedByClub =
      'store' in ref
        ? (await gateway.findById(ref.store, value as string, clubId)) !== null
        : (await gateway.findClubIdForUser(value as string)) === clubId;

    if (!ownedByClub) return FOREIGN_ENTITY_ERROR;
  }
  return null;
}

// Prüft, ob eine Rolle="athlete" auf ein Attendance-Element eines
// TrainingSession-Payloads zugreifen darf (nur das eigene).
function isOwnAttendanceRecord(record: unknown, athleteId: string | null): boolean {
  return (
    !!athleteId &&
    typeof record === 'object' &&
    record !== null &&
    (record as { athleteId?: unknown }).athleteId === athleteId
  );
}

// Entscheidet für einen einzelnen Pull-Change, ob (und in welcher Form) er
// an eine Person mit Rolle "athlete" ausgeliefert werden darf. Gibt `null`
// zurück, wenn der Change komplett unterdrückt werden soll.
function scopeChangeForAthlete(change: SyncChange, athleteId: string | null): SyncChange | null {
  if (change.action === 'delete') {
    // Tombstones enthalten kein Payload (nur die entityId) — daraus lässt
    // sich keine Eigentümerschaft mehr ableiten. Sie werden unverändert
    // durchgereicht: eine gelöschte fremde entityId ohne Inhalt ist keine
    // schützenswerte Information.
    return change;
  }

  if (change.store === 'actionItems') {
    const payload = change.payload as { athleteId?: unknown } | null;
    if (payload?.athleteId !== athleteId) return null;
    return change;
  }

  if (change.store === 'sessions') {
    const payload = change.payload as { attendance?: unknown[] } | null;
    const attendance = Array.isArray(payload?.attendance) ? payload!.attendance : [];
    const ownRecord = attendance.find((a) => isOwnAttendanceRecord(a, athleteId));
    if (!ownRecord) return null; // diese Einheit betrifft die anfragende Person gar nicht
    // Die übrigen `attendance`-Einträge (Anwesenheit/RPE/Notiz anderer
    // Athlet:innen) werden entfernt — nur der eigene Eintrag bleibt.
    return { ...change, payload: { ...(payload as object), attendance: [ownRecord] } };
  }

  if (change.store === 'athletes') {
    // "notes" ist ein freies Trainer:innen-Notizfeld (siehe
    // apps/web/js/modules/athletes.js — das einzige Modul, das dieses
    // Feld überhaupt anzeigt, ist auf roles: ['trainer','admin']
    // beschränkt). Für Rolle "athlete" bleibt der restliche Athletendatensatz
    // (Name, Gruppe, …) sichtbar — der wird für Team-weite Ansichten wie
    // Zeiten/Trainingspläne gebraucht (siehe times.js/plans.js) — nur
    // "notes" wird redigiert, und zwar sowohl bei fremden als auch beim
    // eigenen Datensatz (die Notiz ist grundsätzlich coach-intern, nicht
    // athletenspezifisch geheim vs. offen).
    const payload = change.payload as Record<string, unknown> | null;
    if (!payload) return change;
    return { ...change, payload: { ...payload, notes: '' } };
  }

  return change;
}

// Sicherheitskorrektur (Code-Review, kritischer Befund 3 — Pagination):
// listChangedSince() liefert Zeilen aufsteigend nach `updatedAt` sortiert,
// über alle zehn fachlichen Stores UND Tombstones hinweg zusammengeführt.
// Teilen sich zwei Zeilen exakt denselben Zeitstempel (z. B. weil mehrere
// Events desselben Push-Batches innerhalb derselben Millisekunde
// angewendet wurden — auf schnellem lokalem Postgres realistisch) und
// läge die Seitengrenze GENAU zwischen ihnen, würde die zweite Zeile beim
// nächsten Pull übersprungen: der neue Cursor ist exakt dieser Zeitstempel,
// die Folgeabfrage filtert mit `updatedAt > cursor` (strikt) — eine Zeile
// mit GLEICHEM Zeitstempel, die "hinter" dieser Grenze lag, erscheint
// darin nie wieder (stiller Datenverlust für andere Geräte).
//
// Diese Funktion verschiebt die Seitengrenze deshalb NIE mitten in eine
// Gruppe gleicher Zeitstempel: sie kürzt die übergebenen (bereits sortierten)
// Zeilen so weit, bis entweder eine echte Zeitstempel-Grenze erreicht ist,
// oder — im Extremfall, dass ALLE `pageSize + 1` gepufferten Zeilen
// denselben Zeitstempel tragen — nichts übrig bleibt. Dieser Randfall wird
// von pull() gesondert über eine gezielte Nachfrage aufgelöst (siehe dort);
// ansonsten werden die abgeschnittenen Zeilen einfach NICHT ausgeliefert —
// sie kommen vollständig (nie aufgeteilt) auf der nächsten Seite an, sobald
// der Cursor noch auf der letzten sicheren Zeitstempel-Grenze steht.
//
// Bewusst als eigenständige, exportierte, reine Funktion — direkt testbar
// ohne Gateway/Datenbank.
export function splitAtSafeTimestampBoundary(rows: ChangedRecord[], pageSize: number): ChangedRecord[] {
  if (rows.length <= pageSize) return rows;
  let cut = pageSize;
  while (cut > 0 && rows[cut]!.updatedAt.getTime() === rows[cut - 1]!.updatedAt.getTime()) cut--;
  return rows.slice(0, cut);
}

export function createSyncService(deps: { gateway: SyncGateway }) {
  return {
    // `events: unknown[]` statt `SyncEvent[]` (Code-Review, Befund R3): die
    // Route (sync.route.ts) lockert die Batch-weite Prüfung inzwischen auf
    // die reine Array-Länge (siehe SyncPushRequestSchema) — die
    // STRUKTURELLE Prüfung jedes einzelnen Events übernimmt ausschließlich
    // dieser Codepfad hier (SyncEventSchema.safeParse(rawEvent) unten), der
    // dadurch erstmals tatsächlich erreichbar ist: ein einzelnes
    // fehlerhaftes Event scheitert jetzt nur noch selbst (als "error"-
    // Ergebnis), statt den gesamten Batch abzulehnen.
    async push(events: unknown[], requester: SyncRequester): Promise<SyncEventResult[]> {
      const results: SyncEventResult[] = [];

      for (const rawEvent of events) {
        const parsedEvent = SyncEventSchema.safeParse(rawEvent);
        if (!parsedEvent.success) {
          results.push({ eventId: (rawEvent as { id?: string })?.id ?? 'unknown', status: 'error', message: 'Event-Struktur ungültig.' });
          continue;
        }
        const event = parsedEvent.data;

        // "store" ist laut SyncEventSchema nur als der breitere Wire-Typ
        // `SyncStore` geprüft (der zusätzlich "users" kennt, siehe
        // isKnownStore()-Kommentar oben — Nutzerverwaltung läuft über
        // eigene REST-Endpunkte, nicht über diese generische Sync-API).
        // Ohne diese Prüfung würde ein Event mit einem solchen, hier
        // unbekannten Store weiter unten bei `ENTITY_SCHEMAS[store]` bzw.
        // `getEntityDelegate()` auf ein fehlendes Delegate treffen und die
        // gesamte Anfrage mit einer rohen TypeError abbrechen, statt als
        // reguläres "error"-Ergebnis für genau dieses Event gemeldet zu
        // werden.
        if (!isKnownStore(event.store)) {
          results.push({ eventId: event.id, status: 'error', message: `Unbekannter Store "${event.store}".` });
          continue;
        }
        const store = event.store;

        // Rollen-Scopierung (siehe STORE_PERMISSIONS oben): unabhängig von
        // action (create/update/delete) und unabhängig davon, ob der
        // Datensatz der anfragenden Person selbst "gehört" — wer für einen
        // Store laut Tabelle nicht schreiben darf, kommt hier gar nicht
        // erst weiter. Für die betroffenen Stores bietet das Frontend
        // ohnehin keine Schreib-UI für diese Rolle; diese Prüfung schließt
        // lediglich die serverseitige Lücke.
        if (!canWrite(store, requester.role)) {
          results.push({
            eventId: event.id,
            status: 'error',
            message: `Die Rolle "${requester.role}" darf den Store "${store}" nicht verändern.`,
          });
          continue;
        }

        // Idempotenz-FAST-PATH: bereits verarbeitete Events werden als
        // "applied" gemeldet (nicht als Fehler), damit ein Client, der
        // wegen eines Verbindungsabbruchs dieselbe Antwort nicht sah, beim
        // erneuten Senden ein konsistentes Ergebnis bekommt. clubId-gescoped
        // (siehe SyncGateway.isEventProcessed()-Kommentar) — ein fremdes,
        // erratenes Event-ID bekommt dadurch die korrekte, ungescopte
        // Antwort statt eines wirkungslosen "applied".
        //
        // Bewusst nur ein FAST-PATH, keine alleinige Korrektheitsgarantie
        // mehr (Code-Review, Befund C3): dieser Check ist ein reines
        // Check-then-Act ohne Sperre — zwei praktisch gleichzeitige Pushes
        // desselben Events könnten diese Prüfung beide passieren, bevor
        // eine von beiden den Ledger-Eintrag geschrieben hat. Er spart in
        // diesem (Normal-)Fall lediglich die nachfolgende Schema-/
        // Fremdschlüssel-Prüfung sowie den Transaktionsversuch für ein
        // Event, dessen Ergebnis ohnehin feststeht. Die tatsächliche,
        // nebenläufigkeitssichere Garantie liefert erst
        // applyAndMarkProcessed() weiter unten, das die Datenänderung UND
        // den Ledger-Eintrag atomar in einer Transaktion zusammenfasst.
        if (await deps.gateway.isEventProcessed(event.id, requester.clubId)) {
          results.push({ eventId: event.id, status: 'applied' });
          continue;
        }

        // Payload-Validierung (nur bei create/update — delete hat kein Payload).
        // WICHTIG: `validatedPayload` (das Ergebnis von Zods .strict()-Parsing)
        // wird ab hier für ALLES verwendet — die clubId-Prüfung, die
        // Konfliktentscheidung und vor allem die eigentlichen
        // create()/update()-Aufrufe weiter unten. Der rohe `event.payload`
        // wird NICHT mehr an das Gateway durchgereicht: Da die Entity-Schemas
        // jetzt `.strict()` sind, würde Zod zusätzliche, im Schema nicht
        // vorgesehene Felder (z. B. "deletedAt", das kein Zod-Feld ist, aber
        // eine echte Prisma-Spalte) zwar ablehnen — das nützt aber nichts,
        // wenn hinterher trotzdem der ungeprüfte Rohwert an Prisma
        // weitergereicht wird. Erst die Verwendung von validatedPayload
        // schließt das Mass-Assignment-Risiko tatsächlich (siehe
        // Sicherheitsreview, Punkt 8/Nachtrag).
        let validatedPayload: Record<string, unknown> | null = null;
        if (event.action !== 'delete') {
          const entitySchema = ENTITY_SCHEMAS[store];
          const parsedPayload = entitySchema.safeParse(event.payload);
          if (!parsedPayload.success) {
            results.push({ eventId: event.id, status: 'error', message: `Payload entspricht nicht dem Schema für "${store}".` });
            continue;
          }
          // Sicherheitskorrektur (Code-Review): "createdAt"/"updatedAt" sind
          // im Entity-Schema Pflichtfelder (siehe packages/shared-types/src/
          // entities.ts) — der CLIENT setzt sie beim lokalen Anlegen/Ändern
          // (apps/web/js/db.js: put()) und schickt sie mit. Würden sie
          // unverändert an create()/update() weitergereicht, bestimmte die
          // lokale Client-Uhr (nicht der Server) den Zeitpunkt, der
          // gleichzeitig als PULL-Sync-Cursor dient (siehe pull() unten,
          // listChangedSince()) — eine vor- oder zurückgestellte Client-Uhr
          // ließe einen Datensatz entweder permanent als "neuester Stand"
          // erscheinen oder ihn für andere Geräte, deren Cursor bereits
          // dahinter liegt, dauerhaft unsichtbar bleiben (stiller
          // Datenverlust). Beide Felder werden daher entfernt, BEVOR der
          // Payload für irgendetwas (clubId-Prüfung, Fremdschlüssel-Prüfung,
          // create()/update()) verwendet wird — Prismas `@default(now())`
          // bzw. `@updatedAt` (siehe schema.prisma) setzen sie serverseitig
          // sowohl bei create() als auch bei update() automatisch.
          const { createdAt: _createdAt, updatedAt: _updatedAt, ...rest } = parsedPayload.data as Record<string, unknown>;
          validatedPayload = rest;
        }

        // Vereins-Scoping: ein Event darf nur Daten des eigenen Vereins
        // betreffen — verhindert, dass ein manipulierter Client Daten
        // eines fremden Vereins schreibt/löscht.
        const payloadClubId = (validatedPayload as { clubId?: string } | null)?.clubId;
        if (event.action !== 'delete' && payloadClubId !== requester.clubId) {
          results.push({ eventId: event.id, status: 'error', message: 'clubId des Events stimmt nicht mit dem eigenen Verein überein.' });
          continue;
        }

        // Fremdschlüssel-Eigentümerprüfung (siehe Kommentar bei
        // FOREIGN_KEY_REFS oben): erst NACH der clubId-Prüfung des
        // Top-Level-Datensatzes, aber VOR jedem Lese-/Schreibzugriff, der
        // referenzierte IDs verwenden würde — ein Event mit einer
        // clubId-fremden Referenz (z. B. athleteId eines fremden Vereins)
        // wird komplett zurückgewiesen, statt teilweise angewendet zu werden.
        if (event.action !== 'delete') {
          const fkError = await assertForeignKeysWithinClub(deps.gateway, store, validatedPayload as Record<string, unknown>, requester.clubId);
          if (fkError) {
            results.push({ eventId: event.id, status: 'error', message: fkError });
            continue;
          }
        }

        // WICHTIG: clubId wird IMMER mitgegeben. Ein Datensatz eines
        // fremden Vereins gilt dadurch für den gesamten weiteren Ablauf
        // (Konfliktentscheidung, serverVersion im Response, update()) als
        // nicht existent — verhindert sowohl einen Infoleak über das
        // "conflict"-Ergebnis (Punkt 2 des Sicherheitsreviews) als auch,
        // dass unten fälschlich der update()-Zweig statt insert-as-new/
        // create() gewählt wird.
        const existing = await deps.gateway.findById(store, event.entityId, requester.clubId);

        const decision = resolveConflict(
          store,
          { clientUpdatedAt: event.clientUpdatedAt },
          existing ? { updatedAt: existing.updatedAt.toISOString() } : null,
        );

        if (decision.outcome === 'conflict-server-wins') {
          // Kein Redaktionsbedarf für Rolle "athlete" hier (anders als beim
          // Pull, siehe scopeChangeForAthlete): "athletes" steht laut
          // STORE_PERMISSIONS oben für diese Rolle nicht mehr bis hierher —
          // canWrite() weist einen Push-Versuch bereits ganz oben ab,
          // dieser Zweig ist für "athlete" auf "athletes" also unerreichbar.
          results.push({ eventId: event.id, status: 'conflict', serverVersion: existing as Record<string, unknown> | null });
          continue;
        }

        // Ledger-Eintrag für applyAndMarkProcessed() unten — identisch für
        // alle vier Zweige, daher hier einmal statt viermal aufgebaut.
        const ledgerEvent = { id: event.id, clubId: requester.clubId, store, action: event.action };

        try {
          if (event.action === 'delete') {
            // Sicherheitskorrektur (Code-Review, Befund C3): Datenänderung
            // UND Ledger-Eintrag werden jetzt ATOMAR in einer Transaktion
            // geschrieben (siehe applyAndMarkProcessed()) statt in zwei
            // getrennten Schritten — brach der Prozess vormals zwischen
            // beiden ab (Deploy, OOM, DB-Verbindungsabbruch), wurde ein
            // erneut gesendetes Event beim Retry ein zweites Mal
            // angewendet. Der Rückgabewert ('applied' vs.
            // 'already-processed') ändert die Antwort für delete/update/
            // reguläres create NICHT (siehe unten) — nur der
            // insert-as-new-Zweig braucht ihn, um zu wissen, ob die HIER
            // erzeugte serverVersion.id tatsächlich geschrieben wurde.
            await deps.gateway.applyAndMarkProcessed({ kind: 'softDelete', store, id: event.entityId, clubId: requester.clubId }, ledgerEvent);
            results.push({ eventId: event.id, status: 'applied' });
          } else if (decision.outcome === 'insert-as-new') {
            // "results": nie überschreiben. Die eingehende Payload trägt
            // dieselbe (client-generierte) id wie der bereits bestehende,
            // neuere Server-Datensatz — würde sie unverändert übernommen,
            // überschriebe create()/update() genau die Zeile, die laut
            // Konfliktregel erhalten bleiben soll. Stattdessen wird eine
            // NEUE Server-id vergeben; der Client erfährt sie über
            // serverVersion und muss seinen lokalen Datensatz entsprechend
            // nachziehen (z. B. die alte id durch die neue ersetzen).
            const newId = randomUUID();
            const outcome = await deps.gateway.applyAndMarkProcessed(
              { kind: 'create', store, payload: { ...(validatedPayload as Record<string, unknown>), id: newId } },
              ledgerEvent,
            );
            // 'already-processed': ein GLEICHZEITIGER Versuch hat den
            // Ledger-Eintrag zuerst geschrieben — DIESER Aufruf hat seine
            // eigene, hier lokal erzeugte newId dadurch NIE tatsächlich
            // gespeichert. Sie in serverVersion zu melden wäre eine
            // Phantom-id, die es in der Datenbank nicht gibt. serverVersion
            // bleibt in diesem Fall daher bewusst weg — identisch zum
            // Verhalten des isEventProcessed()-Fast-Pfads oben, der für
            // exakt denselben "das ist längst passiert"-Fall ebenfalls
            // ohne serverVersion antwortet.
            results.push(
              outcome === 'applied'
                ? { eventId: event.id, status: 'applied', serverVersion: { id: newId } }
                : { eventId: event.id, status: 'applied' },
            );
            continue;
          } else if (existing) {
            await deps.gateway.applyAndMarkProcessed(
              { kind: 'update', store, id: event.entityId, clubId: requester.clubId, payload: validatedPayload as Record<string, unknown> },
              ledgerEvent,
            );
            results.push({ eventId: event.id, status: 'applied' });
          } else {
            await deps.gateway.applyAndMarkProcessed({ kind: 'create', store, payload: validatedPayload as Record<string, unknown> }, ledgerEvent);
            results.push({ eventId: event.id, status: 'applied' });
          }
        } catch (err) {
          results.push({ eventId: event.id, status: 'error', message: describeSyncError(err) });
        }
      }

      return results;
    },

    async pull(
      query: { since?: string; cursor?: string },
      requester: SyncRequester,
    ): Promise<{ changes: SyncChange[]; nextCursor: string | null; hasMore: boolean }> {
      const since = query.cursor ? new Date(query.cursor) : query.since ? new Date(query.since) : null;
      const rows = await deps.gateway.listChangedSince(requester.clubId, since, PULL_PAGE_SIZE + 1);
      // Bleibt für den Rest der Funktion unverändert — auch im
      // Extremfall-Zweig unten (siehe dortiger Kommentar: dort wird
      // absichtlich weiterhin `true` angenommen, nicht neu berechnet).
      const hasMore = rows.length > PULL_PAGE_SIZE;
      let page = splitAtSafeTimestampBoundary(rows, PULL_PAGE_SIZE);

      // Extremfall von splitAtSafeTimestampBoundary(): das GESAMTE
      // Blickfenster (PULL_PAGE_SIZE + 1 Zeilen) trägt denselben
      // Zeitstempel — innerhalb des bereits geladenen Fensters gibt es
      // keine sichere Schnittstelle. Eine gezielte Nachfrage GENAU dieses
      // Zeitstempels (mit einem deutlich höheren, aber endlichen Limit)
      // löst ihn vollständig auf, BEVOR der Cursor darauf gesetzt wird —
      // sonst träte beim nächsten Pull exakt derselbe Sprung erneut auf.
      // `hasMore` bleibt danach vorsorglich `true`: ob darüber hinaus noch
      // mehr wartet, ist nicht sicher bekannt (der Sicherheits-Deckel
      // könnte selbst schon ausgeschöpft sein) — ein harmloser zusätzlicher
      // Pull-Zyklus klärt das.
      if (hasMore && page.length === 0) {
        const tiedAt = rows[0]!.updatedAt;
        const widened = await deps.gateway.listChangedSince(requester.clubId, new Date(tiedAt.getTime() - 1), PULL_TIE_SAFETY_LIMIT);
        page = widened.filter((row) => row.updatedAt.getTime() === tiedAt.getTime());
      }

      let changes: SyncChange[] = page.map((row) => ({
        store: row.store,
        entityId: row.entityId,
        action: row.action,
        payload: row.payload,
        updatedAt: row.updatedAt.toISOString(),
      }));

      // Rollen-Scopierung beim Lesen, Store-Ebene (siehe STORE_PERMISSIONS
      // oben): Changes aus einem Store, den die anfragende Rolle laut
      // Tabelle gar nicht lesen darf, werden komplett unterdrückt. Mit den
      // heutigen drei synchronisierenden Rollen (trainer/admin/athlete) ist
      // das noch ein No-Op — jeder Store ist für alle drei lesbar (siehe
      // Tabelle) — aber der Mechanismus greift automatisch, sobald künftig
      // eine Rolle mit eingeschränktem Lesezugriff hinzukommt.
      changes = changes.filter((change) => canRead(change.store, requester.role));

      // Rollen-Scopierung beim Lesen, Zeilen-/Feld-Ebene: zusätzlich zur
      // Store-Ebene oben werden für Rolle "athlete" "actionItems" auf
      // eigene Einträge gefiltert, "sessions" auf die eigene Zeile im
      // attendance-Array reduziert bzw. komplett ausgeblendet (wenn die
      // anfragende Person gar nicht Teil der Einheit war), und bei
      // "athletes" das "notes"-Feld redigiert (siehe scopeChangeForAthlete).
      // Diese Feinheiten hängen vom KONKRETEN Dateninhalt ab, nicht nur von
      // Rolle+Store, und bleiben daher bewusst außerhalb von
      // STORE_PERMISSIONS. WICHTIG: die Filterung erfolgt NACH der
      // Pagination (auf `page`, nicht auf `rows`) — `hasMore`/`nextCursor`
      // bleiben dadurch unverändert korrekt, auch wenn dem Client dadurch
      // weniger als PULL_PAGE_SIZE sichtbare Changes in dieser Seite ankommen.
      if (requester.role === 'athlete') {
        changes = changes
          .map((change) => scopeChangeForAthlete(change, requester.athleteId))
          .filter((change): change is SyncChange => change !== null);
      }

      // Sicherheitskorrektur (Code-Review, kritischer Befund 1): `nextCursor`
      // wird jetzt IMMER zurückgegeben, sobald diese Seite Zeilen enthält —
      // nicht mehr nur, wenn `hasMore` gesetzt ist. Vormals blieb der Cursor
      // auf der jeweils LETZTEN Seite eines Sync-Zyklus `null`, und der
      // Client (syncClient.js: pull()) persistiert einen Cursor nur, wenn er
      // nicht `null` ist — passen alle Änderungen eines Vereins in eine
      // einzige Seite (der Normalfall bei ≤ PULL_PAGE_SIZE Änderungen seit
      // dem letzten Sync), wurde dadurch NIE ein Cursor gespeichert: jeder
      // automatische Hintergrund-Sync (alle 60 s, siehe app.js) zog seither
      // dauerhaft den kompletten Vereinsbestand erneut. `page` ist nach der
      // Grenzbehandlung oben (splitAtSafeTimestampBoundary()) niemals leer,
      // solange `rows` selbst nicht leer war — der Cursor zeigt also immer
      // auf die tatsächlich zuletzt ausgelieferte Zeile.
      const lastRow = page.at(-1);
      const nextCursor = lastRow ? lastRow.updatedAt.toISOString() : null;
      return { changes, nextCursor, hasMore };
    },
  };
}

export type SyncService = ReturnType<typeof createSyncService>;

// Generische Meldung für jeden Fehler, der KEINEM der unten explizit
// behandelten Prisma-Fehlercodes entspricht (siehe describeSyncError()).
const GENERIC_SYNC_ERROR_MESSAGE = 'Der Vorgang konnte nicht angewendet werden (interner Fehler).';

// Verbesserung: Prismas Fremdschlüssel-Verletzung (Fehlercode "P2003")
// tritt konkret dann auf, wenn ein Event auf eine Person verweist, die
// zwischenzeitlich endgültig gelöscht wurde (siehe
// jobs/purgeExpiredDeletions.ts) — die referenzierte Zeile existiert dann
// physisch nicht mehr. Statt der rohen, technischen Postgres-Meldung
// ("Foreign key constraint failed on the field: ...") bekommt der Client
// eine verständliche Erklärung. Bewusst als eigenständige, exportierte
// Funktion (statt Prisma.PrismaClientKnownRequestError zu importieren) —
// so lässt sie sich direkt testen, ohne einen echten generierten Prisma-
// Client zu brauchen, und funktioniert unabhängig davon, welche konkrete
// Fehlerklasse eine Gateway-Implementierung tatsächlich wirft.
//
// Sicherheitskorrektur (Code-Review): vormals wurde für jeden Fehler ohne
// erkannten Code `err.message` UNVERÄNDERT an den Client zurückgegeben.
// Prismas rohe Fehlertexte (z. B. "Unique constraint failed on the
// fields: (`tokenHash`)" bei P2002, oder die Meldung zu "P2025" — Record
// not found, tritt z. B. bei einem clubId-fremden update()/softDelete()
// auf, siehe sync.gateway.ts) nennen Spalten-/Tabellen-/Constraint-Namen
// aus dem internen Datenbankschema — ein Informationsleck, das der Rest
// dieses Moduls bewusst vermeidet (siehe InvalidCredentialsError,
// FOREIGN_ENTITY_ERROR oben, beide absichtlich generisch formuliert).
// Jeder nicht explizit behandelte Fehler wird daher stattdessen
// serverseitig geloggt und nur generisch beantwortet.
export function describeSyncError(err: unknown): string {
  const code = err && typeof err === 'object' && 'code' in err ? (err as { code?: unknown }).code : undefined;

  if (code === 'P2003') {
    return 'Die referenzierte Person oder der referenzierte Datensatz existiert nicht mehr (wurde vermutlich zwischenzeitlich endgültig gelöscht).';
  }

  if (err !== undefined) {
    // eslint-disable-next-line no-console
    console.error('[sync] Fehler beim Anwenden eines Sync-Events:', err);
  }
  return GENERIC_SYNC_ERROR_MESSAGE;
}
