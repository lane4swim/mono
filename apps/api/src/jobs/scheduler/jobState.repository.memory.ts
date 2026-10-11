// In-Memory-Gegenstück zu PrismaJobStateRepository für die Unit-Tests
// (test/jobs/scheduler/*.test.ts, test/jobs/jobs.route.test.ts).
import type { JobStateRecord, JobStateRepository, JobRunResult } from './jobState.repository.js';
import { MAX_STORED_ERROR_LENGTH } from './jobState.repository.js';

function emptyState(name: string): JobStateRecord {
  return {
    name,
    lockedBy: null,
    lockedUntil: null,
    runningSince: null,
    lastStartedAt: null,
    lastFinishedAt: null,
    lastStatus: null,
    lastSummary: {},
    lastError: null,
    consecutiveFailures: 0,
  };
}

export class InMemoryJobStateRepository implements JobStateRepository {
  readonly states = new Map<string, JobStateRecord>();

  async list(): Promise<JobStateRecord[]> {
    return [...this.states.values()].sort((a, b) => a.name.localeCompare(b.name)).map((s) => ({ ...s }));
  }

  async tryAcquire(name: string, owner: string, now: Date, leaseMs: number): Promise<boolean> {
    const state = this.states.get(name) ?? emptyState(name);
    if (state.lockedUntil && state.lockedUntil.getTime() >= now.getTime()) return false;
    this.states.set(name, { ...state, lockedBy: owner, lockedUntil: new Date(now.getTime() + leaseMs), runningSince: now });
    return true;
  }

  async release(name: string, owner: string, result: JobRunResult): Promise<void> {
    const state = this.states.get(name);
    if (!state || state.lockedBy !== owner) return;
    this.states.set(name, {
      ...state,
      lockedBy: null,
      lockedUntil: null,
      runningSince: null,
      lastStartedAt: result.startedAt,
      lastFinishedAt: result.finishedAt,
      lastStatus: result.status,
      lastSummary: { ...result.summary },
      lastError: result.error?.slice(0, MAX_STORED_ERROR_LENGTH) ?? null,
      consecutiveFailures: result.status === 'success' ? 0 : state.consecutiveFailures + 1,
    });
  }

  // Testhilfe: Zustand direkt setzen (z. B. "letzter Lauf vor 30 Stunden").
  seed(state: Partial<JobStateRecord> & { name: string }): void {
    this.states.set(state.name, { ...emptyState(state.name), ...state });
  }
}
