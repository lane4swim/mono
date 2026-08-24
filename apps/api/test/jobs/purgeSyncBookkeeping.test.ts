// apps/api/test/jobs/purgeSyncBookkeeping.test.ts
import { describe, it, expect } from 'vitest';
import { purgeSyncBookkeeping } from '../../src/jobs/purgeSyncBookkeeping.js';
import { InMemorySyncBookkeepingGateway } from '../../src/jobs/syncBookkeeping.repository.memory.js';

const NOW = new Date('2026-07-20T00:00:00.000Z');
const RETENTION = { syncedEvents: 90, syncTombstones: 180 };

function daysBefore(now: Date, days: number): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

describe('purgeSyncBookkeeping', () => {
  it('löscht nichts, wenn alle Zeilen innerhalb der jeweiligen Aufbewahrungsfrist liegen', async () => {
    const syncedEvents = [{ appliedAt: daysBefore(NOW, 10) }];
    const syncTombstones = [{ deletedAt: daysBefore(NOW, 10) }];
    const gateway = new InMemorySyncBookkeepingGateway(syncedEvents, syncTombstones);

    const result = await purgeSyncBookkeeping(gateway, RETENTION, NOW);

    expect(result).toEqual({ deletedSyncedEvents: 0, deletedSyncTombstones: 0 });
    expect(syncedEvents).toHaveLength(1);
    expect(syncTombstones).toHaveLength(1);
  });

  it('löscht SyncedEvents, die älter als deren Frist sind, lässt SyncTombstones mit derselben Zeitmarke aber unangetastet', async () => {
    // 100 Tage alt: älter als die SyncedEvent-Frist (90), aber jünger als
    // die SyncTombstone-Frist (180) — genau der Fall, der die beiden
    // unterschiedlichen Fristen tatsächlich prüft.
    const syncedEvents = [{ appliedAt: daysBefore(NOW, 100) }];
    const syncTombstones = [{ deletedAt: daysBefore(NOW, 100) }];
    const gateway = new InMemorySyncBookkeepingGateway(syncedEvents, syncTombstones);

    const result = await purgeSyncBookkeeping(gateway, RETENTION, NOW);

    expect(result).toEqual({ deletedSyncedEvents: 1, deletedSyncTombstones: 0 });
    expect(syncedEvents).toHaveLength(0);
    expect(syncTombstones).toHaveLength(1);
  });

  it('löscht SyncTombstones, die älter als deren (großzügigere) Frist sind', async () => {
    const syncTombstones = [{ deletedAt: daysBefore(NOW, 200) }];
    const gateway = new InMemorySyncBookkeepingGateway([], syncTombstones);

    const result = await purgeSyncBookkeeping(gateway, RETENTION, NOW);

    expect(result.deletedSyncTombstones).toBe(1);
    expect(syncTombstones).toHaveLength(0);
  });

  it('behandelt eine Zeile GENAU an der Grenze als noch nicht fällig (< nicht <=)', async () => {
    const syncedEvents = [{ appliedAt: daysBefore(NOW, 90) }];
    const gateway = new InMemorySyncBookkeepingGateway(syncedEvents, []);

    const result = await purgeSyncBookkeeping(gateway, RETENTION, NOW);

    expect(result.deletedSyncedEvents).toBe(0);
    expect(syncedEvents).toHaveLength(1);
  });
});
