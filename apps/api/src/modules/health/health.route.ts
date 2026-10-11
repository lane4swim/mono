// Einfacher Health-Check-Endpunkt — zentral für Deployment (Schritt 11 der
// Hetzner-Anleitung: "Testen") und für automatisiertes Monitoring später.
import type { FastifyInstance } from 'fastify';
import type { JobsStatusService } from '../jobs/jobs.service.js';

export interface HealthRoutesOptions {
  jobsStatusService: JobsStatusService;
}

export async function healthRoutes(app: FastifyInstance, opts: HealthRoutesOptions) {
  app.get('/health', async () => {
    // `jobs` bewusst nur als ein Wort ("ok" | "stale" | "unknown"): der
    // Endpunkt ist unauthentifiziert, Details zeigt GET /api/admin/jobs.
    // Ein Uptime-Monitor kann damit auf ausbleibende DSGVO-Purges oder
    // Erinnerungen alarmieren; "status" bleibt unabhängig davon "ok", da die
    // API selbst erreichbar ist.
    return { status: 'ok', uptimeSeconds: Math.round(process.uptime()), jobs: await opts.jobsStatusService.health() };
  });
}
