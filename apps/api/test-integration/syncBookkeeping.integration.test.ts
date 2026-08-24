// apps/api/test-integration/syncBookkeeping.integration.test.ts
//
// Prüft PrismaSyncBookkeepingGateway gegen eine echte Datenbank (siehe
// vitest.integration.config.ts) — insbesondere, dass deleteMany() mit
// einem echten Zeitstempel-Vergleich tatsächlich nur die veralteten Zeilen
// trifft (Code-Review, Befund: SyncedEvent/SyncTombstone wuchsen bislang
// unbegrenzt).
import { describe, it, expect, afterEach, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { PrismaSyncBookkeepingGateway } from '../src/jobs/syncBookkeeping.repository.js';
import { getTestPrisma, closeTestPrisma, truncateAll, createTestClub } from './helpers.js';

const prisma = getTestPrisma();
const gateway = new PrismaSyncBookkeepingGateway(prisma);

afterEach(async () => {
  await truncateAll();
});
afterAll(async () => {
  await closeTestPrisma();
});

describe('PrismaSyncBookkeepingGateway.deleteSyncedEventsOlderThan()', () => {
  it('löscht nur SyncedEvents, deren appliedAt vor dem cutoff liegt', async () => {
    const club = await createTestClub();
    const oldEvent = await prisma.syncedEvent.create({
      data: { id: randomUUID(), clubId: club.id, store: 'groups', action: 'create', appliedAt: new Date('2026-01-01T00:00:00.000Z') },
    });
    const recentEvent = await prisma.syncedEvent.create({
      data: { id: randomUUID(), clubId: club.id, store: 'groups', action: 'create', appliedAt: new Date('2026-07-01T00:00:00.000Z') },
    });

    const deleted = await gateway.deleteSyncedEventsOlderThan(new Date('2026-06-01T00:00:00.000Z'));

    expect(deleted).toBe(1);
    expect(await prisma.syncedEvent.findUnique({ where: { id: oldEvent.id } })).toBeNull();
    expect(await prisma.syncedEvent.findUnique({ where: { id: recentEvent.id } })).not.toBeNull();
  });
});

describe('PrismaSyncBookkeepingGateway.deleteSyncTombstonesOlderThan()', () => {
  it('löscht nur SyncTombstones, deren deletedAt vor dem cutoff liegt', async () => {
    const club = await createTestClub();
    const oldTombstone = await prisma.syncTombstone.create({
      data: { clubId: club.id, store: 'athletes', entityId: 'alt', deletedAt: new Date('2026-01-01T00:00:00.000Z') },
    });
    const recentTombstone = await prisma.syncTombstone.create({
      data: { clubId: club.id, store: 'athletes', entityId: 'neu', deletedAt: new Date('2026-07-01T00:00:00.000Z') },
    });

    const deleted = await gateway.deleteSyncTombstonesOlderThan(new Date('2026-06-01T00:00:00.000Z'));

    expect(deleted).toBe(1);
    expect(await prisma.syncTombstone.findUnique({ where: { id: oldTombstone.id } })).toBeNull();
    expect(await prisma.syncTombstone.findUnique({ where: { id: recentTombstone.id } })).not.toBeNull();
  });
});
