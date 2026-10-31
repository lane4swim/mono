// Code-Review, Befund L2: aus sync.service.ts herausgelöst (eine von fünf
// Zuständigkeiten der ehemaligen 737-Zeilen-Datei).
//
// Das Vereins-Scoping in sync.permissions.ts deckt nur die clubId des
// Top-Level-Datensatzes selbst ab. Mehrere Stores referenzieren aber
// ZUSÄTZLICH andere fachliche Entitäten über eine ID (athleteId, groupId,
// competitionId, planId, assignedTrainerId, trainerIds) — die Zod-Schemas in
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
import type { EntityStoreName } from '@lane1/shared-types';
import type { SyncGateway } from './sync.gateway.js';
import { forEachPlainSet } from '../shared/setEntries.js';

// Code-Review, Befund L2 ("Nebenbei"): trug vormals KEINEN durchgängigen
// Diskriminator — die `nested`-Variante wurde über `'kind' in ref &&
// ref.kind === 'nested'` erkannt, die beiden übrigen Varianten danach über
// `'store' in ref`. Das funktionierte nur, weil die `nested`-Variante
// ZUSÄTZLICH ebenfalls ein `store`-Feld trägt und die Unterscheidung damit
// allein an der Prüfreihenfolge hing — ein durchgängiger `kind` auf allen
// drei Varianten macht die Union selbsterklärend und lässt den Compiler
// (statt der Lesenden) über die Vollständigkeit der Fallunterscheidung in
// assertForeignKeysWithinClub() unten wachen.
export type ForeignKeyRef =
  | { kind: 'entity'; field: string; store: EntityStoreName } // referenziert einen der zehn fachlichen Sync-Stores
  | { kind: 'user'; field: string } // referenziert users.id (kein Sync-Store, siehe findClubIdForUser())
  | { kind: 'userList'; field: string } // wie 'user', aber ein Array von users.id (z. B. Group.trainerIds)
  | { kind: 'nested'; store: EntityStoreName; extract: (payload: Record<string, unknown>) => string[] }; // mehrere Referenzen verschachtelt im Payload, siehe collectSetExerciseIds() unten

// Anders als athleteId/groupId/competitionId/assignedTrainerId ist
// exerciseId NICHT top-level, sondern steckt in jedem einzelnen Satz einer
// SetEntry[]-Liste ("templates.sets", "section_templates.entries",
// "plans.days[].sets"; Struktur siehe modules/shared/setEntries.ts) — die
// generische { field, store }-Form von ForeignKeyRef erreicht sie nicht.
// Diese Funktion sammelt alle gesetzten exerciseId-Werte ein, damit
// assertForeignKeysWithinClub() jede davon genauso gegen den eigenen Verein
// prüfen kann wie jede andere Fremdschlüssel-Referenz.
function collectSetExerciseIds(sets: unknown): string[] {
  const ids: string[] = [];
  forEachPlainSet(sets, (set) => {
    if (typeof set.exerciseId === 'string') ids.push(set.exerciseId);
  });
  return ids;
}

const FOREIGN_KEY_REFS: Partial<Record<EntityStoreName, ForeignKeyRef[]>> = {
  athletes: [{ kind: 'entity', field: 'groupId', store: 'groups' }],
  // Heute hängt keine Berechtigung an trainerIds, und die Anzeige löst die
  // IDs nur gegen die eigene Trainer:innen-Liste auf. Geprüft wird trotzdem:
  // ein späteres Feature, das die IDs serverseitig auflöst, soll keine
  // vereinsfremden User-IDs erben.
  groups: [{ kind: 'userList', field: 'trainerIds' }],
  results: [
    { kind: 'entity', field: 'athleteId', store: 'athletes' },
    { kind: 'entity', field: 'competitionId', store: 'competitions' },
  ],
  entries: [
    { kind: 'entity', field: 'athleteId', store: 'athletes' },
    { kind: 'entity', field: 'competitionId', store: 'competitions' },
  ],
  actionItems: [
    { kind: 'entity', field: 'athleteId', store: 'athletes' },
    { kind: 'user', field: 'assignedTrainerId' },
  ],
  templates: [
    { kind: 'nested', store: 'exercises', extract: (payload) => collectSetExerciseIds(payload.sets) },
  ],
  sectionTemplates: [
    { kind: 'nested', store: 'exercises', extract: (payload) => collectSetExerciseIds(payload.entries) },
  ],
  plans: [
    { kind: 'entity', field: 'groupId', store: 'groups' },
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
    { kind: 'entity', field: 'groupId', store: 'groups' },
    { kind: 'entity', field: 'planId', store: 'plans' },
    { kind: 'userList', field: 'coachIds' },
  ],
  announcements: [
    { kind: 'entity', field: 'groupId', store: 'groups' },
  ],
  calendarEntries: [
    { kind: 'entity', field: 'groupId', store: 'groups' },
  ],
};

// Bewusst dieselbe Formulierung wie describeSyncError() (sync.errors.ts)
// für Prismas "P2003" — macht "Referenz existiert gar nicht" und
// "Referenz gehört einem fremden Verein" für den Aufrufer ununterscheidbar
// und schließt so das Existenz-Orakel, statt es nur zu verschieben.
export const FOREIGN_ENTITY_ERROR =
  'Die referenzierte Person oder der referenzierte Datensatz existiert nicht mehr (wurde vermutlich zwischenzeitlich endgültig gelöscht).';
