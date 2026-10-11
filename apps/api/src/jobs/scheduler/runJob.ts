// Ein einzelner Joblauf unter Lease — gemeinsam genutzt vom Scheduler
// (scheduler.ts) und den CLI-Skripten (cli.ts), damit ein manueller oder per
// Cron gestarteter Lauf dieselbe Sperre respektiert und in der
// Statusanzeige erscheint.
import { hostname } from 'node:os';
import { randomBytes } from 'node:crypto';
import type { JobRunResult, JobRunStatus, JobStateRepository } from './jobState.repository.js';

export interface JobOutcome {
  // Nur Zähler — landen in ScheduledJobState.lastSummary.
  summary: Record<string, number>;
  // Einzelfehler mit Details (z. B. Konto-IDs): nur fürs Log, nie
  // gespeichert. Nicht leer -> Status "partial".
  failures: string[];
}

export type JobRun = (now: Date) => Promise<JobOutcome>;

// Großzügig über der längsten erwarteten Laufzeit: läuft ein Job länger,
// könnte eine zweite Instanz ihn parallel starten. Die Jobs sind dafür
// abgesichert (Erinnerungs-Logs, "pending"-Löschanfragen), die Lease soll
// das aber nicht zum Normalfall machen.
export const DEFAULT_LEASE_MS = 60 * 60 * 1000;

export function newLeaseOwner(prefix = 'api'): string {
  return `${prefix}:${hostname()}:${process.pid}:${randomBytes(4).toString('hex')}`;
}

export type RunWithLeaseResult =
  | { acquired: false }
  | { acquired: true; result: JobRunResult; failures: string[] };

export async function runWithLease(opts: {
  name: string;
  run: JobRun;
  state: JobStateRepository;
  owner: string;
  clock?: () => Date;
  leaseMs?: number;
}): Promise<RunWithLeaseResult> {
  const clock = opts.clock ?? (() => new Date());
  const startedAt = clock();
  if (!(await opts.state.tryAcquire(opts.name, opts.owner, startedAt, opts.leaseMs ?? DEFAULT_LEASE_MS))) return { acquired: false };

  let status: JobRunStatus;
  let summary: Record<string, number> = {};
  let failures: string[] = [];
  let error: string | null = null;
  try {
    const outcome = await opts.run(startedAt);
    summary = outcome.summary;
    failures = outcome.failures;
    status = failures.length > 0 ? 'partial' : 'success';
  } catch (err) {
    status = 'failed';
    error = err instanceof Error ? err.message : String(err);
  }

  const result: JobRunResult = { startedAt, finishedAt: clock(), status, summary, error };
  await opts.state.release(opts.name, opts.owner, result);
  return { acquired: true, result, failures };
}
