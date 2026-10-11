import { loadEnv } from './config/env.js';
import { buildApp } from './app.js';
import { getPrisma } from './db/prisma.js';
import { createJobScheduler } from './jobs/scheduler/scheduler.js';
import { buildScheduledJobs } from './jobs/scheduler/jobDefinitions.js';
import { PrismaJobStateRepository } from './jobs/scheduler/jobState.repository.js';
import { newLeaseOwner } from './jobs/scheduler/runJob.js';

// Obergrenze der zufälligen Startverzögerung des Schedulers — siehe
// initialDelayMs in jobs/scheduler/scheduler.ts.
const SCHEDULER_MAX_INITIAL_DELAY_MS = 30_000;

async function main() {
  const env = loadEnv();
  const app = await buildApp(env);

  // Integrierter Job-Scheduler (docs/future-features-brainstorm.md, 6.4).
  // Vor listen() angelegt, weil Fastify danach keine Hooks mehr annimmt;
  // gestartet erst nach erfolgreichem listen(), damit ein Startfehler keine
  // Jobs mehr anstößt.
  const scheduler = env.JOB_SCHEDULER_ENABLED
    ? createJobScheduler({
        jobs: buildScheduledJobs({ prisma: getPrisma(), env }),
        state: new PrismaJobStateRepository(getPrisma()),
        owner: newLeaseOwner(),
        logger: app.log,
        tickMs: env.JOB_SCHEDULER_TICK_SECONDS * 1000,
        initialDelayMs: Math.floor(Math.random() * SCHEDULER_MAX_INITIAL_DELAY_MS),
      })
    : null;
  if (scheduler) app.addHook('onClose', () => scheduler.stop());

  try {
    // Sicherheitsreview 2026-08-27, Befund N7 — siehe HOST-Kommentar in
    // config/env.ts. War zuvor fest auf '0.0.0.0' verdrahtet.
    await app.listen({ host: env.HOST, port: env.PORT });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }

  if (scheduler) {
    scheduler.start();
    app.log.info('[scheduler] Integrierter Job-Scheduler gestartet');
  } else {
    app.log.info('[scheduler] JOB_SCHEDULER_ENABLED=false — Hintergrundjobs laufen nur per Cron/CLI');
  }
}

main();
