// Löscht Audit-Log-Einträge nach Ablauf der Aufbewahrungsfrist (Issue #96,
// AUDIT_LOG_RETENTION_DAYS). Läuft im selben täglichen Cron-Lauf wie der
// DSGVO-Hard-Purge (scripts/purgeDeletedData.ts). Reine Orchestrierung ohne
// eigenen DB-Zugriff, analog jobs/purgeSyncBookkeeping.ts.
import type { AuditLogRepository } from '../modules/auditLog/auditLog.repository.js';

export async function purgeAuditLog(
  entries: Pick<AuditLogRepository, 'deleteOlderThan'>,
  retentionDays: number,
  now: Date = new Date(),
): Promise<number> {
  const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
  return entries.deleteOlderThan(cutoff);
}
