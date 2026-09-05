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
  ENTITY_STORE_NAMES,
  type SyncEvent,
  type SyncEventResult,
  type SyncChange,
  type EntityStoreName,
  type Role,
} from '@lane1/shared-types';
import { resolveConflict } from '@lane1/sync-protocol';
import type { SyncGateway, SyncRecord } from './sync.gateway.js';
import { isKnownStore, canRead, canWrite, isAthleteScoped } from './sync.permissions.js';
import { assertForeignKeysWithinClub, FOREIGN_ENTITY_ERROR_CODE } from './sync.foreignKeys.js';
import { scopeChangeForAthlete } from './sync.athleteScope.js';
import { assertCommentAuthorship, COMMENT_AUTHORSHIP_ERROR_CODE } from './sync.commentAuthorship.js';
import { PULL_PAGE_SIZE, PULL_TIE_SAFETY_LIMIT, splitAtSafeTimestampBoundary } from './sync.pagination.js';
import { describeSyncError } from './sync.errors.js';

export interface SyncRequester {
  // Sicherheitsreview 2026-08-27, Befund M2: die tatsächliche User-ID der
  // anfragenden Person (request.user.sub) — bislang wurde nur clubId/
  // role/athleteId durchgereicht. Wird für die Autor:innen-Prüfung
  // eingebetteter Kommentare gebraucht (siehe sync.commentAuthorship.ts:
  // ein neuer Kommentar muss userId === requester.userId tragen).
  userId: string;
  clubId: string; // Superadmin (clubId: null) darf nicht synchronisieren — siehe sync.route.ts (requireAnyRole).
  // Für die Rollen-Scopierung unten — clubId allein reicht nicht: ein
  // Athlet:innen-Konto darf zwar denselben Verein sehen wie
  // Trainer:innen/Admins, aber nicht dieselbe Datentiefe (siehe
  // sync.permissions.ts: STORE_PERMISSIONS-Kommentar). Ein Konto kann
  // mehrere Rollen gleichzeitig haben (docs/kampfrichter-modul-plan.md,
  // Abschnitt 1) — canRead()/canWrite()/isAthleteScoped() werten die
  // gesamte Menge aus, nicht nur einen Einzelwert.
  roles: readonly Role[];
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
  // Review 30.08.2026, Befund E2: EINE, für den gesamten push()-Aufruf
  // gemeinsame (Referenz-)Instanz statt je Event ein eigener
  // Datenbank-Zugriff (siehe shortCircuitIfProcessed() unten und die
  // Vorab-Batch-Abfrage in push() selbst). Wird nach jeder erfolgreich
  // ANGEWENDETEN Schreibung um die jeweilige event.id ergänzt — dadurch
  // erkennt eine SPÄTERE, doppelte event.id INNERHALB DESSELBEN Batches
  // (z. B. ein versehentlich zweimal gesendetes Event) den bereits
  // erfolgten Abschluss genauso zuverlässig wie zuvor der Live-Datenbank-
  // Check, nur ohne dessen Zugriff je Event.
  readonly processedEventIds: Set<string>;
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
    return { eventId: (ctx.raw as { id?: string })?.id ?? 'unknown', status: 'error', message: 'Event-Struktur ungültig.', code: 'invalid_event' };
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
    return { eventId: event.id, status: 'error', message: `Unbekannter Store "${event.store}".`, code: 'unknown_store' };
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
  if (!canWrite(store, ctx.requester.roles, ctx.requester.enabledModules)) {
    return { eventId: event.id, status: 'error', message: `Keine der Rollen [${ctx.requester.roles.join(', ')}] darf den Store "${store}" verändern.`, code: 'write_not_permitted' };
  }
  return null;
}

