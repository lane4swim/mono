import { describe, it, expect } from 'vitest';
import { runWithLease } from '../../../src/jobs/scheduler/runJob.js';
import { InMemoryJobStateRepository } from '../../../src/jobs/scheduler/jobState.repository.memory.js';

const now = new Date('2026-10-11T02:00:00Z');
const clock = () => now;

describe('runWithLease', () => {
  it('führt den Job aus und hält ein erfolgreiches Ergebnis fest', async () => {
    const state = new InMemoryJobStateRepository();
    const outcome = await runWithLease({ name: 'job', state, owner: 'a', clock, run: async () => ({ summary: { processed: 2 }, failures: [] }) });
    expect(outcome.acquired).toBe(true);
    const [saved] = await state.list();
    expect(saved).toMatchObject({ lastStatus: 'success', lastSummary: { processed: 2 }, lastStartedAt: now, lockedBy: null, runningSince: null, consecutiveFailures: 0 });
  });

  it('Einzelfehler ergeben "partial"; die Details werden zurückgegeben, aber nicht gespeichert', async () => {
    const state = new InMemoryJobStateRepository();
    const outcome = await runWithLease({ name: 'job', state, owner: 'a', clock, run: async () => ({ summary: { failed: 1 }, failures: ['userId u-1: kaputt'] }) });
    expect(outcome).toMatchObject({ acquired: true, failures: ['userId u-1: kaputt'] });
    const [saved] = await state.list();
    expect(saved).toMatchObject({ lastStatus: 'partial', lastError: null, consecutiveFailures: 1 });
    expect(JSON.stringify(saved)).not.toContain('u-1');
  });

  it('eine Ausnahme ergibt "failed" mit Fehlermeldung und zählt die Fehlschläge hoch', async () => {
    const state = new InMemoryJobStateRepository();
    state.seed({ name: 'job', consecutiveFailures: 2 });
    const outcome = await runWithLease({ name: 'job', state, owner: 'a', clock, run: async () => { throw new Error('DB weg'); } });
    expect(outcome.acquired).toBe(true);
    const [saved] = await state.list();
    expect(saved).toMatchObject({ lastStatus: 'failed', lastError: 'DB weg', consecutiveFailures: 3, lockedBy: null });
  });

  it('setzt die Fehlschlagzählung nach einem Erfolg zurück', async () => {
    const state = new InMemoryJobStateRepository();
    state.seed({ name: 'job', consecutiveFailures: 5 });
    await runWithLease({ name: 'job', state, owner: 'a', clock, run: async () => ({ summary: {}, failures: [] }) });
    expect((await state.list())[0]!.consecutiveFailures).toBe(0);
  });

  it('überspringt den Job, solange eine andere Instanz die Lease hält', async () => {
    const state = new InMemoryJobStateRepository();
    state.seed({ name: 'job', lockedBy: 'b', lockedUntil: new Date(now.getTime() + 60_000), runningSince: now });
    let ran = false;
    const outcome = await runWithLease({ name: 'job', state, owner: 'a', clock, run: async () => { ran = true; return { summary: {}, failures: [] }; } });
    expect(outcome.acquired).toBe(false);
    expect(ran).toBe(false);
  });

  it('übernimmt eine abgelaufene Lease (abgestürzter Lauf)', async () => {
    const state = new InMemoryJobStateRepository();
    state.seed({ name: 'job', lockedBy: 'b', lockedUntil: new Date(now.getTime() - 1), runningSince: new Date(now.getTime() - 3_600_000) });
    const outcome = await runWithLease({ name: 'job', state, owner: 'a', clock, run: async () => ({ summary: {}, failures: [] }) });
    expect(outcome.acquired).toBe(true);
    expect((await state.list())[0]).toMatchObject({ lastStatus: 'success', lockedBy: null });
  });
});
