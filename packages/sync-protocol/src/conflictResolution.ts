// packages/sync-protocol/src/conflictResolution.ts
//
// Konfliktregeln aus dem Backend-Entwicklungsplan (Abschnitt 7). Bewusst
// als reine, seiteneffektfreie Funktionen implementiert — der Server
// (Phase 3: /api/sync/push) ruft diese auf, statt die Strategie erneut
// zu implementieren; das Frontend könnte dieselbe Logik künftig für eine
// optimistischere lokale Vorschau wiederverwenden.
import type { SyncStore } from '@lane1/shared-types';

export type ConflictStrategy = 'last-write-wins' | 'never-overwrite' | 'last-write-wins-document';

// Welche Strategie gilt für welchen Store — siehe Tabelle in Abschnitt 7
// des Backend-Entwicklungsplans.
const STRATEGY_BY_STORE: Record<SyncStore, ConflictStrategy> = {
  users: 'last-write-wins',
  athletes: 'last-write-wins',
  groups: 'last-write-wins',
  competitions: 'last-write-wins',
  entries: 'last-write-wins',
  exercises: 'last-write-wins',
  results: 'never-overwrite',
  templates: 'last-write-wins-document',
  plans: 'last-write-wins-document',
  sessions: 'last-write-wins',
  actionItems: 'last-write-wins',
};

export function strategyForStore(store: SyncStore): ConflictStrategy {
  return STRATEGY_BY_STORE[store];
}

export interface IncomingEvent {
  clientUpdatedAt: string; // ISO-Zeitstempel
}

export interface ServerRecord {
  updatedAt: string; // ISO-Zeitstempel
}

export type ConflictDecision =
  | { outcome: 'apply' } // Event kann direkt angewendet werden (kein Konflikt)
  | { outcome: 'conflict-server-wins' } // Server-Stand ist neuer, Event wird verworfen
  | { outcome: 'insert-as-new' }; // z. B. "results": bei Konflikt neuen Datensatz anlegen statt zu überschreiben

// Zentrale Entscheidungsfunktion: Gibt es überhaupt einen Konflikt (Server
// hat einen neueren Stand als der Client kannte), und falls ja, wie soll
// er gemäß Store-Strategie behandelt werden?
export function resolveConflict(
  store: SyncStore,
  incoming: IncomingEvent,
  existing: ServerRecord | null,
): ConflictDecision {
  if (!existing) return { outcome: 'apply' }; // Neuanlage, kein bestehender Datensatz

  const serverIsNewer = new Date(existing.updatedAt).getTime() > new Date(incoming.clientUpdatedAt).getTime();
  if (!serverIsNewer) return { outcome: 'apply' }; // Client-Stand ist aktuell oder gleichauf

  const strategy = strategyForStore(store);
  switch (strategy) {
    case 'never-overwrite':
      // Eine Zeitmessung darf nie stillschweigend verschwinden — statt zu
      // überschreiben, wird ein zusätzlicher Datensatz angelegt.
      return { outcome: 'insert-as-new' };
    case 'last-write-wins':
    case 'last-write-wins-document':
      // Server ist neuer -> das eingehende (ältere) Event verwerfen.
      return { outcome: 'conflict-server-wins' };
    default: {
      const _exhaustive: never = strategy;
      return _exhaustive;
    }
  }
}
