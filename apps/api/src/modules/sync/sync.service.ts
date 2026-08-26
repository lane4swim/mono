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
//
// Code-Review, Befund L2: war früher eine 737-Zeilen-Datei mit fünf
// Zuständigkeiten (Rechte-Matrix, Fremdschlüsselprüfung,
// Athlet:innen-Redaktion, Pagination, Fehlerübersetzung — je in eine
// eigene Datei ausgelagert, siehe die fünf sync.*.ts-Importe unten).
// Diese Datei behält nur noch push()/pull() selbst.
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
import { isKnownStore, canRead, canWrite } from './sync.permissions.js';
import { assertForeignKeysWithinClub } from './sync.foreignKeys.js';
import { scopeChangeForAthlete } from './sync.athleteScope.js';
import { PULL_PAGE_SIZE, PULL_TIE_SAFETY_LIMIT, splitAtSafeTimestampBoundary } from './sync.pagination.js';
import { describeSyncError } from './sync.errors.js';

export interface SyncRequester {
  clubId: string; // Superadmin (clubId: null) darf nicht synchronisieren — siehe sync.route.ts (requireRole).
  // Für die Rollen-Scopierung unten — clubId allein reicht nicht: ein
  // Athlet:innen-Konto darf zwar denselben Verein sehen wie
  // Trainer:innen/Admins, aber nicht dieselbe Datentiefe (siehe
  // sync.permissions.ts: STORE_PERMISSIONS-Kommentar).
  role: Role;
  athleteId: string | null;
  // Modul-Pakete des Vereins (packages/shared-types/src/modules.ts:
  // MODULE_PACKAGES) — von sync.route.ts EINMAL pro Request per Club-
  // Lookup geladen, hier nur konsumiert (siehe canRead()/canWrite() in
  // sync.permissions.ts: zusätzlich zur Rollen-Prüfung erforderlich).
  enabledModules: readonly string[];
}

// ---- push(): Guard-Kette --------------------------------------------------
//
// Code-Review, Befund L1: push() war eine 218-Zeilen-Schleife mit acht
// aufeinanderfolgenden Prüfstufen, die alle nach demselben Schema
// abbrachen (results.push({… status: 'error' …}); continue;) — jede für
// sich eine eigenständige, klar benennbare Sicherheitsregel, aber keine
// davon einzeln testbar, und die (sicherheitsrelevante!) Reihenfolge nur
// durch die Zeilenreihenfolge im Code kodiert. Die ersten sieben dieser
// Stufen (die achte — Konfliktentscheidung + Schreibzweig — bleibt unten
// in push() selbst, siehe dortiger Kommentar) sind jetzt PUSH_GUARDS: eine
// Liste reiner, einzeln benannter und einzeln testbarer Funktionen mit
// einheitlicher Signatur `(ctx) => SyncEventResult | null` — `null`
// bedeutet "durchgereicht", jeder andere Rückgabewert beendet die
// Verarbeitung DIESES Events sofort mit genau diesem Ergebnis (ob Erfolg
// wie beim Idempotenz-Fast-Path oder Fehler spielt für den Abbruch selbst
// keine Rolle). Jede Stufe schreibt ihr Zwischenergebnis (das geparste
// Event, den Store, den validierten Payload) in `ctx` — die jeweils
// nächste Stufe darf sich darauf verlassen, dass die davor gelaufenen
// Stufen diese Felder bereits gesetzt haben, denn PUSH_GUARDS läuft
// IMMER in genau dieser Reihenfolge (siehe Array unten). Diese Reihenfolge
// ist selbst sicherheitsrelevant — siehe Kommentar bei
// requireForeignKeysWithinClub — und jetzt als Array-Position statt als
// verstreute Zeilenreihenfolge sichtbar.
interface PushCtx {
  readonly requester: SyncRequester;
  readonly gateway: SyncGateway;
  readonly raw: unknown;
  event?: SyncEvent;
  store?: EntityStoreName;
  validatedPayload?: Record<string, unknown> | null;
}

type PushGuard = (ctx: PushCtx) => Promise<SyncEventResult | null> | SyncEventResult | null;

