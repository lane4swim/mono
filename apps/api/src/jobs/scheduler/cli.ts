// Gemeinsamer Einstieg der CLI-Skripte (scripts/purgeDeletedData.ts u. a.):
// führt genau einen Job sofort aus — unabhängig von seiner Fälligkeit, aber
// unter derselben Lease wie der Scheduler. Ein weiterhin eingerichteter
// Cronjob läuft dadurch nie parallel zum Scheduler und erscheint in der
// Statusanzeige.
import { PrismaClient } from '@prisma/client';
import { loadEnv } from '../../config/env.js';
import { PrismaJobStateRepository } from './jobState.repository.js';
import { buildScheduledJobs } from './jobDefinitions.js';
import { runWithLease, newLeaseOwner } from './runJob.js';
import type { JobName } from './schedule.js';

export async function runJobFromCli(name: JobName, logPrefix: string): Promise<void> {
  const env = loadEnv();
  const prisma = new PrismaClient();
  try {
    const job = buildScheduledJobs({ prisma, env }).find((j) => j.name === name)!;
    const outcome = await runWithLease({ name, run: job.run, state: new PrismaJobStateRepository(prisma), owner: newLeaseOwner('cli') });
    if (!outcome.acquired) {
      console.log(`[${logPrefix}] ${new Date().toISOString()} — läuft bereits (Scheduler oder anderer Aufruf), übersprungen.`);
      return;
    }
    const { result, failures } = outcome;
    if (result.status === 'failed') {
      console.error(`[${logPrefix}] Unerwarteter Fehler: ${result.error}`);
      process.exitCode = 1;
      return;
    }
    const summary = Object.entries(result.summary).map(([k, v]) => `${k}=${v}`).join(', ');
    console.log(`[${logPrefix}] ${result.finishedAt.toISOString()} — abgeschlossen: ${summary}`);
    if (failures.length > 0) {
      console.error(`[${logPrefix}] ${failures.length} Fehlschlag/-schläge:`);
      for (const failure of failures) console.error(`  - ${failure}`);
      process.exitCode = 1;
    }
  } finally {
    await prisma.$disconnect();
  }
}
