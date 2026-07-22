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
  type Role,
} from '@lane1/shared-types';
import { resolveConflict } from '@lane1/sync-protocol';
import type { SyncGateway } from './sync.gateway.js';

export interface SyncRequester {
  clubId: string; // Superadmin (clubId: null) darf nicht synchronisieren — siehe sync.route.ts (requireRole).
  // Für die Rollen-Scopierung unten (Sicherheitsreview, "Fehlende
  // Rollen-Scopierung in der Sync-API") — clubId allein reicht nicht:
  // ein Athlet:innen-Konto darf zwar denselben Verein sehen wie
  // Trainer:innen/Admins, aber nicht dieselbe Datentiefe (siehe Kommentar
  // bei ATHLETE_WRITE_FORBIDDEN_STORES unten).
  role: Role;
  athleteId: string | null;
}

const PULL_PAGE_SIZE = 200;

// ---- Rollen-Scopierung für die Rolle "athlete" ---------------------------
//
// Hintergrund (siehe Sicherheitsreview): die generische Sync-API kannte
// bisher NUR clubId-Scoping — jede authentifizierte Rolle (trainer, admin,
// athlete) bekam denselben, vollständigen Vereinsdatensatz. Für die
// meisten Stores ist das tatsächlich so gewollt (apps/web zeigt z. B.
// Zeiten/Trainingspläne bewusst der gesamten Mannschaft, auch der Rolle
// "athlete" — siehe js/modules/times.js, js/modules/plans.js, die für
// ALLE Rollen identisch die volle Liste anzeigen und auch schreiben
// lassen). Für zwei Stores ist die Rollentrennung im Frontend jedoch
// bereits klar erkennbar angelegt — nur eben bisher nur clientseitig,
// nicht serverseitig durchgesetzt:
//
//   - "actionItems" (Handlungsfelder/Coaching-Notizen): das Frontend hat
//     für die Rolle "athlete" eine eigene, rein lesende Ansicht
//     (renderAthleteList in js/modules/actionItems.js), die nur die
//     eigenen Einträge zeigt; Anlegen/Bearbeiten (openItemModal) existiert
//     dort nicht — nur in der Trainer:innen-/Admin-Ansicht.
//   - "sessions" (Trainingseinheiten inkl. Anwesenheit/RPE/Notiz JE
//     Athlet:in): ebenfalls eine eigene, rein lesende Ansicht
//     (renderAthleteView in js/modules/sessions.js), die zusätzlich nur
//     die EIGENE Zeile aus dem `attendance`-Array zeigt — nie die der
//     anderen. Anlegen/Bearbeiten (openSessionModal) existiert nur in der
//     Trainer:innen-/Admin-Ansicht.
//
// Für genau diese beiden Stores wird die Rollentrennung jetzt auch
// serverseitig erzwungen — vorher hätte jede Person mit einem gültigen
// Athlet:innen-Konto (z. B. per curl/DevTools, unabhängig vom Frontend)
// die Handlungsfelder und Trainings-Notizen/RPE-Werte ALLER anderen
// Athlet:innen des Vereins lesen und dort sogar schreibend eingreifen
// können.
const ATHLETE_WRITE_FORBIDDEN_STORES: ReadonlySet<EntityStoreName> = new Set(['actionItems', 'sessions']);

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

  return change;
}

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

        // Rollen-Scopierung (siehe Kommentar bei ATHLETE_WRITE_FORBIDDEN_STORES
        // oben): eine Rolle "athlete" darf "actionItems"/"sessions" NIE
        // schreibend verändern — unabhängig von action (create/update/delete)
        // und unabhängig davon, ob der Datensatz ihr selbst "gehört". Das
        // Frontend bietet dafür ohnehin keine Schreib-UI; diese Prüfung
        // schließt lediglich die serverseitige Lücke.
        if (requester.role === 'athlete' && ATHLETE_WRITE_FORBIDDEN_STORES.has(store)) {
          results.push({
            eventId: event.id,
            status: 'error',
            message: `Die Rolle "athlete" darf den Store "${store}" nicht verändern.`,
          });
          continue;
        }

        // Idempotenz: bereits verarbeitete Events werden als "applied"
        // gemeldet (nicht als Fehler), damit ein Client, der wegen eines
        // Verbindungsabbruchs dieselbe Antwort nicht sah, beim erneuten
        // Senden ein konsistentes Ergebnis bekommt.
        if (await deps.gateway.isEventProcessed(event.id)) {
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
          validatedPayload = parsedPayload.data as Record<string, unknown>;
        }

        // Vereins-Scoping: ein Event darf nur Daten des eigenen Vereins
        // betreffen — verhindert, dass ein manipulierter Client Daten
        // eines fremden Vereins schreibt/löscht.
        const payloadClubId = (validatedPayload as { clubId?: string } | null)?.clubId;
        if (event.action !== 'delete' && payloadClubId !== requester.clubId) {
          results.push({ eventId: event.id, status: 'error', message: 'clubId des Events stimmt nicht mit dem eigenen Verein überein.' });
          continue;
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
            await deps.gateway.create(store, { ...(validatedPayload as Record<string, unknown>), id: newId });
            await deps.gateway.markEventProcessed(event.id, requester.clubId, store, event.action);
            results.push({ eventId: event.id, status: 'applied', serverVersion: { id: newId } });
            continue;
          } else if (existing) {
            await deps.gateway.update(store, event.entityId, requester.clubId, validatedPayload as Record<string, unknown>);
          } else {
            await deps.gateway.create(store, validatedPayload as Record<string, unknown>);
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

      let changes: SyncChange[] = page.map((row) => ({
        store: row.store,
        entityId: row.entityId,
        action: row.action,
        payload: row.payload,
        updatedAt: row.updatedAt.toISOString(),
      }));

      // Rollen-Scopierung beim Lesen (siehe Kommentar bei
      // ATHLETE_WRITE_FORBIDDEN_STORES oben): "actionItems" werden auf
      // eigene Einträge gefiltert, "sessions" auf die eigene Zeile im
      // attendance-Array reduziert bzw. komplett ausgeblendet, wenn die
      // anfragende Person gar nicht Teil der Einheit war. WICHTIG: die
      // Filterung erfolgt NACH der Pagination (auf `page`, nicht auf
      // `rows`) — `hasMore`/`nextCursor` bleiben dadurch unverändert
      // korrekt, auch wenn dem Client dadurch weniger als PULL_PAGE_SIZE
      // sichtbare Changes in dieser Seite ankommen.
      if (requester.role === 'athlete') {
        changes = changes
          .map((change) => scopeChangeForAthlete(change, requester.athleteId))
          .filter((change): change is SyncChange => change !== null);
      }

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