// Stufe 1: `events: unknown[]` statt `SyncEvent[]` in push() unten — die
// Route (sync.route.ts) prüft nur die reine Array-Länge (siehe
// SyncPushRequestSchema) — die STRUKTURELLE Prüfung jedes einzelnen
// Events übernimmt ausschließlich dieser Guard. Ein einzelnes fehlerhaftes
// Event scheitert dadurch nur selbst (als "error"-Ergebnis), statt den
// gesamten Batch abzulehnen — bei einer Prüfung bereits auf Route-Ebene
// gegen SyncEvent[] wäre dieser Codepfad für ein strukturell ungültiges
// Event unerreichbar, da die Route den Request dann schon vorher mit 400
// abgelehnt hätte.
function parseEvent(ctx: PushCtx): SyncEventResult | null {
  const parsed = SyncEventSchema.safeParse(ctx.raw);
  if (!parsed.success) {
    return { eventId: (ctx.raw as { id?: string })?.id ?? 'unknown', status: 'error', message: 'Event-Struktur ungültig.' };
  }
  ctx.event = parsed.data;
  return null;
}

// Stufe 2: "store" ist laut SyncEventSchema nur als der breitere Wire-Typ
// `SyncStore` geprüft (der zusätzlich "users" kennt, siehe
// isKnownStore()-Kommentar in sync.permissions.ts — Nutzerverwaltung läuft
// über eigene REST-Endpunkte, nicht über diese generische Sync-API). Ohne
// diesen Guard würde ein Event mit einem solchen, hier unbekannten Store
// weiter unten bei `ENTITY_SCHEMAS[store]` auf ein fehlendes Schema
// treffen und die gesamte Anfrage mit einer rohen TypeError abbrechen,
// statt als reguläres "error"-Ergebnis für genau dieses Event gemeldet zu
// werden.
function requireKnownStore(ctx: PushCtx): SyncEventResult | null {
  const event = ctx.event!;
  if (!isKnownStore(event.store)) {
    return { eventId: event.id, status: 'error', message: `Unbekannter Store "${event.store}".` };
  }
  ctx.store = event.store;
  return null;
}

// Stufe 3: Rollen-Scopierung (siehe sync.permissions.ts: STORE_PERMISSIONS):
// unabhängig von action (create/update/delete) und unabhängig davon, ob
// der Datensatz der anfragenden Person selbst "gehört" — wer für einen
// Store laut Tabelle nicht schreiben darf, kommt hier gar nicht erst
// weiter. Für die betroffenen Stores bietet das Frontend ohnehin keine
// Schreib-UI für diese Rolle; dieser Guard schließt lediglich die
// serverseitige Lücke.
function requireWritePermission(ctx: PushCtx): SyncEventResult | null {
  const event = ctx.event!;
  const store = ctx.store!;
  if (!canWrite(store, ctx.requester.role, ctx.requester.enabledModules)) {
    return { eventId: event.id, status: 'error', message: `Die Rolle "${ctx.requester.role}" darf den Store "${store}" nicht verändern.` };
  }
  return null;
}

// Stufe 4: Idempotenz-FAST-PATH — bereits verarbeitete Events werden als
// "applied" gemeldet (nicht als Fehler), damit ein Client, der wegen eines
// Verbindungsabbruchs dieselbe Antwort nicht sah, beim erneuten Senden ein
// konsistentes Ergebnis bekommt. clubId-gescoped (siehe
// SyncGateway.isEventProcessed()-Kommentar in sync.gateway.ts) — ein
// fremdes, erratenes Event-ID bekommt dadurch die korrekte, ungescopte
// Antwort statt eines wirkungslosen "applied".
//
// Bewusst nur ein FAST-PATH, keine alleinige Korrektheitsgarantie: dieser
// Check ist ein reines Check-then-Act ohne Sperre — zwei praktisch
// gleichzeitige Pushes desselben Events könnten diese Prüfung beide
// passieren, bevor eine von beiden den Ledger-Eintrag geschrieben hat. Er
// spart in diesem (Normal-)Fall lediglich die nachfolgenden Guards sowie
// den Transaktionsversuch für ein Event, dessen Ergebnis ohnehin
// feststeht. Die tatsächliche, nebenläufigkeitssichere Garantie liefert
// erst applyAndMarkProcessed() (siehe push() unten), das die
// Datenänderung UND den Ledger-Eintrag atomar in einer Transaktion
// zusammenfasst.
async function shortCircuitIfProcessed(ctx: PushCtx): Promise<SyncEventResult | null> {
  const event = ctx.event!;
  if (await ctx.gateway.isEventProcessed(event.id, ctx.requester.clubId)) {
    return { eventId: event.id, status: 'applied' };
  }
  return null;
}

