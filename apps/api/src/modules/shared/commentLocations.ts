// Zentrale Stelle für die Frage "wo trägt ein Datensatz eingebettete
// Kommentar-Arrays (CommentSchema[])?". Zwei Prüfungen hängen daran und
// müssen dieselben Stores und Felder abdecken:
//
//   - die Autor:innen-Prüfung beim Sync-Push (sync.commentAuthorship.ts),
//   - die Anonymisierung beim Art.-17-Hard-Purge (jobs/commentAnonymization.ts,
//     jobs/erasure.repository.ts und dessen In-Memory-Double).
//
// Beide lesen ausschließlich COMMENT_LOCATIONS. Bekommt ein Store
// Kommentare (oder ein weiteres Feld), genügt ein Eintrag hier, damit er
// geprüft UND beim Purge anonymisiert wird.
import type { EntityStoreName } from '@lane1/shared-types';
import { isRecord, mapPlainSets, forEachPlainSet, type MapResult } from './setEntries.js';

export type CommentLocation =
  // `record[field]` ist selbst das Kommentar-Array.
  | { field: string; kind: 'comments' }
  // `record[field]` ist eine SetEntry[]-Liste; jeder einzelne Satz trägt
  // ein eigenes `comments` (siehe setEntries.ts).
  | { field: string; kind: 'setEntries' }
  // `record[field]` ist eine Liste von Plan-Tagen, jeder mit einer
  // SetEntry[]-Liste in `sets`.
  | { field: string; kind: 'planDays' };

export const COMMENT_LOCATIONS = {
  exercises: [{ field: 'comments', kind: 'comments' }],
  plans: [
    { field: 'comments', kind: 'comments' },
    { field: 'days', kind: 'planDays' },
  ],
  templates: [{ field: 'sets', kind: 'setEntries' }],
  sectionTemplates: [{ field: 'entries', kind: 'setEntries' }],
  // Seit dem DSV7/Lenex-Ergebnisimport (ResultSchema.comments).
  results: [{ field: 'comments', kind: 'comments' }],
} as const satisfies Partial<Record<EntityStoreName, readonly CommentLocation[]>>;

export type CommentBearingStore = keyof typeof COMMENT_LOCATIONS;

export const COMMENT_BEARING_STORES: ReadonlySet<EntityStoreName> = new Set(Object.keys(COMMENT_LOCATIONS) as CommentBearingStore[]);

export function isCommentBearingStore(store: EntityStoreName): store is CommentBearingStore {
  return COMMENT_BEARING_STORES.has(store);
}

function asCommentArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

// Alle Kommentar-Arrays eines Datensatzes, je Fundstelle eines (Plan-weite
// Kommentare, je Satz verschachtelte, Übungs-/Ergebnis-Kommentare). Ein
// fehlendes oder ungültiges Array zählt als leer.
export function collectCommentArrays(store: CommentBearingStore, record: Record<string, unknown> | null): unknown[][] {
  if (!record) return [];
  const groups: unknown[][] = [];
  const collectSets = (entries: unknown) => forEachPlainSet(entries, (set) => groups.push(asCommentArray(set.comments)));
  for (const location of COMMENT_LOCATIONS[store] as readonly CommentLocation[]) {
    const value = record[location.field];
    if (location.kind === 'comments') groups.push(asCommentArray(value));
    else if (location.kind === 'setEntries') collectSets(value);
    else for (const day of asCommentArray(value)) if (isRecord(day)) collectSets(day.sets);
  }
  return groups;
}

// Bildet jedes Kommentar-Array eines Datensatzes über `mapComments` ab und
// liefert den neuen Wert JEDES Kommentar-Felds des Stores (auch der
// unveränderten), damit der Aufrufer sie gemeinsam zurückschreiben kann,
// sobald `changed` gesetzt ist.
export function mapCommentArrays(
  store: CommentBearingStore,
  record: Record<string, unknown>,
  mapComments: (comments: unknown) => MapResult,
): { changed: boolean; fields: Record<string, unknown> } {
  let changed = false;
  const fields: Record<string, unknown> = {};
  const mapSet = (set: Record<string, unknown>) => {
    const result = mapComments(set.comments);
    return result.changed ? { ...set, comments: result.value } : null;
  };
  for (const location of COMMENT_LOCATIONS[store] as readonly CommentLocation[]) {
    const value = record[location.field];
    let result: MapResult;
    if (location.kind === 'comments') {
      result = mapComments(value);
    } else if (location.kind === 'setEntries') {
      result = mapPlainSets(value, mapSet);
    } else if (!Array.isArray(value)) {
      result = { changed: false, value };
    } else {
      let daysChanged = false;
      const days = value.map((day) => {
        if (!isRecord(day)) return day;
        const sets = mapPlainSets(day.sets, mapSet);
        if (!sets.changed) return day;
        daysChanged = true;
        return { ...day, sets: sets.value };
      });
      result = { changed: daysChanged, value: days };
    }
    if (result.changed) changed = true;
    fields[location.field] = result.value;
  }
  return { changed, fields };
}