// Stufe 4: Idempotenz-FAST-PATH — bereits verarbeitete Events werden als
// "applied" gemeldet (nicht als Fehler), damit ein Client, der wegen eines
// Verbindungsabbruchs dieselbe Antwort nicht sah, beim erneuten Senden ein
// konsistentes Ergebnis bekommt.
//
// Review 30.08.2026, Befund E2: prüft seitdem NUR NOCH gegen
// ctx.processedEventIds (siehe PushCtx-Kommentar oben) — vormals ein
// eigener ctx.gateway.isEventProcessed()-Datenbankzugriff JE Event (bei
// den bis zu 200 Events eines Batches also bis zu 200 Abfragen allein für
// diesen Fast-Path). Die Menge wird VOR der Schleife einmalig per
// SyncGateway.findProcessedEventIds() für den gesamten Batch geladen
// (siehe push() unten) und danach synchron, ohne DB-Zugriff, konsultiert.
// Das clubId-Scoping (ein fremdes, erratenes Event-ID bekommt dadurch die
// korrekte, ungescopte Antwort statt eines wirkungslosen "applied")
// bleibt erhalten — findProcessedEventIds() ist genau wie isEventProcessed()
// zuvor mit `clubId` gescoped.
//
// Bewusst nur ein FAST-PATH, keine alleinige Korrektheitsgarantie: dieser
// Check ist ein reines Check-then-Act ohne Sperre — zwei praktisch
// gleichzeitige Pushes desselben Events (aus ZWEI unterschiedlichen
// push()-Aufrufen, mit je eigener processedEventIds-Menge) könnten diese
// Prüfung beide passieren, bevor eine von beiden den Ledger-Eintrag
// geschrieben hat. Er spart in diesem (Normal-)Fall lediglich die
// nachfolgenden Guards sowie den Transaktionsversuch für ein Event, dessen
// Ergebnis ohnehin feststeht. Die tatsächliche, nebenläufigkeitssichere
// Garantie liefert erst applyAndMarkProcessed() (siehe push() unten), das
// die Datenänderung UND den Ledger-Eintrag atomar in einer Transaktion
// zusammenfasst.
function shortCircuitIfProcessed(ctx: PushCtx): SyncEventResult | null {
  const event = ctx.event!;
  if (ctx.processedEventIds.has(event.id)) {
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
    return { eventId: event.id, status: 'error', message: `Payload entspricht nicht dem Schema für "${store}".`, code: 'invalid_payload' };
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
    return { eventId: event.id, status: 'error', message: 'clubId des Events stimmt nicht mit dem eigenen Verein überein.', code: 'club_mismatch' };
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
    return { eventId: event.id, status: 'error', message: fkError, code: FOREIGN_ENTITY_ERROR_CODE };
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

      // Review 30.08.2026, Befund E2: Vorab-Batch-Abfragen statt bis zu drei
      // Datenbank-Zugriffen JE Event (isEventProcessed(), findById() hier,
      // plus applyAndMarkProcessed() selbst — Letzteres bleibt unverändert
      // je Event, siehe Begründung bei requireForeignKeysWithinClub oben:
      // außerhalb des hier betrachteten Umfangs). Bei den bis zu 200 Events
      // eines Batches waren das vormals bis zu ~600 serielle
      // Datenbank-Round-Trips allein für die ersten beiden.
      //
      // Bewusst NUR eine grobe, fehlertolerante Vorab-Erfassung (dasselbe
      // SyncEventSchema.safeParse() + isKnownStore()-Prüfung wie parseEvent()/
      // requireKnownStore() oben) — ein Event, das hier nicht erfasst wird
      // (weil strukturell ungültig oder unbekannter Store), scheitert
      // deterministisch auch gleich an genau diesen beiden Guards weiter
      // unten und erreicht die `existing`-Ermittlung ohnehin nie. Die
      // eigentliche, sicherheitsrelevante Validierung bleibt vollständig in
      // PUSH_GUARDS — diese Vorab-Erfassung dient AUSSCHLIESSLICH dazu, zu
      // wissen, welche (store, entityId)- bzw. event.id-Werte überhaupt
      // vorab nachgeladen werden lohnen.
      const prefetchTargets: Array<{ id: string; store: EntityStoreName; entityId: string }> = [];
      for (const raw of events) {
        const parsed = SyncEventSchema.safeParse(raw);
        if (!parsed.success || !isKnownStore(parsed.data.store)) continue;
        prefetchTargets.push({ id: parsed.data.id, store: parsed.data.store, entityId: parsed.data.entityId });
      }

      // Stufe-4-Fast-Path (shortCircuitIfProcessed) für den GESAMTEN Batch
      // in einer Abfrage statt einer je Event. Mutable und BEWUSST per
      // Referenz an jeden ctx weitergegeben (siehe PushCtx-Kommentar oben)
      // — wird unten nach jeder erfolgreich abgeschlossenen Schreibung um
      // die jeweilige event.id ergänzt, damit eine spätere doppelte
      // event.id INNERHALB dieses Batches sie ebenfalls als bereits
      // verarbeitet erkennt (identisch zum Verhalten des vormaligen
      // Live-Checks, der den zwischenzeitlich committeten Ledger-Eintrag
      // gesehen hätte).
      const processedEventIds = await deps.gateway.findProcessedEventIds(
        prefetchTargets.map((t) => t.id),
        requester.clubId,
      );

      // "existing"-Vorabladung, gruppiert nach Store — eine
      // findManyByIdsInClub()-Abfrage JE BETROFFENEM STORE statt einer
      // findById()-Abfrage je Event.
      const entityIdsByStore = new Map<EntityStoreName, Set<string>>();
      for (const target of prefetchTargets) {
        let ids = entityIdsByStore.get(target.store);
        if (!ids) { ids = new Set(); entityIdsByStore.set(target.store, ids); }
        ids.add(target.entityId);
      }
      const prefetchedExisting = new Map<string, SyncRecord>();
      await Promise.all(
        Array.from(entityIdsByStore.entries()).map(async ([store, ids]) => {
          const found = await deps.gateway.findManyByIdsInClub(store, Array.from(ids), requester.clubId);
          for (const [id, record] of found) prefetchedExisting.set(`${store}:${id}`, record);
        }),
      );

      // Korrektheits-Absicherung (Review 30.08.2026, Befund E2): ein
      // einzelner Offline-Datensatz kann laut apps/web/js/db.js
      // (enqueueSyncEvent() vergibt bei JEDEM Aufruf eine NEUE event-id)
      // mehrere Sync-Events erzeugen, die im SELBEN Push-Batch landen
      // (z. B. anlegen, dann sofort ändern). Das oben vorab geladene
      // `prefetchedExisting` spiegelt den Datenbankstand VOR dem gesamten
      // Batch — für ein zweites Event auf dieselbe (store, entityId) wäre
      // es nach der ersten, im Batch bereits angewendeten Schreibung
      // VERALTET (z. B. fälschlich weiterhin "existiert nicht", obwohl das
      // vorherige Event im selben Batch den Datensatz gerade angelegt hat
      // — mit gravierender Folge: resolveConflict() bekäme `null` statt
      // der soeben geschriebenen Zeile und träfe dadurch die falsche
      // Konfliktentscheidung). `touchedInThisPush` erzwingt für genau
      // diesen (in der Praxis seltenen) Fall einen frischen, einzelnen
      // findById()-Aufruf statt der vorgeladenen Karte — für die
      // überwältigende Mehrheit der Events (jede entityId kommt nur einmal
      // im Batch vor) bleibt es bei der vorgeladenen Karte ohne
      // zusätzlichen Zugriff.
      const touchedInThisPush = new Set<string>();

      for (const raw of events) {
        const ctx: PushCtx = { requester, gateway: deps.gateway, raw, processedEventIds };

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
        //
        // Siehe touchedInThisPush-Kommentar oben: nur für eine (store,
        // entityId), die INNERHALB DIESES Batches bereits geschrieben
        // wurde, erfolgt hier noch ein einzelner Live-Zugriff — sonst
        // genügt die vorab geladene Karte.
        const existingKey = `${store}:${event.entityId}`;
        const existing = touchedInThisPush.has(existingKey)
          ? await deps.gateway.findById(store, event.entityId, requester.clubId)
          : (prefetchedExisting.get(existingKey) ?? null);

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
        if (store === 'results' && isAthleteScoped(requester.roles)) {
          const ownAthleteId = requester.athleteId;
          const existingAthleteId = (existing as { athleteId?: unknown } | null)?.athleteId;
          if (existing && existingAthleteId !== ownAthleteId) {
            results.push({ eventId: event.id, status: 'error', message: 'Athlet:innen dürfen nur eigene Ergebnisse ändern oder löschen.', code: 'results_own_only' });
            continue;
          }
          if (event.action !== 'delete') {
            const payloadAthleteId = (validatedPayload as { athleteId?: unknown } | null)?.athleteId;
            if (payloadAthleteId !== ownAthleteId) {
              results.push({ eventId: event.id, status: 'error', message: 'Athlet:innen dürfen nur eigene Ergebnisse anlegen oder ändern.', code: 'results_own_only' });
              continue;
            }
          }
        }

        // Sicherheitsreview 2026-08-27, Befund M2 — siehe
        // sync.commentAuthorship.ts für die ausführliche Begründung.
        // Analog zur "results"-Prüfung oben: zusätzlich zur Store-Ebene
        // (STORE_PERMISSIONS erlaubt z. B. "plans" store-weit geteiltes
        // Schreiben für alle drei Rollen), aber auf die eingebetteten
        // Kommentar-Arrays verengt — ein NEU hinzugefügter Kommentar muss
        // der eigenen Identität zugeordnet sein, ein BESTEHENDER
        // Kommentar behält seine ursprüngliche Autor:innen-Zuordnung,
        // unabhängig davon, wer den umgebenden Datensatz gerade
        // bearbeitet. Braucht `existing` (oben bereits geladen) — deshalb
        // hier inline statt als PUSH_GUARDS-Eintrag, analog zur
        // "results"-Prüfung.
        if (event.action !== 'delete') {
          const authorshipError = assertCommentAuthorship(
            store,
            validatedPayload as Record<string, unknown>,
            existing as Record<string, unknown> | null,
            requester.userId,
          );
          if (authorshipError) {
            results.push({ eventId: event.id, status: 'error', message: authorshipError, code: COMMENT_AUTHORSHIP_ERROR_CODE });
            continue;
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

        // Review 30.08.2026, Befund E2: markiert (store, entityId) VOR dem
        // eigentlichen Schreibversuch als "in diesem Batch berührt" (siehe
        // touchedInThisPush-Kommentar oben) — für delete/update/regulären
        // create wird die bestehende Zeile unter genau dieser entityId
        // verändert. NICHT für insert-as-new: dort bleibt die ürsprüngliche
        // Zeile unter `event.entityId` unverändert (es wird eine NEUE Zeile
        // unter einer neu vergebenen id angelegt) — die vorab geladene
        // Karte bleibt für diese entityId also weiterhin gültig.
        if (decision.outcome !== 'insert-as-new') {
          touchedInThisPush.add(existingKey);
        }

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
            processedEventIds.add(event.id);
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
            processedEventIds.add(event.id);
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
            processedEventIds.add(event.id);
            results.push({ eventId: event.id, status: 'applied' });
          } else {
            await deps.gateway.applyAndMarkProcessed({ kind: 'create', store, payload: validatedPayload as Record<string, unknown> }, ledgerEvent);
            processedEventIds.add(event.id);
            results.push({ eventId: event.id, status: 'applied' });
          }
        } catch (err) {
          const { message, code } = describeSyncError(err);
          results.push({ eventId: event.id, status: 'error', message, code });
        }
      }

      return results;
    },

    async pull(
      query: { since?: string; cursor?: string },
      requester: SyncRequester,
    ): Promise<{ changes: SyncChange[]; nextCursor: string | null; hasMore: boolean }> {
      const since = query.cursor ? new Date(query.cursor) : query.since ? new Date(query.since) : null;

      // Review 30.08.2026, Befund E3: vorgezogen statt (wie bisher) erst
      // NACH der Paginierung auf dem bereits geladenen `page` angewendet
      // (siehe canRead()-Filter weiter unten, der UNVERÄNDERT bestehen
      // bleibt — dies hier verengt zusätzlich bereits die Abfrage selbst).
      // Ohne diese Vorab-Einschränkung skalierten sowohl die
      // Datenbankarbeit als auch die Zahl benötigter Seiten mit dem
      // GESAMTEN Vereinsbestand, unabhängig davon, wie viel davon die
      // anfragende Rolle/das gebuchte Modul-Set überhaupt sehen darf.
      const readableStores = ENTITY_STORE_NAMES.filter((store) => canRead(store, requester.roles, requester.enabledModules));

      const rows = await deps.gateway.listChangedSince(requester.clubId, since, PULL_PAGE_SIZE + 1, readableStores);
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
        const widened = await deps.gateway.listChangedSince(requester.clubId, new Date(tiedAt.getTime() - 1), PULL_TIE_SAFETY_LIMIT, readableStores);
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
      //
      // Review 30.08.2026, Befund E3: `readableStores` oben grenzt dieselbe
      // Bedingung bereits VOR der Datenbankabfrage ein — dieser Filter hier
      // bleibt trotzdem unverändert bestehen, als zusätzliche, von der
      // Abfrage unabhängige Absicherung (z. B. falls eine künftige
      // Gateway-Implementierung `stores` einmal nicht korrekt respektiert).
      // Er ist jetzt im Normalfall ein No-Op auf einer bereits vorgefilterten
      // Menge, nicht mehr die einzige Instanz dieser Prüfung.
      changes = changes.filter((change) => canRead(change.store, requester.roles, requester.enabledModules));

      // Rollen-Scopierung beim Lesen, Zeilen-/Feld-Ebene (siehe
      // sync.athleteScope.ts): WICHTIG — die Filterung erfolgt NACH der
      // Pagination (auf `page`, nicht auf `rows`) — `hasMore`/`nextCursor`
      // bleiben dadurch unverändert korrekt, auch wenn dem Client dadurch
      // weniger als PULL_PAGE_SIZE sichtbare Changes in dieser Seite ankommen.
      if (isAthleteScoped(requester.roles)) {
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