// Stufe 5: Payload-Validierung (nur bei create/update — delete hat kein
// Payload). WICHTIG: `ctx.validatedPayload` (das Ergebnis von Zods
// .strict()-Parsing) wird ab hier für ALLES verwendet — die clubId-Prüfung,
// die Fremdschlüsselprüfung, die Konfliktentscheidung und vor allem die
// eigentlichen create()/update()-Aufrufe in push() unten. Der rohe
// `event.payload` wird NICHT mehr an das Gateway durchgereicht: Da die
// Entity-Schemas jetzt `.strict()` sind, würde Zod zusätzliche, im Schema
// nicht vorgesehene Felder (z. B. "deletedAt", das kein Zod-Feld ist, aber
// eine echte Prisma-Spalte) zwar ablehnen — das nützt aber nichts, wenn
// hinterher trotzdem der ungeprüfte Rohwert an Prisma weitergereicht wird.
// Erst die Verwendung von ctx.validatedPayload schließt das
// Mass-Assignment-Risiko tatsächlich.
function validatePayload(ctx: PushCtx): SyncEventResult | null {
  const event = ctx.event!;
  const store = ctx.store!;
  if (event.action === 'delete') {
    ctx.validatedPayload = null;
    return null;
  }
  const entitySchema = ENTITY_SCHEMAS[store];
  const parsedPayload = entitySchema.safeParse(event.payload);
  if (!parsedPayload.success) {
    return { eventId: event.id, status: 'error', message: `Payload entspricht nicht dem Schema für "${store}".` };
  }
  // "createdAt"/"updatedAt" sind im Entity-Schema Pflichtfelder (siehe
  // packages/shared-types/src/entities.ts) — der CLIENT setzt sie beim
  // lokalen Anlegen/Ändern (apps/web/js/db.js: put()) und schickt sie mit.
  // Würden sie unverändert an create()/update() weitergereicht, bestimmte
  // die lokale Client-Uhr (nicht der Server) den Zeitpunkt, der
  // gleichzeitig als PULL-Sync-Cursor dient (siehe pull() unten,
  // listChangedSince()) — eine vor- oder zurückgestellte Client-Uhr ließe
  // einen Datensatz entweder permanent als "neuester Stand" erscheinen
  // oder ihn für andere Geräte, deren Cursor bereits dahinter liegt,
  // dauerhaft unsichtbar bleiben (stiller Datenverlust). Beide Felder
  // werden daher entfernt, BEVOR der Payload für irgendetwas (clubId-
  // Prüfung, Fremdschlüssel-Prüfung, create()/update()) verwendet wird —
  // Prismas `@default(now())` bzw. `@updatedAt` (siehe schema.prisma)
  // setzen sie serverseitig sowohl bei create() als auch bei update()
  // automatisch.
  const { createdAt: _createdAt, updatedAt: _updatedAt, ...rest } = parsedPayload.data as Record<string, unknown>;
  ctx.validatedPayload = rest;
  return null;
}

// Stufe 6: Vereins-Scoping — ein Event darf nur Daten des eigenen Vereins
// betreffen — verhindert, dass ein manipulierter Client Daten eines
// fremden Vereins schreibt/löscht.
function requireOwnClub(ctx: PushCtx): SyncEventResult | null {
  const event = ctx.event!;
  if (event.action === 'delete') return null;
  const payloadClubId = (ctx.validatedPayload as { clubId?: string } | null)?.clubId;
  if (payloadClubId !== ctx.requester.clubId) {
    return { eventId: event.id, status: 'error', message: 'clubId des Events stimmt nicht mit dem eigenen Verein überein.' };
  }
  return null;
}