// Stabiler, sprachunabhängiger Stellvertreter für FOREIGN_ENTITY_ERROR
// (siehe apps/web/js/i18n/{de-DE,en-US}.js: common.syncErrors) — dieselbe
// Konstante wird auch von sync.errors.ts für Prismas P2003 verwendet, da
// beide Fälle bewusst dieselbe Nutzermeldung tragen (siehe dortiger
// Kommentar).
export const FOREIGN_ENTITY_ERROR_CODE = 'foreign_entity_missing';

// Prüft alle für `store` relevanten Fremdschlüsselfelder eines bereits
// Zod-validierten Payloads: jede gesetzte (nicht-null/undefined) Referenz
// muss zu genau `clubId` gehören.
//
// Ineffizienz-Korrektur: lief vormals als reine SERIELLE Schleife über
// jede einzelne Referenz mit je einem eigenen, ungebündelten
// `await gateway.findById(...)` — und ohne jede Entdopplung. Für die
// verschachtelten `exerciseId`-Verweise (siehe collectSetExerciseIds()
// oben) war das der teure Fall: ein Trainingsplan mit 40 Sätzen, die
// dieselben 5 Übungen wiederholt referenzieren, erzeugte 40
// nacheinander(!) laufende Datenbankabfragen, jede davon mit der
// vollständigen Übungszeile (inkl. `comments`-JSON) im Ergebnis, obwohl
// nur 5 verschiedene ids überhaupt zu prüfen waren. Beim Push eines
// ganzen Batches multipliziert sich das mit der Zahl der Events.
//
// Jetzt zweistufig: erst werden ALLE zu prüfenden Referenzen des Payloads
// eingesammelt und je Zielstore zu einer dopplungsfreien Menge
// zusammengefasst, dann läuft GENAU EINE Existenzabfrage je beteiligtem
// Store (findExistingIdsInClub(), club-gescoped, nur `id` im Ergebnis) —
// alle Stores parallel, zusammen mit den User-Referenzen.
//
// Am Sicherheitsverhalten ändert das nichts: geprüft wird weiterhin JEDE
// gesetzte Referenz (die Entdopplung entfernt nur Wiederholungen
// derselben id, keine zu prüfende id), das Ergebnis ist weiterhin
// fail-closed (fehlt auch nur eine id in der Trefferliste, wird das
// gesamte Event abgewiesen), und die Meldung bleibt für "existiert
// nirgends" und "gehört einem fremden Verein" dieselbe — das
// Existenz-Orakel bleibt geschlossen. Einziger sichtbarer Unterschied:
// es wird nicht mehr bei der ERSTEN fehlenden Referenz abgebrochen,
// sondern der ganze (parallele, gebündelte) Satz Abfragen läuft durch.
// Das kostet im Fehlerfall nichts Nennenswertes — es sind genau die
// Abfragen, die der Erfolgsfall ohnehin alle braucht — und macht die
// Laufzeit unabhängig davon, an welcher Stelle eine ungültige Referenz
// steht (ein zeitbasierter Seitenkanal weniger).
export async function assertForeignKeysWithinClub(
  gateway: SyncGateway,
  store: EntityStoreName,
  payload: Record<string, unknown>,
  clubId: string,
): Promise<string | null> {
  const refs = FOREIGN_KEY_REFS[store];
  if (!refs) return null;

  // Zielstore -> dopplungsfreie Menge der zu prüfenden ids.
  const entityIdsByStore = new Map<EntityStoreName, Set<string>>();
  const userIds = new Set<string>();

  const addEntityId = (targetStore: EntityStoreName, id: string) => {
    let ids = entityIdsByStore.get(targetStore);
    if (!ids) { ids = new Set(); entityIdsByStore.set(targetStore, ids); }
    ids.add(id);
  };

  for (const ref of refs) {
    if (ref.kind === 'nested') {
      for (const value of ref.extract(payload)) addEntityId(ref.store, value);
      continue;
    }
    if (ref.kind === 'userList') {
      const values = payload[ref.field];
      if (Array.isArray(values)) for (const value of values) userIds.add(value as string);
      continue;
    }

    const value = payload[ref.field];
    if (value === null || value === undefined) continue; // optionale Referenz, nicht gesetzt

    if (ref.kind === 'entity') addEntityId(ref.store, value as string);
    else userIds.add(value as string);
  }

  if (entityIdsByStore.size === 0 && userIds.size === 0) return null;

  const [storeResults, userResults] = await Promise.all([
    Promise.all(
      Array.from(entityIdsByStore.entries()).map(async ([targetStore, ids]) => {
        const found = await gateway.findExistingIdsInClub(targetStore, Array.from(ids), clubId);
        // Vollständigkeit statt "irgendwas gefunden": jede angefragte id
        // muss in der Trefferliste stehen. `found` kann nie ids enthalten,
        // die nicht angefragt wurden — die Größenprüfung allein wäre
        // zwar bereits ausreichend, der explizite Abgleich macht die
        // Absicht aber unabhängig von dieser Zusicherung lesbar.
        return ids.size === found.size && Array.from(ids).every((id) => found.has(id));
      }),
    ),
    Promise.all(
      Array.from(userIds).map(async (userId) => (await gateway.findClubIdForUser(userId)) === clubId),
    ),
  ]);

  const allOwnedByClub = storeResults.every(Boolean) && userResults.every(Boolean);
  return allOwnedByClub ? null : FOREIGN_ENTITY_ERROR;
}
