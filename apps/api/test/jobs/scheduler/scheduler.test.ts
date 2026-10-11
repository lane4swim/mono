import { describe, it, expect, vi, afterEach } from 'vitest';
import { createJobScheduler, type ScheduledJob, type SchedulerLogger } from '../../../src/jobs/scheduler/scheduler.js';
import { InMemoryJobStateRepository } from '../../../src/jobs/scheduler/jobState.repository.memory.js';
import type { JobStateRecord, JobStateRepository } from '../../../src/jobs/scheduler/jobState.repository.js';

function silentLogger(): SchedulerLogger & { lines: string[] } {
  const lines: string[] = [];
  return { lines, info: (m) => lines.push(m), warn: (m) => lines.push(m), error: (m) => lines.push(m) };
}

function countingJob(name: string, schedule: ScheduledJob['schedule'], calls: string[]): ScheduledJob {
  return { name, schedule, run: async () => { calls.push(name); return { summary: { n: 1 }, failures: [] }; } };
}

afterEach(() => { vi.useRealTimers(); });

describe('createJobScheduler — tick()', () => {
  it('führt nur fällige Jobs aus', async () => {
    const now = new Date('2026-10-11T12:00:00Z');
    const state = new InMemoryJobStateRepository();
    state.seed({ name: 'fresh', lastStartedAt: new Date('2026-10-11T10:00:00Z') });
    state.seed({ name: 'old', lastStartedAt: new Date('2026-10-11T05:00:00Z') });
    const calls: string[] = [];
    const scheduler = createJobScheduler({
      jobs: [countingJob('fresh', { kind: 'interval', hours: 6 }, calls), countingJob('old', { kind: 'interval', hours: 6 }, calls), countingJob('never', { kind: 'daily', hourUtc: 2 }, calls)],
      state, owner: 'a', logger: silentLogger(), tickMs: 1000, clock: () => now,
    });
    await scheduler.tick();
    expect(calls).toEqual(['old', 'never']);
    await scheduler.tick();
    expect(calls).toEqual(['old', 'never']);
  });

  it('zwei Instanzen führen einen fälligen Job nur einmal aus', async () => {
    const now = new Date('2026-10-11T12:00:00Z');
    const state = new InMemoryJobStateRepository();
    const calls: string[] = [];
    let release!: () => void;
    const blocker = new Promise<void>((r) => { release = r; });
    const job: ScheduledJob = { name: 'job', schedule: { kind: 'daily', hourUtc: 2 }, run: async () => { calls.push('run'); await blocker; return { summary: {}, failures: [] }; } };
    const a = createJobScheduler({ jobs: [job], state, owner: 'a', logger: silentLogger(), tickMs: 1000, clock: () => now });
    const b = createJobScheduler({ jobs: [job], state, owner: 'b', logger: silentLogger(), tickMs: 1000, clock: () => now });
    const first = a.tick();
    await b.tick();
    release();
    await first;
    expect(calls).toEqual(['run']);
  });

  it('ein fehlschlagender Job hält die übrigen nicht auf und wird protokolliert', async () => {
    const now = new Date('2026-10-11T12:00:00Z');
    const state = new InMemoryJobStateRepository();
    const calls: string[] = [];
    const logger = silentLogger();
    const failing: ScheduledJob = { name: 'boom', schedule: { kind: 'daily', hourUtc: 2 }, run: async () => { throw new Error('kaputt'); } };
    const scheduler = createJobScheduler({ jobs: [failing, countingJob('ok', { kind: 'daily', hourUtc: 2 }, calls)], state, owner: 'a', logger, tickMs: 1000, clock: () => now });
    await scheduler.tick();
    expect(calls).toEqual(['ok']);
    expect(logger.lines.some((l) => l.includes('boom') && l.includes('kaputt'))).toBe(true);
    expect((await state.list()).find((s) => s.name === 'boom')).toMatchObject({ lastStatus: 'failed', consecutiveFailures: 1 });
  });

  it('übersteht einen nicht lesbaren Jobzustand (Datenbank nicht erreichbar)', async () => {
    const broken: JobStateRepository = {
      list: async (): Promise<JobStateRecord[]> => { throw new Error('connection refused'); },
      tryAcquire: async () => false,
      release: async () => {},
    };
    const logger = silentLogger();
    const scheduler = createJobScheduler({ jobs: [], state: broken, owner: 'a', logger, tickMs: 1000 });
    await expect(scheduler.tick()).resolves.toBeUndefined();
    expect(logger.lines[0]).toContain('connection refused');
  });
});

describe('createJobScheduler — start()/stop()', () => {
  it('läuft im Takt und hört nach stop() auf', async () => {
    vi.useFakeTimers();
    const state = new InMemoryJobStateRepository();
    const calls: string[] = [];
    let now = new Date('2026-10-11T12:00:00Z');
    const scheduler = createJobScheduler({
      jobs: [countingJob('job', { kind: 'interval', hours: 1 }, calls)],
      state, owner: 'a', logger: silentLogger(), tickMs: 60_000, initialDelayMs: 5_000, clock: () => now,
    });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(4_999);
    expect(calls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toHaveLength(1);

    now = new Date('2026-10-11T13:00:00Z');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls).toHaveLength(2);

    await scheduler.stop();
    now = new Date('2026-10-11T15:00:00Z');
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(calls).toHaveLength(2);
  });

  it('stop() wartet auf einen laufenden Job', async () => {
    vi.useFakeTimers();
    const state = new InMemoryJobStateRepository();
    let release!: () => void;
    const blocker = new Promise<void>((r) => { release = r; });
    let finished = false;
    const job: ScheduledJob = { name: 'slow', schedule: { kind: 'daily', hourUtc: 2 }, run: async () => { await blocker; finished = true; return { summary: {}, failures: [] }; } };
    const scheduler = createJobScheduler({ jobs: [job], state, owner: 'a', logger: silentLogger(), tickMs: 60_000 });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    const stopping = scheduler.stop();
    let stopped = false;
    void stopping.then(() => { stopped = true; });
    await vi.advanceTimersByTimeAsync(0);
    expect(stopped).toBe(false);
    release();
    await stopping;
    expect(finished).toBe(true);
  });
});
