// packages/shared-types/src/syncEvent.ts
//
// Vertrag für die Sync-API (Abschnitt 6 im Backend-Entwicklungsplan).
// Ein SyncEvent entspricht einem Eintrag der clientseitigen Sync-
// Warteschlange (js/db.js: enqueueSyncEvent) und wird 1:1 an
// POST /api/sync/push gesendet bzw. von GET /api/sync/pull geliefert.
import { z } from 'zod';

export const SyncStoreSchema = z.enum([
  'users',
  'athletes',
  'groups',
  'competitions',
  'entries',
  'results',
  'exercises',
  'templates',
  'plans',
  'sessions',
  'actionItems',
]);
export type SyncStore = z.infer<typeof SyncStoreSchema>;

export const SyncActionSchema = z.enum(['create', 'update', 'delete']);
export type SyncAction = z.infer<typeof SyncActionSchema>;

export const SyncEventSchema = z.object({
  id: z.string().min(1), // client-generierte UUID, dient als Idempotenz-Schlüssel
  store: SyncStoreSchema,
  entityId: z.string().min(1),
  action: SyncActionSchema,
  payload: z.record(z.unknown()).nullable(), // bei action === 'delete' ist payload null
  clientUpdatedAt: z.string().datetime(),
});
export type SyncEvent = z.infer<typeof SyncEventSchema>;

// Code-Review, Befund R3: `events` prüfte hier zuvor JEDES Element bereits
// vollständig gegen SyncEventSchema — ein einzelnes strukturell ungültiges
// Event ließ POST /api/sync/push dadurch mit einer 400 für den GESAMTEN
// Batch scheitern (bis zu 500 Events, siehe PUSH_BATCH_SIZE in
// syncClient.js), inklusive aller übrigen, gültigen Events. sync.service.ts:
// push() validiert jedes Event ohnehin ZUSÄTZLICH einzeln (siehe dort,
// SyncEventSchema.safeParse(rawEvent)) und meldet ein ungültiges Event als
// eigenes "error"-Ergebnis statt den ganzen Request abzulehnen — dieser
// Codepfad war über HTTP bislang aber unerreichbar, da die Route bereits
// vorher blockierte. `z.unknown()` statt SyncEventSchema lässt genau diese
// robustere Pro-Event-Behandlung erstmals greifen; die Route selbst prüft
// weiterhin die Batch-Größe (min/max), das eigentliche DoS-relevante Limit.
export const SyncPushRequestSchema = z.object({
  events: z.array(z.unknown()).min(1).max(500),
});
export type SyncPushRequest = z.infer<typeof SyncPushRequestSchema>;

export const SyncEventResultStatusSchema = z.enum(['applied', 'conflict', 'error']);

export const SyncEventResultSchema = z.object({
  eventId: z.string().min(1),
  status: SyncEventResultStatusSchema,
  serverVersion: z.record(z.unknown()).nullable().optional(),
  // `message` ist IMMER Deutsch (siehe sync.service.ts) — reine
  // Diagnose-/Log-Information, keine für Endnutzer:innen lokalisierte
  // Anzeige. `code` ist der dafür vorgesehene, sprachunabhängige
  // Stellvertreter: eine feste, kleine Menge stabiler Bezeichner (siehe
  // apps/api/src/modules/sync/sync.service.ts, PUSH_GUARDS und
  // umliegender Code), die das Frontend über
  // apps/web/js/i18n/{de-DE,en-US}.js: common.syncErrors übersetzt
  // (apps/web/js/apiClient.js: syncErrorMessage()). Analog zum
  // {error, message}-Muster der regulären HTTP-4xx-Antworten (siehe
  // httpErrorHandler.ts), nur unter dem Namen `code` statt `error` — der
  // Name `error` war hier bereits an anderer Stelle (SyncEventResultStatus
  // "error") vergeben.
  message: z.string().optional(),
  code: z.string().optional(),
});
export type SyncEventResult = z.infer<typeof SyncEventResultSchema>;

export const SyncPushResponseSchema = z.object({
  results: z.array(SyncEventResultSchema),
});
export type SyncPushResponse = z.infer<typeof SyncPushResponseSchema>;

// "cursor" ist ebenfalls als .datetime() geprüft (nicht nur als
// beliebiger String): der Server generiert ihn ausschließlich selbst aus
// einer Change-Zeile (`updatedAt.toISOString()`, siehe sync.service.ts:
// pull()) — ein Client sendet ihn nur unverändert zurück. Ohne diese
// Prüfung erzeugte ein manipulierter/kaputter Wert (z. B. "?cursor=abc")
// im Service ein `Invalid Date`, das die anschließende Datenbankabfrage
// mit einem ungefangenen Fehler statt einer regulären 400-Antwort
// quittierte.
export const SyncPullQuerySchema = z.object({
  since: z.string().datetime().optional(),
  cursor: z.string().datetime().optional(),
});
export type SyncPullQuery = z.infer<typeof SyncPullQuerySchema>;

export const SyncChangeSchema = z.object({
  store: SyncStoreSchema,
  entityId: z.string().min(1),
  action: SyncActionSchema,
  payload: z.record(z.unknown()).nullable(),
  updatedAt: z.string().datetime(),
});
export type SyncChange = z.infer<typeof SyncChangeSchema>;

export const SyncPullResponseSchema = z.object({
  changes: z.array(SyncChangeSchema),
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
});
export type SyncPullResponse = z.infer<typeof SyncPullResponseSchema>;
