// apps/api/scripts/purgeDeletedData.ts
//
// Führt zwei voneinander unabhängige Aufräum-Läufe aus, die absichtlich in
// EINEM Skript/Cron-Eintrag statt zweien gebündelt sind (identische
// tägliche Kadenz, kein Mehrwert durch getrennte Cron-Jobs):
//   1. Zeitversetzter Hard-Purge aller fälligen Löschanfragen (Art. 17
//      DSGVO).
//   2. Entfernen veralteter Sync-Bookkeeping-Zeilen (SyncedEvent,
//      SyncTombstone — siehe jobs/syncBookkeeping.repository.ts), die
//      sonst unbegrenzt wachsen würden.
//
// Gedacht für einen täglichen Cron-Job, z. B.:
//
//   0 3 * * * cd /pfad/zu/apps/api && npm run purge-deleted-data >> /var/log/lane1-purge.log 2>&1
//
// Nutzung manuell: npm run purge-deleted-data (im Ordner apps/api)
import { PrismaClient } from '@prisma/client';
import { loadEnv } from '../src/config/env.js';
import { PrismaErasureJobGateway } from '../src/jobs/erasure.repository.js';
import { purgeExpiredDeletions } from '../src/jobs/purgeExpiredDeletions.js';
import { PrismaSyncBookkeepingGateway } from '../src/jobs/syncBookkeeping.repository.js';
import { purgeSyncBookkeeping } from '../src/jobs/purgeSyncBookkeeping.js';

async function main() {
  const env = loadEnv();
  const prisma = new PrismaClient();
  try {
    const gateway = new PrismaErasureJobGateway(prisma);
    const result = await purgeExpiredDeletions(gateway, new Date());

    console.log(`[purge] ${new Date().toISOString()} — ${result.processed} Konto(s) endgültig gelöscht.`);
    if (result.failed.length > 0) {
      console.error(`[purge] ${result.failed.length} Fehlschlag/-schläge (werden beim nächsten Lauf erneut versucht):`);
      for (const failure of result.failed) {
        console.error(`  - userId ${failure.userId}: ${failure.error}`);
      }
      process.exitCode = 1;
    }

    // Aufräumarbeit (Code-Review): läuft im selben täglichen Cron-Lauf wie
    // der DSGVO-Hard-Purge oben — kein eigener Cron-Eintrag nötig (siehe
    // jobs/syncBookkeeping.repository.ts für die Begründung der Fristen).
    const bookkeepingGateway = new PrismaSyncBookkeepingGateway(prisma);
    const bookkeepingResult = await purgeSyncBookkeeping(
      bookkeepingGateway,
      { syncedEvents: env.SYNC_EVENT_RETENTION_DAYS, syncTombstones: env.SYNC_TOMBSTONE_RETENTION_DAYS },
      new Date(),
    );
    console.log(
      `[purge] ${bookkeepingResult.deletedSyncedEvents} veraltete(s) SyncedEvent(s) und ` +
        `${bookkeepingResult.deletedSyncTombstones} veraltete(s) SyncTombstone(s) entfernt.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('[purge] Unerwarteter Fehler:', err);
  process.exit(1);
});
