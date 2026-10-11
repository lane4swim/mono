// Statusanzeige der Hintergrundjobs (docs/future-features-brainstorm.md,
// 6.4): ausführlich für die Superadmin-Ansicht (GET /api/admin/jobs), auf
// ein einziges Wort verdichtet für den öffentlichen /health-Endpunkt.
import type { JobStateRepository, JobRunStatus } from '../../jobs/scheduler/jobState.repository.js';
import { JOB_NAMES, JOB_SCHEDULES, isStale, nextDueAt, type JobSchedule } from '../../jobs/scheduler/schedule.js';

export interface JobStatus {
  name: string;
  schedule: JobSchedule;
  // Läuft gerade (gültige Lease). Ein abgestürzter Lauf hinterlässt
  // runningSince mit abgelaufener Lease — dann false, und der Scheduler
  // holt den Lauf nach.
  running: boolean;
  runningSince: string | null;
  lastStartedAt: string | null;
  lastFinishedAt: string | null;
  lastStatus: JobRunStatus | null;
  lastSummary: Record<string, number>;
  lastError: string | null;
  consecutiveFailures: number;
  nextDueAt: string;
  stale: boolean;
}

export interface JobsOverview {
  schedulerEnabled: boolean;
  jobs: JobStatus[];
}

// "unknown": Zustand nicht lesbar (z. B. Datenbank nicht erreichbar).
export type JobsHealth = 'ok' | 'stale' | 'unknown';

export interface JobsStatusService {
  overview(): Promise<JobsOverview>;
  health(): Promise<JobsHealth>;
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

export function createJobsStatusService(deps: { state: JobStateRepository; schedulerEnabled: boolean; clock?: () => Date }): JobsStatusService {
  const clock = deps.clock ?? (() => new Date());

  async function overview(): Promise<JobsOverview> {
    const now = clock();
    const states = new Map((await deps.state.list()).map((s) => [s.name, s]));
    const jobs = JOB_NAMES.map((name): JobStatus => {
      const schedule = JOB_SCHEDULES[name];
      const state = states.get(name);
      const running = !!(state?.runningSince && state.lockedUntil && state.lockedUntil.getTime() > now.getTime());
      return {
        name,
        schedule,
        running,
        runningSince: iso(state?.runningSince ?? null),
        lastStartedAt: iso(state?.lastStartedAt ?? null),
        lastFinishedAt: iso(state?.lastFinishedAt ?? null),
        lastStatus: state?.lastStatus ?? null,
        lastSummary: state?.lastSummary ?? {},
        lastError: state?.lastError ?? null,
        consecutiveFailures: state?.consecutiveFailures ?? 0,
        nextDueAt: nextDueAt(schedule, state?.lastStartedAt ?? null, now).toISOString(),
        stale: isStale(schedule, state, now),
      };
    });
    return { schedulerEnabled: deps.schedulerEnabled, jobs };
  }

  return {
    overview,
    async health() {
      try {
        const { jobs } = await overview();
        return jobs.some((j) => j.stale) ? 'stale' : 'ok';
      } catch {
        return 'unknown';
      }
    },
  };
}
