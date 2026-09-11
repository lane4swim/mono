// Verschickt Push-Erinnerungen an bevorstehende Trainingseinheiten (Phase
// 2, Abschnitt 1.5.2 — docs/Plans/phase2-plan.md) an alle Athlet:innen der
// betroffenen Gruppe sowie alle trainer/admin-Konten des Vereins. Nur
// relevant für Vereine, die das Modul 'sessions' gebucht haben.
//
// Gedacht für einen Cron-Job alle paar Stunden, z. B.:
//
//   0 */6 * * * cd /pfad/zu/apps/api && npm run notify-upcoming-sessions >> /var/log/lane1-sessions.log 2>&1
//
// Nutzung manuell: npm run notify-upcoming-sessions (im Ordner apps/api)
import { PrismaClient } from '@prisma/client';
import { loadEnv } from '../src/config/env.js';
import { resolvePushSender } from '../src/app.js';
import { PrismaNotifyUpcomingSessionsGateway } from '../src/jobs/sessionReminder.repository.js';
import { notifyUpcomingSessions } from '../src/jobs/notifyUpcomingSessions.js';
import { PrismaPushSubscriptionRepository } from '../src/modules/push/push.repository.js';

async function main() {
  const env = loadEnv();
  const prisma = new PrismaClient();
  try {
    const gateway = new PrismaNotifyUpcomingSessionsGateway(prisma);
    const pusher = resolvePushSender(env);
    const pushSubscriptions = new PrismaPushSubscriptionRepository(prisma);
    const result = await notifyUpcomingSessions(gateway, pusher, pushSubscriptions, new Date());

    console.log(`[sessions] ${new Date().toISOString()} — ${result.remindersSent} Erinnerung(en) versendet.`);
    if (result.failed.length > 0) {
      console.error(`[sessions] ${result.failed.length} Fehlschlag/-schläge:`);
      for (const failure of result.failed) {
        console.error(`  - sessionId ${failure.sessionId}: ${failure.error}`);
      }
      process.exitCode = 1;
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('[sessions] Unerwarteter Fehler:', err);
  process.exit(1);
});
