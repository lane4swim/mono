// Endpunkte für den Eltern-/Erziehungsberechtigten-Zugang (Phase 2,
// Abschnitt 3.4/3.5 — docs/Plans/phase2-plan.md). Läuft NICHT über die
// generische Sync-API — "parent" hat bewusst KEINEN Sync-Zugriff (siehe
// Plan, Abschnitt 5.2): sync.route.ts' requireAnyRole('trainer', 'admin',
// 'athlete') lässt diese Rolle strukturell nicht hinein.
import type { FastifyInstance } from 'fastify';
import { CreateParentLinkRequestSchema } from '@lane1/shared-types';
import type { ParentsService, RequesterContext } from './parents.service.js';
import { requireAnyRole } from '../../plugins/authorize.js';
import { parseInput } from '../../plugins/parseInput.js';

export interface ParentsRoutesOptions {
  parentsService: ParentsService;
}

function requesterFrom(request: { user?: { sub: string; clubId: string | null } }): RequesterContext {
  const user = request.user!;
  return { userId: user.sub, clubId: user.clubId };
}

export async function parentsRoutes(app: FastifyInstance, opts: ParentsRoutesOptions) {
  const { parentsService } = opts;

  // Eigene, schreibgeschützte Übersicht — ausschließlich Rolle "parent".
  app.get('/api/parents/overview', { preHandler: [app.authenticate, requireAnyRole('parent')] }, async (request, reply) => {
    const overview = await parentsService.getOverview(requesterFrom(request));
    return reply.code(200).send(overview);
  });

  // Admin-Verwaltung der Verknüpfungen (Plan Abschnitt 3.5) — analog
  // PATCH /api/users/:userId/roles: nur admin, nie superadmin (kein
  // eigener Verein).
  const adminGuard = [app.authenticate, requireAnyRole('admin')];

  app.get<{ Params: { userId: string } }>('/api/parents/:userId/links', { preHandler: adminGuard }, async (request, reply) => {
    const links = await parentsService.listLinks(request.params.userId, requesterFrom(request));
    return reply.code(200).send({ links });
  });

  app.post<{ Params: { userId: string } }>('/api/parents/:userId/links', { preHandler: adminGuard }, async (request, reply) => {
    const body = parseInput(CreateParentLinkRequestSchema, request.body, reply);
    if (!body) return;
    await parentsService.addLink(request.params.userId, body.athleteId, requesterFrom(request));
    return reply.code(204).send();
  });

  app.delete<{ Params: { userId: string; athleteId: string } }>(
    '/api/parents/:userId/links/:athleteId',
    { preHandler: adminGuard },
    async (request, reply) => {
      await parentsService.removeLink(request.params.userId, request.params.athleteId, requesterFrom(request));
      return reply.code(204).send();
    },
  );
}
