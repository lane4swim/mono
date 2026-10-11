// Führt den Job "notify-upcoming-sessions" sofort aus: Push-Erinnerungen an
// bevorstehende Trainingseinheiten (Phase 2, Abschnitt 1.5.2 — docs/Plans/
// phase2-plan.md). Nur relevant für Vereine mit dem Modul 'sessions'.
//
// Im Normalbetrieb übernimmt das der integrierte Scheduler der API
// (src/jobs/scheduler/, JOB_SCHEDULER_ENABLED) — ein Cronjob ist nicht mehr
// nötig. Dieses Skript bleibt für manuelle Läufe und für Installationen mit
// abgeschaltetem Scheduler; es nutzt dieselbe Sperre wie der Scheduler.
//
// Nutzung manuell: npm run notify-upcoming-sessions (im Ordner apps/api)
import { runJobFromCli } from '../src/jobs/scheduler/cli.js';

runJobFromCli('notify-upcoming-sessions', 'sessions').catch((err) => {
  console.error('[sessions] Unerwarteter Fehler:', err);
  process.exit(1);
});
