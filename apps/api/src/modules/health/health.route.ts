// apps/api/src/modules/health/health.route.ts
//
// Einfacher Health-Check-Endpunkt — zentral für Deployment (Schritt 11 der
// Hetzner-Anleitung: "Testen") und für automatisiertes Monitoring später.
import type { FastifyInstance } from 'fastify';

export async function healthRoutes(app: FastifyInstance) {
  app.get('/health', async () => {
    return { status: 'ok', uptimeSeconds: Math.round(process.uptime()) };
  });
}
