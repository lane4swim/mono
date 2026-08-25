// apps/api/src/modules/sync/sync.foreignKeys.ts
//
// Code-Review, Befund L2: aus sync.service.ts herausgelöst (eine von fünf
// Zuständigkeiten der ehemaligen 737-Zeilen-Datei).
//
// Das Vereins-Scoping in sync.permissions.ts deckt nur die clubId des
// Top-Level-Datensatzes selbst ab. Mehrere Stores referenzieren aber
// ZUSÄTZLICH andere fachliche Entitäten über eine ID (athleteId, groupId,
// competitionId, planId, assignedTrainerId) — die Zod-Schemas in
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
  athletes: [{ kind: 'entity', field: 'groupId', store: 'groups' }],
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
  ],
};

// Bewusst dieselbe Formulierung wie describeSyncError() (sync.errors.ts)
// für Prismas "P2003" — macht "Referenz existiert gar nicht" und
// "Referenz gehört einem fremden Verein" für den Aufrufer ununterscheidbar
// und schließt so das Existenz-Orakel, statt es nur zu verschieben.
export const FOREIGN_ENTITY_ERROR =
  'Die referenzierte Person oder der referenzierte Datensatz existiert nicht mehr (wurde vermutlich zwischenzeitlich endgültig gelöscht).';

// Prüft alle für `store` relevanten Fremdschlüsselfelder eines bereits
// Zod-validierten Payloads: jede gesetzte (nicht-null/undefined) Referenz
// muss zu genau `clubId` gehören. `findById()` ist bereits club-gescoped
// (liefert null sowohl bei "nicht gefunden" als auch bei "fremder
// Verein", siehe sync.gateway.ts) — das reicht hier direkt aus, ohne
// zwischen beiden Fällen unterscheiden zu müssen.
export async function assertForeignKeysWithinClub(
  gateway: SyncGateway,
  store: EntityStoreName,
  payload: Record<string, unknown>,
  clubId: string,
): Promise<string | null> {
  const refs = FOREIGN_KEY_REFS[store];
  if (!refs) return null;

  for (const ref of refs) {
    if (ref.kind === 'nested') {
      for (const value of ref.extract(payload)) {
        const ownedByClub = (await gateway.findById(ref.store, value, clubId)) !== null;
        if (!ownedByClub) return FOREIGN_ENTITY_ERROR;
      }
      continue;
    }

    const value = payload[ref.field];
    if (value === null || value === undefined) continue; // optionale Referenz, nicht gesetzt

    const ownedByClub =
      ref.kind === 'entity'
        ? (await gateway.findById(ref.store, value as string, clubId)) !== null
        : (await gateway.findClubIdForUser(value as string)) === clubId;

    if (!ownedByClub) return FOREIGN_ENTITY_ERROR;
  }
  return null;
}
