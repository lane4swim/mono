// apps/api/src/modules/sync/sync.route.ts
//
// Phase 3: echte Implementierung (ersetzt den Phase-0/1-501-Platzhalter).
// Siehe Abschnitt 6 des Backend-Entwicklungsplans für den Gesamtfluss.
// Nur eingeloggte Vereinsmitglieder (trainer/admin/athlete) dürfen
// synchronisieren — Superadmin hat keinen eigenen Verein und wird über
// requireRole ausgeschlossen.
import type { FastifyInstance } from 'fastify';
import { SyncPushRequestSchema, SyncPullQuerySchema } from '@lane1/shared-types';
import type { SyncService, SyncRequester } from './sync.service.js';
import { requireRole } from '../../plugins/authorize.js';
import { parseInput } from '../../plugins/parseInput.js';

export interface SyncRoutesOptions {
  syncService: SyncService;
}

// requireRole hat bereits sichergestellt, dass die Rolle stimmt; eine Rolle
// ohne Verein (theoretisch nur superadmin) kommt hier also nicht an —
// clubId ist an dieser Stelle immer gesetzt. role/athleteId werden
// zusätzlich mitgegeben, damit der Service die Rollen-Scopierung für
// "athlete" anwenden kann (siehe sync.service.ts). Analog zu requesterFrom()
// in invitations.route.ts — eine Stelle statt einer Wiederholung dieses
// Objekt-Literals in push()/pull().
function requesterFrom(request: { user?: { role: SyncRequester['role']; clubId: string | null; athleteId: string | null } }): SyncRequester {
  const user = request.user!;
  return { clubId: user.clubId!, role: user.role, athleteId: user.athleteId };
}

export async function syncRoutes(app: FastifyInstance, opts: SyncRoutesOptions) {
  const { syncService } = opts;
  const syncGuard = [app.authenticate, requireRole('trainer', 'admin', 'athlete')];

  app.post('/api/sync/push', { preHandler: syncGuard }, async (request, reply) => {
    const body = parseInput(SyncPushRequestSchema, request.body, reply);
    if (!body) return;
    const results = await syncService.push(body.events, requesterFrom(request));
    return reply.code(200).send({ results });
  });

  app.get<{ Querystring: { since?: string; cursor?: string } }>(
    '/api/sync/pull',
    { preHandler: syncGuard },
    async (request, reply) => {
      // Ohne diese Prüfung erzeugte ein ungültiger "cursor"/"since"-Wert
      // (z. B. "?cursor=abc") in syncService.pull() ein `Invalid Date`,
      // das die Datenbankabfrage mit einem ungefangenen Fehler statt einer
      // regulären 400-Antwort quittierte.
      const query = parseInput(SyncPullQuerySchema, request.query, reply);
      if (!query) return;
      const result = await syncService.pull(query, requesterFrom(request));
      return reply.code(200).send(result);
    },
  );
}
