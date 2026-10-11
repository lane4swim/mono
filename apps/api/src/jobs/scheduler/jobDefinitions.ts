// Verdrahtung der Hintergrundjobs mit ihren Prisma-Gateways — gemeinsam für
// den Scheduler (src/index.ts) und die CLI-Skripte (scripts/*.ts über
// cli.ts). Die eigentliche Logik bleibt in den reinen
// Orchestrierungsfunktionen unter src/jobs/; hier entstehen nur Gateways,
// Mailer/Push-Sender und die Zähler für die Statusanzeige.
import type { PrismaClient } from '@prisma/client';
import type { Env } from '../../config/env.js';
import { resolveMailer, resolvePushSender } from '../../app.js';
import { PrismaErasureJobGateway } from '../erasure.repository.js';
import { purgeExpiredDeletions } from '../purgeExpiredDeletions.js';
import { PrismaSyncBookkeepingGateway } from '../syncBookkeeping.repository.js';
import { purgeSyncBookkeeping } from '../purgeSyncBookkeeping.js';
import { purgeAuditLog } from '../purgeAuditLog.js';
import { PrismaAuditLogRepository } from '../../modules/auditLog/auditLog.repository.js';
import { PrismaNotifyExpiringQualificationsGateway } from '../qualificationReminder.repository.js';
import { notifyExpiringQualifications } from '../notifyExpiringQualifications.js';
import { PrismaNotifyUpcomingSessionsGateway } from '../sessionReminder.repository.js';
import { notifyUpcomingSessions } from '../notifyUpcomingSessions.js';
import { PrismaPushSubscriptionRepository } from '../../modules/push/push.repository.js';
import { JOB_NAMES, JOB_SCHEDULES, type JobName } from './schedule.js';
import type { JobOutcome } from './runJob.js';
import type { ScheduledJob } from './scheduler.js';

export interface JobDeps {
  prisma: PrismaClient;
  env: Env;
}

// Drei voneinander unabhängige Aufräum-Läufe mit identischer täglicher
// Kadenz, daher ein gemeinsamer Job (wie zuvor ein gemeinsamer Cron-Eintrag):
//   1. Zeitversetzter Hard-Purge fälliger Löschanfragen (Art. 17 DSGVO).
//   2. Veraltete Sync-Bookkeeping-Zeilen (SyncedEvent, SyncTombstone).
//   3. Audit-Log-Einträge älter als AUDIT_LOG_RETENTION_DAYS.
async function runPurgeDeletedData({ prisma, env }: JobDeps, now: Date): Promise<JobOutcome> {
  const purge = await purgeExpiredDeletions(new PrismaErasureJobGateway(prisma), now);
  const bookkeeping = await purgeSyncBookkeeping(
    new PrismaSyncBookkeepingGateway(prisma),
    { syncedEvents: env.SYNC_EVENT_RETENTION_DAYS, syncTombstones: env.SYNC_TOMBSTONE_RETENTION_DAYS },
    now,
  );
  const deletedAuditEntries = await purgeAuditLog(new PrismaAuditLogRepository(prisma), env.AUDIT_LOG_RETENTION_DAYS, now);
  return {
    summary: {
      purgedAccounts: purge.processed,
      failedAccounts: purge.failed.length,
      deletedSyncedEvents: bookkeeping.deletedSyncedEvents,
      deletedSyncTombstones: bookkeeping.deletedSyncTombstones,
      deletedAuditEntries,
    },
    // Die Anfrage bleibt "pending" — der nächste Lauf versucht es erneut.
    failures: purge.failed.map((f) => `userId ${f.userId}: ${f.error} [wird beim nächsten Lauf erneut versucht]`),
  };
}

async function runNotifyExpiringQualifications({ prisma, env }: JobDeps, now: Date): Promise<JobOutcome> {
  // Push ist optionaler Zusatzkanal neben E-Mail — siehe
  // notifyExpiringQualifications.ts: PushDeps-Kommentar.
  const push = { pusher: resolvePushSender(env), pushSubscriptions: new PrismaPushSubscriptionRepository(prisma) };
  const result = await notifyExpiringQualifications(new PrismaNotifyExpiringQualificationsGateway(prisma), resolveMailer(env), now, push);
  return {
    summary: { remindersSent: result.remindersSent, failed: result.failed.length },
    failures: result.failed.map((f) => {
      // willRetry unterscheidet, ob der nächste Lauf das nachholt
      // (Fehlschlag bei der qualifizierten Person selbst) oder nicht (ein
      // einzelner Admin-Versand — siehe NotifyResult).
      const retryNote = f.willRetry
        ? 'wird beim nächsten Lauf erneut versucht'
        : 'wird NICHT automatisch wiederholt — Schwelle bereits als erledigt markiert';
      return `qualificationId ${f.qualificationId} (Schwelle ${f.thresholdDays} Tage): ${f.error} [${retryNote}]`;
    }),
  };
}

async function runNotifyUpcomingSessions({ prisma, env }: JobDeps, now: Date): Promise<JobOutcome> {
  const result = await notifyUpcomingSessions(
    new PrismaNotifyUpcomingSessionsGateway(prisma),
    resolvePushSender(env),
    new PrismaPushSubscriptionRepository(prisma),
    now,
  );
  return {
    summary: { remindersSent: result.remindersSent, failed: result.failed.length },
    failures: result.failed.map((f) => `sessionId ${f.sessionId}: ${f.error}`),
  };
}

const RUNNERS: Record<JobName, (deps: JobDeps, now: Date) => Promise<JobOutcome>> = {
  'purge-deleted-data': runPurgeDeletedData,
  'notify-expiring-qualifications': runNotifyExpiringQualifications,
  'notify-upcoming-sessions': runNotifyUpcomingSessions,
};

export function buildScheduledJobs(deps: JobDeps): ScheduledJob[] {
  return JOB_NAMES.map((name) => ({ name, schedule: JOB_SCHEDULES[name], run: (now: Date) => RUNNERS[name](deps, now) }));
}
