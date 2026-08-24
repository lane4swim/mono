// apps/api/src/jobs/syncBookkeeping.repository.memory.ts
//
// Test-Double für SyncBookkeepingGateway — siehe jobs/erasure.repository.ts
// für dasselbe Prinzip.
import type { SyncBookkeepingGateway } from './syncBookkeeping.repository.js';

export class InMemorySyncBookkeepingGateway implements SyncBookkeepingGateway {
  constructor(
    private readonly syncedEvents: Array<{ appliedAt: Date }> = [],
    private readonly syncTombstones: Array<{ deletedAt: Date }> = [],
  ) {}

  async deleteSyncedEventsOlderThan(cutoff: Date): Promise<number> {
    const before = this.syncedEvents.length;
    const kept = this.syncedEvents.filter((e) => e.appliedAt.getTime() >= cutoff.getTime());
    this.syncedEvents.length = 0;
    this.syncedEvents.push(...kept);
    return before - kept.length;
  }

  async deleteSyncTombstonesOlderThan(cutoff: Date): Promise<number> {
    const before = this.syncTombstones.length;
    const kept = this.syncTombstones.filter((t) => t.deletedAt.getTime() >= cutoff.getTime());
    this.syncTombstones.length = 0;
    this.syncTombstones.push(...kept);
    return before - kept.length;
  }
}
