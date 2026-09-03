// apps/api/scripts/notifyExpiringQualifications.ts
//
// Verschickt Ablauf-Erinnerungen für Qualifikationen (docs/nutzer-
// qualifikationen-plan.md, Abschnitt 5) an die betroffene Person und die
// Admins ihres Vereins. Nur relevant für Vereine, die das Modul
// 'qualifications' gebucht haben — siehe
// jobs/qualificationReminder.repository.ts.
//
// Gedacht für einen täglichen Cron-Job, z. B.:
//
//   0 4 * * * cd /pfad/zu/apps/api && npm run notify-expiring-qualifications >> /var/log/lane1-qualifications.log 2>&1
//
// (eine Stunde nach dem DSGVO-/Sync-Bookkeeping-Purge in
// scripts/purgeDeletedData.ts — beide sind unabhängig voneinander, ein
// gemeinsamer Cron-Eintrag wäre hier kein Mehrwert, da dieser Lauf einen
// E-Mail-Versand auslöst und deshalb separat protokolliert/beobachtet
// werden soll.)
//
// Nutzung manuell: npm run notify-expiring-qualifications (im Ordner apps/api)
import { PrismaClient } from '@prisma/client';
import { loadEnv } from '../src/config/env.js';
import { resolveMailer } from '../src/app.js';
import { PrismaNotifyExpiringQualificationsGateway } from '../src/jobs/qualificationReminder.repository.js';
import { notifyExpiringQualifications } from '../src/jobs/notifyExpiringQualifications.js';

async function main() {
  const env = loadEnv();
  const prisma = new PrismaClient();
  try {
    const gateway = new PrismaNotifyExpiringQualificationsGateway(prisma);
    const mailer = resolveMailer(env);
    const result = await notifyExpiringQualifications(gateway, mailer, new Date());

    console.log(`[qualifications] ${new Date().toISOString()} — ${result.remindersSent} Erinnerung(en) versendet.`);
    if (result.failed.length > 0) {
      console.error(`[qualifications] ${result.failed.length} Fehlschlag/-schläge (werden beim nächsten Lauf erneut versucht):`);
      for (const failure of result.failed) {
        console.error(`  - qualificationId ${failure.qualificationId} (Schwelle ${failure.thresholdDays} Tage): ${failure.error}`);
      }
      process.exitCode = 1;
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('[qualifications] Unerwarteter Fehler:', err);
  process.exit(1);
});
