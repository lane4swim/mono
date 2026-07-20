// apps/api/src/jobs/purgeExpiredDeletions.ts
//
// Orchestrierung des zeitversetzten Hard-Purge (Art. 17 DSGVO): findet
// alle Löschanfragen, deren Aufbewahrungsfrist abgelaufen ist, und löscht
// die zugehörigen Daten unwiderruflich. Wird von scripts/purgeDeletedData.ts
// per Cron ausgeführt — siehe README für die Cron-Einrichtung.
//
// Absichtlich als reine Orchestrierungsfunktion (kein eigener DB-Zugriff)
// gehalten, damit sie ohne Datenbank testbar ist (siehe
// test/jobs/purgeExpiredDeletions.test.ts).
import type { ErasureJobGateway } from './erasure.repository.js';

export interface PurgeResult {
  processed: number;
  failed: Array<{ userId: string; error: string }>;
}

export async function purgeExpiredDeletions(gateway: ErasureJobGateway, now: Date = new Date()): Promise<PurgeResult> {
  const due = await gateway.findDuePendingRequests(now);
  const result: PurgeResult = { processed: 0, failed: [] };

  for (const request of due) {
    try {
      await gateway.purgeUserAndDependents(request.userId);
      result.processed += 1;
    } catch (err) {
      // Ein einzelner Fehlschlag (z. B. vorübergehendes DB-Problem) soll
      // nicht den gesamten Lauf abbrechen — der nächste Cron-Durchlauf
      // versucht es erneut, da die Anfrage "pending" bleibt.
      result.failed.push({ userId: request.userId, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return result;
}
