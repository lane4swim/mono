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

export const SyncPushRequestSchema = z.object({
  events: z.array(SyncEventSchema).min(1).max(500),
});
export type SyncPushRequest = z.infer<typeof SyncPushRequestSchema>;

export const SyncEventResultStatusSchema = z.enum(['applied', 'conflict', 'error']);

export const SyncEventResultSchema = z.object({
  eventId: z.string().min(1),
  status: SyncEventResultStatusSchema,
  serverVersion: z.record(z.unknown()).nullable().optional(),
  message: z.string().optional(),
});
export type SyncEventResult = z.infer<typeof SyncEventResultSchema>;

export const SyncPushResponseSchema = z.object({
  results: z.array(SyncEventResultSchema),
});
export type SyncPushResponse = z.infer<typeof SyncPushResponseSchema>;

export const SyncPullQuerySchema = z.object({
  since: z.string().datetime().optional(),
  cursor: z.string().optional(),
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
