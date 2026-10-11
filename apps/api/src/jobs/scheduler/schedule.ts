// Katalog der Hintergrundjobs und ihre Fälligkeitsregeln — bewusst ohne
// Abhängigkeiten (kein Prisma, kein app.ts), damit sowohl der Scheduler als
// auch die Statusroute (modules/jobs) ihn importieren können, ohne einen
// Importzyklus über app.ts zu erzeugen. Die eigentlichen Job-Funktionen
// verdrahtet jobDefinitions.ts.
//
// Keine Cron-Ausdrücke: der Scheduler prüft in einem festen Takt, ob ein Job
// fällig ist. Ein verpasster Termin (Server aus, Neustart) wird dadurch beim
// nächsten Takt nachgeholt statt bis zum Folgetag auszufallen.
import type { JobStateRecord } from './jobState.repository.js';

export type JobSchedule =
  // Einmal täglich, frühestens zur angegebenen UTC-Stunde.
  | { kind: 'daily'; hourUtc: number }
  // Alle `hours` Stunden, gemessen ab dem Beginn des letzten Laufs.
  | { kind: 'interval'; hours: number };

export const JOB_NAMES = ['purge-deleted-data', 'notify-expiring-qualifications', 'notify-upcoming-sessions'] as const;
export type JobName = (typeof JOB_NAMES)[number];

// Gleiche Kadenz und Reihenfolge wie die bisher dokumentierten Cronjobs
// (docs/deployment/*.md, Abschnitt 12): Purge nachts, Qualifikations-
// Erinnerungen eine Stunde danach, Trainings-Erinnerungen alle 6 Stunden —
// notifyUpcomingSessions.ts: UPCOMING_SESSION_REMINDER_HOURS (20) setzt
// einen Takt deutlich unter einem Tag voraus.
export const JOB_SCHEDULES: Record<JobName, JobSchedule> = {
  'purge-deleted-data': { kind: 'daily', hourUtc: 2 },
  'notify-expiring-qualifications': { kind: 'daily', hourUtc: 3 },
  'notify-upcoming-sessions': { kind: 'interval', hours: 6 },
};

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

// Ab so vielen Fehlschlägen in Folge gilt ein Job als auffällig, auch wenn
// er weiterhin pünktlich läuft.
export const STALE_AFTER_CONSECUTIVE_FAILURES = 3;

export function periodMs(schedule: JobSchedule): number {
  return schedule.kind === 'daily' ? DAY_MS : schedule.hours * HOUR_MS;
}

// Letzter Tagestermin (UTC) zum Zeitpunkt `now`, also heute zur Zielstunde
// oder — falls die noch nicht erreicht ist — gestern.
function latestDailySlot(hourUtc: number, now: Date): Date {
  const slot = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hourUtc));
  return slot.getTime() > now.getTime() ? new Date(slot.getTime() - DAY_MS) : slot;
}

export function isDue(schedule: JobSchedule, lastStartedAt: Date | null, now: Date): boolean {
  if (!lastStartedAt) return true;
  if (schedule.kind === 'daily') return lastStartedAt.getTime() < latestDailySlot(schedule.hourUtc, now).getTime();
  return now.getTime() - lastStartedAt.getTime() >= periodMs(schedule);
}

export function nextDueAt(schedule: JobSchedule, lastStartedAt: Date | null, now: Date): Date {
  if (isDue(schedule, lastStartedAt, now)) return now;
  if (schedule.kind === 'daily') return new Date(latestDailySlot(schedule.hourUtc, now).getTime() + DAY_MS);
  return new Date(lastStartedAt!.getTime() + periodMs(schedule));
}

// "Auffällig": seit mehr als zwei Perioden kein abgeschlossener Lauf, oder
// wiederholt fehlgeschlagen. Ein Job, der noch nie lief, gilt nicht als
// auffällig — direkt nach einer Neuinstallation ist das der Normalfall; die
// Statusanzeige weist ihn trotzdem gesondert aus.
export function isStale(schedule: JobSchedule, state: Pick<JobStateRecord, 'lastStartedAt' | 'consecutiveFailures'> | undefined, now: Date): boolean {
  if (!state) return false;
  if (state.consecutiveFailures >= STALE_AFTER_CONSECUTIVE_FAILURES) return true;
  return state.lastStartedAt !== null && now.getTime() - state.lastStartedAt.getTime() > 2 * periodMs(schedule);
}
