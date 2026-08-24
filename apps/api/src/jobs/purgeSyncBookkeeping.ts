// apps/api/src/jobs/purgeSyncBookkeeping.ts
//
// Orchestrierung des Aufräumens alter Sync-Bookkeeping-Zeilen (SyncedEvent,
// SyncTombstone — siehe syncBookkeeping.repository.ts für die Begründung
// der beiden unterschiedlichen Aufbewahrungsfristen). Wird zusammen mit dem
// DSGVO-Hard-Purge von scripts/purgeDeletedData.ts per Cron ausgeführt —
// ein eigener Cron-Eintrag wäre hier unnötiger Betriebsaufwand für dieselbe
// tägliche Kadenz.
//
// Absichtlich als reine Orchestrierungsfunktion (kein eigener DB-Zugriff)
// gehalten, damit sie ohne Datenbank testbar ist (siehe
// test/jobs/purgeSyncBookkeeping.test.ts).
import type { SyncBookkeepingGateway } from './syncBookkeeping.repository.js';

export interface SyncBookkeepingPurgeResult {
  deletedSyncedEvents: number;
  deletedSyncTombstones: number;
}

export async function purgeSyncBookkeeping(
  gateway: SyncBookkeepingGateway,
  retentionDays: { syncedEvents: number; syncTombstones: number },
  now: Date = new Date(),
): Promise<SyncBookkeepingPurgeResult> {
  const syncedEventCutoff = new Date(now.getTime() - retentionDays.syncedEvents * 24 * 60 * 60 * 1000);
  const tombstoneCutoff = new Date(now.getTime() - retentionDays.syncTombstones * 24 * 60 * 60 * 1000);

  const [deletedSyncedEvents, deletedSyncTombstones] = await Promise.all([
    gateway.deleteSyncedEventsOlderThan(syncedEventCutoff),
    gateway.deleteSyncTombstonesOlderThan(tombstoneCutoff),
  ]);

  return { deletedSyncedEvents, deletedSyncTombstones };
}
