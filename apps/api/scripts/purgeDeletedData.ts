// Führt den täglichen Aufräum-Job "purge-deleted-data" sofort aus:
//   1. Zeitversetzter Hard-Purge aller fälligen Löschanfragen (Art. 17
//      DSGVO).
//   2. Entfernen veralteter Sync-Bookkeeping-Zeilen (SyncedEvent,
//      SyncTombstone — siehe jobs/syncBookkeeping.repository.ts).
//   3. Löschen von Audit-Log-Einträgen nach AUDIT_LOG_RETENTION_DAYS.
//
// Im Normalbetrieb übernimmt das der integrierte Scheduler der API
// (src/jobs/scheduler/, JOB_SCHEDULER_ENABLED) — ein Cronjob ist nicht mehr
// nötig. Dieses Skript bleibt für manuelle Läufe und für Installationen mit
// abgeschaltetem Scheduler; es nutzt dieselbe Sperre wie der Scheduler,
// läuft also nie parallel zu ihm.
//
// Nutzung manuell: npm run purge-deleted-data (im Ordner apps/api)
import { runJobFromCli } from '../src/jobs/scheduler/cli.js';

runJobFromCli('purge-deleted-data', 'purge').catch((err) => {
  console.error('[purge] Unerwarteter Fehler:', err);
  process.exit(1);
});
