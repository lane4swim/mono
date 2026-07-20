// apps/api/scripts/purgeDeletedData.ts
//
// Führt den zeitversetzten Hard-Purge aller fälligen Löschanfragen aus
// (Art. 17 DSGVO). Gedacht für einen täglichen Cron-Job, z. B.:
//
//   0 3 * * * cd /pfad/zu/apps/api && npm run purge-deleted-data >> /var/log/lane1-purge.log 2>&1
//
// Nutzung manuell: npm run purge-deleted-data (im Ordner apps/api)
import { PrismaClient } from '@prisma/client';
import { PrismaErasureJobGateway } from '../src/jobs/erasure.repository.js';
import { purgeExpiredDeletions } from '../src/jobs/purgeExpiredDeletions.js';

async function main() {
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
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('[purge] Unerwarteter Fehler:', err);
  process.exit(1);
});