// Stufe 7: Fremdschlüssel-Eigentümerprüfung (siehe sync.foreignKeys.ts).
// WICHTIG — Reihenfolge: erst NACH requireOwnClub (Stufe 6, prüft die
// clubId des Top-Level-Datensatzes), aber VOR jedem Lese-/Schreibzugriff
// in push() unten, der referenzierte IDs verwenden würde — ein Event mit
// einer clubId-fremden Referenz (z. B. athleteId eines fremden Vereins)
// wird komplett zurückgewiesen, statt teilweise angewendet zu werden.
// Diese Reihenfolge ist jetzt durch die Position in PUSH_GUARDS unten
// kodiert, nicht mehr nur durch Zeilenreihenfolge in einer Schleife.
async function requireForeignKeysWithinClub(ctx: PushCtx): Promise<SyncEventResult | null> {
  const event = ctx.event!;
  const store = ctx.store!;
  if (event.action === 'delete') return null;
  const fkError = await assertForeignKeysWithinClub(ctx.gateway, store, ctx.validatedPayload as Record<string, unknown>, ctx.requester.clubId);
  if (fkError) {
    return { eventId: event.id, status: 'error', message: fkError };
  }
  return null;
}

const PUSH_GUARDS: PushGuard[] = [
  parseEvent,
  requireKnownStore,
  requireWritePermission,
  shortCircuitIfProcessed,
  validatePayload,
  requireOwnClub,
  requireForeignKeysWithinClub,
];

