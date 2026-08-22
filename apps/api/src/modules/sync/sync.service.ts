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
// ursprünglich NUR clubId-Scoping — jede authentifizierte Rolle (trainer,
// admin, athlete) bekam denselben, vollständigen Vereinsdatensatz. Für
// "results" und "plans" ist geteiltes Lesen UND Schreiben tatsächlich so
// gewollt (apps/web zeigt Zeiten/Trainingspläne bewusst der gesamten
// Mannschaft, auch der Rolle "athlete" — siehe js/modules/times.js,
// js/modules/plans.js, die für ALLE Rollen identisch die volle Liste
// anzeigen und auch schreiben lassen). Für die übrigen acht Stores ist die
// Rollentrennung im Frontend jedoch klar erkennbar angelegt — jedes
// zugehörige Modul grenzt seine Bearbeitungs-UI per `roles: [...]` im
// Router (apps/web/js/router.js) auf "trainer"/"admin" ein, nur eben bisher
// nur clientseitig, nicht serverseitig durchgesetzt:
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
//   - "athletes"/"groups" (Athleten- & Team-Verwaltung): js/modules/athletes.js
//     hat `roles: ['trainer', 'admin']` — für "athlete" existiert dafür
//     keinerlei Bearbeitungs-UI. js/modules/profile.js ("Mein Profil", für
//     alle Rollen zugänglich) lässt ausdrücklich NUR Name/E-Mail/Sprache
//     des eigenen Kontos ändern — Athleten-Stammdaten (Geburtsdatum,
//     Gruppe, Notizen, …) bleiben laut eigenem Kommentar dort bewusst
//     "coach-managed", auch für das eigene, verknüpfte Athletenprofil.
//   - "exercises" (Übungskatalog): js/modules/catalog.js hat
//     `roles: ['trainer', 'admin']`.
//   - "templates" (Trainingsplan-Vorlagen): js/modules/templates.js hat
//     `roles: ['trainer', 'admin']`.
//   - "competitions"/"entries" (Wettkampf- & Startlisten-Verwaltung):
//     js/modules/competitions.js hat `roles: ['trainer', 'admin']`.
//
// Für all diese acht Stores wird die Rollentrennung jetzt auch serverseitig
// erzwungen — vorher hätte jede Person mit einem gültigen Athlet:innen-
// Konto (z. B. per curl/DevTools, unabhängig vom Frontend) dort lesend UND
// SCHREIBEND eingreifen können, obwohl die App-Navigation ihr dafür
// bewusst keine Werkzeuge gibt (z. B. fremde Athletendatensätze oder
// Gruppen anlegen/ändern/löschen, den Übungskatalog oder Trainingsplan-
// Vorlagen manipulieren, Wettkämpfe/Startlisten anlegen oder verändern).
const ATHLETE_WRITE_FORBIDDEN_STORES: ReadonlySet<EntityStoreName> = new Set([
  'actionItems',
  'sessions',
  'athletes',
  'groups',
  'exercises',
  'templates',
  'competitions',
  'entries',
]);

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
  | { field: string; kind: 'user' }; // referenziert users.id (kein Sync-Store, siehe findClubIdForUser())

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
  plans: [{ field: 'groupId', store: 'groups' }],
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
          // Pull, siehe scopeChangeForAthlete): "athletes" steht seit der
          // Erweiterung von ATHLETE_WRITE_FORBIDDEN_STORES oben für diese
          // Rolle gar nicht mehr bis hierher — ein Push-Versuch wird
          // bereits ganz oben abgewiesen, dieser Zweig ist für "athlete"
          // auf "athletes" also unerreichbar.
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
