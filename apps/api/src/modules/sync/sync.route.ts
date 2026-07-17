// apps/api/src/modules/sync/sync.route.ts
//
// Phase 3: echte Implementierung (ersetzt den Phase-0/1-501-Platzhalter).
// Siehe Abschnitt 6 des Backend-Entwicklungsplans für den Gesamtfluss.
// Nur eingeloggte Vereinsmitglieder (trainer/admin/athlete) dürfen
// synchronisieren — Superadmin hat keinen eigenen Verein und wird über
// requireRole ausgeschlossen.
import type { FastifyInstance } from 'fastify';
import { SyncPushRequestSchema } from '@lane1/shared-types';
import type { SyncService } from './sync.service.js';
import { requireRole } from '../../plugins/authorize.js';

export interface SyncRoutesOptions {
  syncService: SyncService;
}

export async function syncRoutes(app: FastifyInstance, opts: SyncRoutesOptions) {
  const { syncService } = opts;
  const syncGuard = [app.authenticate, requireRole('trainer', 'admin', 'athlete')];

  app.post('/api/sync/push', { preHandler: syncGuard }, async (request, reply) => {
    const parsed = SyncPushRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'validation_failed', issues: parsed.error.issues });
    }
    // requireRole hat bereits sichergestellt, dass die Rolle stimmt; eine
    // Rolle ohne Verein (theoretisch nur superadmin) kommt hier also nicht
    // an — clubId ist an dieser Stelle immer gesetzt.
    const clubId = request.user!.clubId!;
    const results = await syncService.push(parsed.data.events, { clubId });
    return reply.code(200).send({ results });
  });

  app.get<{ Querystring: { since?: string; cursor?: string } }>(
    '/api/sync/pull',
    { preHandler: syncGuard },
    async (request, reply) => {
      const clubId = request.user!.clubId!;
      const result = await syncService.pull(request.query, { clubId });
      return reply.code(200).send(result);
    },
  );
}