export function createSyncService(deps: { gateway: SyncGateway }) {
  return {
    async push(events: unknown[], requester: SyncRequester): Promise<SyncEventResult[]> {
      const results: SyncEventResult[] = [];

      for (const raw of events) {
        const ctx: PushCtx = { requester, gateway: deps.gateway, raw };

        let guardResult: SyncEventResult | null = null;
        for (const guard of PUSH_GUARDS) {
          guardResult = await guard(ctx);
          if (guardResult) break;
        }
        if (guardResult) {
          results.push(guardResult);
          continue;
        }

        const event = ctx.event!;
        const store = ctx.store!;
        const validatedPayload = ctx.validatedPayload ?? null;

        // WICHTIG: clubId wird IMMER mitgegeben. Ein Datensatz eines
        // fremden Vereins gilt dadurch für den gesamten weiteren Ablauf
        // (Konfliktentscheidung, serverVersion im Response, update()) als
        // nicht existent — verhindert sowohl einen Infoleak über das
        // "conflict"-Ergebnis als auch, dass unten fälschlich der
        // update()-Zweig statt insert-as-new/create() gewählt wird.
        const existing = await deps.gateway.findById(store, event.entityId, requester.clubId);

        // Zeilenebene, ergänzend zur Store-Ebene oben (Sicherheitsreview
        // 2026-08, Befund N1): "results" steht laut STORE_PERMISSIONS als
        // "shared" für Rolle "athlete" store-weit auf Schreiben — wird hier
        // NICHT eingeschränkt (das würde die kollaborative Nutzung durch
        // times.js für ALLE Rollen brechen), sondern zusätzlich auf die
        // EIGENEN Ergebnisse verengt: ohne diese Prüfung könnte jedes
        // Athlet:innen-Konto per direktem POST /api/sync/push die
        // Ergebnisse ANDERER Vereinsmitglieder anlegen, überschreiben oder
        // löschen. "plans" bleibt hier bewusst UNVERÄNDERT geteilt — anders
        // als "results" (ResultSchema.athleteId) hat PlanSchema keine
        // Eigentümer:in auf Personenebene, sondern nur groupId; ein
        // Trainingsplan ist konzeptionell ein Team-/Gruppendokument, kein
        // individueller Datensatz, dem sich "eigene athleteId" sinnvoll
        // zuordnen ließe.
        if (store === 'results' && requester.role === 'athlete') {
          const ownAthleteId = requester.athleteId;
          const existingAthleteId = (existing as { athleteId?: unknown } | null)?.athleteId;
          if (existing && existingAthleteId !== ownAthleteId) {
            results.push({ eventId: event.id, status: 'error', message: 'Athlet:innen dürfen nur eigene Ergebnisse ändern oder löschen.' });
            continue;
          }
          if (event.action !== 'delete') {
            const payloadAthleteId = (validatedPayload as { athleteId?: unknown } | null)?.athleteId;
            if (payloadAthleteId !== ownAthleteId) {
              results.push({ eventId: event.id, status: 'error', message: 'Athlet:innen dürfen nur eigene Ergebnisse anlegen oder ändern.' });
              continue;
            }
          }
        }

        const decision = resolveConflict(
          store,
          { clientUpdatedAt: event.clientUpdatedAt },
          existing ? { updatedAt: existing.updatedAt.toISOString() } : null,
        );

        if (decision.outcome === 'conflict-server-wins') {
          // Kein Redaktionsbedarf für Rolle "athlete" hier (anders als
          // beim Pull, siehe sync.athleteScope.ts): "athletes" steht laut
          // STORE_PERMISSIONS für diese Rolle nicht mehr bis hierher —
          // requireWritePermission weist einen Push-Versuch bereits als
          // Guard 3 ab, dieser Zweig ist für "athlete" auf "athletes" also
          // unerreichbar.
          results.push({ eventId: event.id, status: 'conflict', serverVersion: existing as Record<string, unknown> | null });
          continue;
        }

        // Ledger-Eintrag für applyAndMarkProcessed() unten — identisch für
        // alle vier Zweige, daher hier einmal statt viermal aufgebaut.
        const ledgerEvent = { id: event.id, clubId: requester.clubId, store, action: event.action };

        try {
          if (event.action === 'delete') {
            // Datenänderung UND Ledger-Eintrag werden ATOMAR in einer
            // Transaktion geschrieben (siehe applyAndMarkProcessed()),
            // nicht in zwei getrennten Schritten: bräche der Prozess
            // zwischen beiden ab (Deploy, OOM, DB-Verbindungsabbruch),
            // würde ein erneut gesendetes Event beim Retry ein zweites Mal
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

      // Rollen-Scopierung beim Lesen, Store-Ebene (siehe sync.permissions.ts:
      // STORE_PERMISSIONS): Changes aus einem Store, den die anfragende
      // Rolle laut Tabelle gar nicht lesen darf, werden komplett
      // unterdrückt. Mit den heutigen drei synchronisierenden Rollen
      // (trainer/admin/athlete) ist das noch ein No-Op — jeder Store ist
      // für alle drei lesbar (siehe Tabelle) — aber der Mechanismus greift
      // automatisch, sobald künftig eine Rolle mit eingeschränktem
      // Lesezugriff hinzukommt. Zusätzlich (kein No-Op mehr, siehe
      // STORE_MODULE_MAP in sync.permissions.ts): Changes aus einem Store,
      // dessen Modul-Paket der Verein nicht gebucht hat, werden ebenso
      // unterdrückt.
      changes = changes.filter((change) => canRead(change.store, requester.role, requester.enabledModules));

      // Rollen-Scopierung beim Lesen, Zeilen-/Feld-Ebene (siehe
      // sync.athleteScope.ts): WICHTIG — die Filterung erfolgt NACH der
      // Pagination (auf `page`, nicht auf `rows`) — `hasMore`/`nextCursor`
      // bleiben dadurch unverändert korrekt, auch wenn dem Client dadurch
      // weniger als PULL_PAGE_SIZE sichtbare Changes in dieser Seite ankommen.
      if (requester.role === 'athlete') {
        changes = changes
          .map((change) => scopeChangeForAthlete(change, requester.athleteId))
          .filter((change): change is SyncChange => change !== null);
      }

      // `nextCursor` wird IMMER zurückgegeben, sobald diese Seite Zeilen
      // enthält — nicht nur, wenn `hasMore` gesetzt ist. Der Client
      // (syncClient.js: pull()) persistiert einen Cursor nur, wenn er
      // nicht `null` ist; bliebe er auf der letzten Seite eines
      // Sync-Zyklus `null`, würde bei ≤ PULL_PAGE_SIZE Änderungen seit dem
      // letzten Sync (der Normalfall — alle passen in eine einzige Seite)
      // NIE ein Cursor gespeichert, und jeder automatische
      // Hintergrund-Sync (alle 60 s, siehe app.js) zöge dauerhaft den
      // kompletten Vereinsbestand erneut. `page` ist nach der
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
