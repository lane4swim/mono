// PrismaJobStateRepository gegen echtes Postgres: die Lease muss bei
// gleichzeitigen Aufrufen genau EINEN Gewinner liefern — das kann das
// In-Memory-Double nicht nachweisen.
import { describe, it, expect, afterEach, afterAll } from 'vitest';
import { getTestPrisma, closeTestPrisma } from './helpers.js';
import { PrismaJobStateRepository } from '../src/jobs/scheduler/jobState.repository.js';

const prisma = getTestPrisma();
const repo = new PrismaJobStateRepository(prisma);
const LEASE_MS = 60_000;

afterEach(async () => { await prisma.scheduledJobState.deleteMany(); });
afterAll(async () => { await closeTestPrisma(); });

describe('PrismaJobStateRepository', () => {
  it('vergibt die Lease bei gleichzeitigen Aufrufen genau einmal', async () => {
    const now = new Date();
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => repo.tryAcquire('job', `owner-${i}`, now, LEASE_MS)));
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it('gibt eine abgelaufene Lease frei, eine gültige nicht', async () => {
    const t0 = new Date('2026-10-11T02:00:00Z');
    expect(await repo.tryAcquire('job', 'a', t0, LEASE_MS)).toBe(true);
    expect(await repo.tryAcquire('job', 'b', new Date(t0.getTime() + LEASE_MS - 1), LEASE_MS)).toBe(false);
    expect(await repo.tryAcquire('job', 'b', new Date(t0.getTime() + LEASE_MS + 1), LEASE_MS)).toBe(true);
  });

  it('release() speichert das Ergebnis, zählt Fehlschläge und ignoriert fremde Besitzer', async () => {
    const t0 = new Date('2026-10-11T02:00:00Z');
    await repo.tryAcquire('job', 'a', t0, LEASE_MS);
    await repo.release('job', 'b', { startedAt: t0, finishedAt: t0, status: 'success', summary: {}, error: null });
    expect((await repo.list())[0]).toMatchObject({ lockedBy: 'a', lastStatus: null });

    await repo.release('job', 'a', { startedAt: t0, finishedAt: new Date(t0.getTime() + 500), status: 'failed', summary: { n: 1 }, error: 'x'.repeat(2000) });
    const [state] = await repo.list();
    expect(state).toMatchObject({ lockedBy: null, lockedUntil: null, runningSince: null, lastStatus: 'failed', lastSummary: { n: 1 }, consecutiveFailures: 1, lastStartedAt: t0 });
    expect(state!.lastError).toHaveLength(500);

    await repo.tryAcquire('job', 'a', t0, LEASE_MS);
    await repo.release('job', 'a', { startedAt: t0, finishedAt: t0, status: 'success', summary: {}, error: null });
    expect((await repo.list())[0]!.consecutiveFailures).toBe(0);
  });
});
