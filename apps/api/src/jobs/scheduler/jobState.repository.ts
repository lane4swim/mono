// Persistenter Zustand der Hintergrundjobs (Tabelle scheduled_job_states,
// siehe ScheduledJobState in schema.prisma): Lease gegen parallele Läufe
// und Ergebnis des letzten abgeschlossenen Laufs.
import type { PrismaClient, Prisma } from '@prisma/client';

export type JobRunStatus = 'success' | 'partial' | 'failed';

export interface JobStateRecord {
  name: string;
  lockedBy: string | null;
  lockedUntil: Date | null;
  runningSince: Date | null;
  lastStartedAt: Date | null;
  lastFinishedAt: Date | null;
  lastStatus: JobRunStatus | null;
  lastSummary: Record<string, number>;
  lastError: string | null;
  consecutiveFailures: number;
}

export interface JobRunResult {
  startedAt: Date;
  finishedAt: Date;
  status: JobRunStatus;
  summary: Record<string, number>;
  error: string | null;
}

export interface JobStateRepository {
  list(): Promise<JobStateRecord[]>;
  // true nur für genau EINEN von mehreren gleichzeitigen Aufrufern, solange
  // die Lease eines anderen Besitzers noch nicht abgelaufen ist.
  tryAcquire(name: string, owner: string, now: Date, leaseMs: number): Promise<boolean>;
  // Gibt die Lease frei und hält das Ergebnis fest — wirkungslos, falls die
  // Lease inzwischen abgelaufen und von jemand anderem übernommen wurde.
  release(name: string, owner: string, result: JobRunResult): Promise<void>;
}

// Begrenzt die gespeicherte Fehlermeldung; der volle Stack steht im Log.
export const MAX_STORED_ERROR_LENGTH = 500;

function toRecord(row: {
  name: string;
  lockedBy: string | null;
  lockedUntil: Date | null;
  runningSince: Date | null;
  lastStartedAt: Date | null;
  lastFinishedAt: Date | null;
  lastStatus: string | null;
  lastSummary: Prisma.JsonValue;
  lastError: string | null;
  consecutiveFailures: number;
}): JobStateRecord {
  const summary = row.lastSummary && typeof row.lastSummary === 'object' && !Array.isArray(row.lastSummary) ? row.lastSummary : {};
  return {
    ...row,
    lastStatus: row.lastStatus as JobRunStatus | null,
    lastSummary: Object.fromEntries(Object.entries(summary).filter(([, v]) => typeof v === 'number')) as Record<string, number>,
  };
}

export class PrismaJobStateRepository implements JobStateRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async list(): Promise<JobStateRecord[]> {
    const rows = await this.prisma.scheduledJobState.findMany({ orderBy: { name: 'asc' } });
    return rows.map(toRecord);
  }

  async tryAcquire(name: string, owner: string, now: Date, leaseMs: number): Promise<boolean> {
    // Zeile anlegen, falls der Job noch nie lief — skipDuplicates statt
    // upsert, damit zwei gleichzeitige Erstläufe nicht an der
    // Primärschlüssel-Verletzung scheitern.
    await this.prisma.scheduledJobState.createMany({ data: [{ name }], skipDuplicates: true });
    // Ein einzelnes UPDATE mit der Lease-Bedingung im WHERE: Postgres prüft
    // die Bedingung nach dem Warten auf eine konkurrierende Zeilensperre
    // erneut (READ COMMITTED), daher erhält genau ein Aufrufer count === 1.
    const { count } = await this.prisma.scheduledJobState.updateMany({
      where: { name, OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] },
      data: { lockedBy: owner, lockedUntil: new Date(now.getTime() + leaseMs), runningSince: now },
    });
    return count === 1;
  }

  async release(name: string, owner: string, result: JobRunResult): Promise<void> {
    await this.prisma.scheduledJobState.updateMany({
      where: { name, lockedBy: owner },
      data: {
        lockedBy: null,
        lockedUntil: null,
        runningSince: null,
        lastStartedAt: result.startedAt,
        lastFinishedAt: result.finishedAt,
        lastStatus: result.status,
        lastSummary: result.summary,
        lastError: result.error?.slice(0, MAX_STORED_ERROR_LENGTH) ?? null,
        consecutiveFailures: result.status === 'success' ? 0 : { increment: 1 },
      },
    });
  }
}
