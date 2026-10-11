// Führt den Job "notify-expiring-qualifications" sofort aus: Ablauf-
// Erinnerungen für Qualifikationen (docs/nutzer-qualifikationen-plan.md,
// Abschnitt 5) an die betroffene Person und die Admins ihres Vereins. Nur
// relevant für Vereine, die das Modul 'qualifications' gebucht haben.
//
// Im Normalbetrieb übernimmt das der integrierte Scheduler der API
// (src/jobs/scheduler/, JOB_SCHEDULER_ENABLED) — ein Cronjob ist nicht mehr
// nötig. Dieses Skript bleibt für manuelle Läufe und für Installationen mit
// abgeschaltetem Scheduler; es nutzt dieselbe Sperre wie der Scheduler.
//
// Nutzung manuell: npm run notify-expiring-qualifications (im Ordner apps/api)
import { runJobFromCli } from '../src/jobs/scheduler/cli.js';

runJobFromCli('notify-expiring-qualifications', 'qualifications').catch((err) => {
  console.error('[qualifications] Unerwarteter Fehler:', err);
  process.exit(1);
});
