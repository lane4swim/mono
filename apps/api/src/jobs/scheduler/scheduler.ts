// In-Process-Scheduler für die Hintergrundjobs (docs/future-features-
// brainstorm.md, 6.4) — ersetzt den bisher manuell einzurichtenden Cron.
// Wird in src/index.ts nach app.listen() gestartet (nicht in buildApp(),
// damit Tests und CLI-Skripte ihn nie ungewollt mitstarten) und über
// JOB_SCHEDULER_ENABLED abgeschaltet.
//
// Ablauf je Takt: Zustand aller Jobs in EINER Abfrage laden, für jeden
// fälligen Job die Lease holen (jobState.repository.ts) und ihn ausführen.
// Jobs laufen innerhalb eines Prozesses nacheinander; mehrere Instanzen
// (pm2-Cluster, mehrere Container) koordinieren sich allein über die Lease.
import type { JobStateRepository } from './jobState.repository.js';
import type { JobSchedule } from './schedule.js';
import { isDue } from './schedule.js';
import { runWithLease, DEFAULT_LEASE_MS, type JobRun } from './runJob.js';

export interface ScheduledJob {
  name: string;
  schedule: JobSchedule;
  run: JobRun;
}

export interface SchedulerLogger {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

export interface JobScheduler {
  start(): void;
  // Beendet den Takt und wartet auf einen gerade laufenden Durchgang.
  stop(): Promise<void>;
  // Ein einzelner Durchgang — für Tests direkt aufrufbar.
  tick(): Promise<void>;
}

export function createJobScheduler(opts: {
  jobs: ScheduledJob[];
  state: JobStateRepository;
  owner: string;
  logger: SchedulerLogger;
  tickMs: number;
  // Zufällige Verzögerung des ersten Durchgangs, damit gleichzeitig
  // gestartete Instanzen nicht im selben Moment um die Lease konkurrieren.
  initialDelayMs?: number;
  leaseMs?: number;
  clock?: () => Date;
}): JobScheduler {
  const clock = opts.clock ?? (() => new Date());
  let timer: NodeJS.Timeout | null = null;
  let started = false;
  let stopRequested = false;
  let current: Promise<void> | null = null;

  async function runDueJobs(): Promise<void> {
    let states;
    try {
      states = new Map((await opts.state.list()).map((s) => [s.name, s]));
    } catch (err) {
      opts.logger.error(`[scheduler] Jobzustand nicht lesbar, nächster Versuch im nächsten Takt: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    for (const job of opts.jobs) {
      if (stopRequested) return;
      if (!isDue(job.schedule, states.get(job.name)?.lastStartedAt ?? null, clock())) continue;
      try {
        const outcome = await runWithLease({ name: job.name, run: job.run, state: opts.state, owner: opts.owner, clock, leaseMs: opts.leaseMs ?? DEFAULT_LEASE_MS });
        if (!outcome.acquired) continue;
        const { result, failures } = outcome;
        const summary = Object.entries(result.summary).map(([k, v]) => `${k}=${v}`).join(', ');
        if (result.status === 'failed') {
          opts.logger.error(`[scheduler] ${job.name} fehlgeschlagen: ${result.error}`);
        } else {
          opts.logger.info(`[scheduler] ${job.name} abgeschlossen (${result.status})${summary ? `: ${summary}` : ''}`);
          for (const failure of failures) opts.logger.warn(`[scheduler] ${job.name}: ${failure}`);
        }
      } catch (err) {
        // Nur Fehler der Lease-Verwaltung selbst (z. B. Datenbank nicht
        // erreichbar) — Fehler des Jobs fängt runWithLease() ab.
        opts.logger.error(`[scheduler] ${job.name}: Lease-Verwaltung fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  function schedule(delayMs: number) {
    timer = setTimeout(() => {
      current = runDueJobs().finally(() => {
        current = null;
        if (started) schedule(opts.tickMs);
      });
    }, delayMs);
    // Hält den Prozess nicht allein am Leben (z. B. nach app.close()).
    timer.unref();
  }

  return {
    start() {
      if (started) return;
      started = true;
      stopRequested = false;
      schedule(opts.initialDelayMs ?? 0);
    },
    async stop() {
      started = false;
      stopRequested = true;
      if (timer) clearTimeout(timer);
      timer = null;
      await current;
    },
    tick: runDueJobs,
  };
}
