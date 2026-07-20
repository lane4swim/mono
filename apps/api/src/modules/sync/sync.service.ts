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
  type SyncEvent,
  type SyncEventResult,
  type SyncChange,
  type EntityStoreName,
} from '@lane1/shared-types';
import { resolveConflict } from '@lane1/sync-protocol';
import type { SyncGateway } from './sync.gateway.js';

export interface SyncRequester {
  clubId: string; // Superadmin (clubId: null) darf nicht synchronisieren — siehe sync.route.ts (requireRole).
}

const PULL_PAGE_SIZE = 200;

export function createSyncService(deps: { gateway: SyncGateway }) {
  return {
    async push(events: SyncEvent[], requester: SyncRequester): Promise<SyncEventResult[]> {
      const results: SyncEventResult[] = [];

      for (const rawEvent of events) {
        const parsedEvent = SyncEventSchema.safeParse(rawEvent);
        if (!parsedEvent.success) {
          results.push({ eventId: (rawEvent as { id?: string })?.id ?? 'unknown', status: 'error', message: 'Event-Struktur ungültig.' });
          continue;
        }
        const event = parsedEvent.data;
        const store = event.store as EntityStoreName;

        // Idempotenz: bereits verarbeitete Events werden als "applied"
        // gemeldet (nicht als Fehler), damit ein Client, der wegen eines
        // Verbindungsabbruchs dieselbe Antwort nicht sah, beim erneuten
        // Senden ein konsistentes Ergebnis bekommt.
        if (await deps.gateway.isEventProcessed(event.id)) {
          results.push({ eventId: event.id, status: 'applied' });
          continue;
        }

        // Payload-Validierung (nur bei create/update — delete hat kein Payload).
        if (event.action !== 'delete') {
          const entitySchema = ENTITY_SCHEMAS[store];
          const parsedPayload = entitySchema.safeParse(event.payload);
          if (!parsedPayload.success) {
            results.push({ eventId: event.id, status: 'error', message: `Payload entspricht nicht dem Schema für "${store}".` });
            continue;
          }
        }

        // Vereins-Scoping: ein Event darf nur Daten des eigenen Vereins
        // betreffen — verhindert, dass ein manipulierter Client Daten
        // eines fremden Vereins schreibt/löscht.
        const payloadClubId = (event.payload as { clubId?: string } | null)?.clubId;
        if (event.action !== 'delete' && payloadClubId !== requester.clubId) {
          results.push({ eventId: event.id, status: 'error', message: 'clubId des Events stimmt nicht mit dem eigenen Verein überein.' });
          continue;
        }

        const existing = await deps.gateway.findById(store, event.entityId);
        const decision = resolveConflict(
          store,
          { clientUpdatedAt: event.clientUpdatedAt },
          existing ? { updatedAt: existing.updatedAt.toISOString() } : null,
        );

        if (decision.outcome === 'conflict-server-wins') {
          results.push({ eventId: event.id, status: 'conflict', serverVersion: existing as Record<string, unknown> | null });
          continue;
        }

        try {
          if (event.action === 'delete') {
            await deps.gateway.softDelete(store, event.entityId, requester.clubId);
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
            await deps.gateway.create(store, { ...(event.payload as Record<string, unknown>), id: newId });
            await deps.gateway.markEventProcessed(event.id, requester.clubId, store, event.action);
            results.push({ eventId: event.id, status: 'applied', serverVersion: { id: newId } });
            continue;
          } else if (existing) {
            await deps.gateway.update(store, event.entityId, event.payload as Record<string, unknown>);
          } else {
            await deps.gateway.create(store, event.payload as Record<string, unknown>);
          }
          await deps.gateway.markEventProcessed(event.id, requester.clubId, store, event.action);
          results.push({ eventId: event.id, status: 'applied' });
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
      const hasMore = rows.length > PULL_PAGE_SIZE;
      const page = rows.slice(0, PULL_PAGE_SIZE);

      const changes: SyncChange[] = page.map((row) => ({
        store: row.store,
        entityId: row.entityId,
        action: row.action,
        payload: row.payload,
        updatedAt: row.updatedAt.toISOString(),
      }));

      const lastRow = page.at(-1);
      const nextCursor = lastRow ? lastRow.updatedAt.toISOString() : null;
      return { changes, nextCursor: hasMore ? nextCursor : null, hasMore };
    },
  };
}

export type SyncService = ReturnType<typeof createSyncService>;

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
export function describeSyncError(err: unknown): string {
  if (err && typeof err === 'object' && 'code' in err && (err as { code?: string }).code === 'P2003') {
    return 'Die referenzierte Person oder der referenzierte Datensatz existiert nicht mehr (wurde vermutlich zwischenzeitlich endgültig gelöscht).';
  }
  return err instanceof Error ? err.message : 'Unbekannter Fehler.';
}
