// Endpunkte für die rechtlichen Vereinsangaben (Impressum § 5 DDG +
// Datenschutzhinweis Art. 13 DSGVO), siehe clubLegalInfo.service.ts für
// die Zugriffsmatrix und docs/Plans/club-legal-info-plan.md für den
// fachlichen Hintergrund.
import type { FastifyInstance } from 'fastify';
import { UpdateClubLegalInfoRequestSchema } from '@lane1/shared-types';
import type { ClubLegalInfoService, RequesterContext } from './clubLegalInfo.service.js';
import { requireAnyRole } from '../../plugins/authorize.js';
import { parseInput } from '../../plugins/parseInput.js';

export interface ClubLegalInfoRoutesOptions {
  clubLegalInfoService: ClubLegalInfoService;
}

function requesterFrom(request: { user?: { roles: string[]; clubId: string | null } }): RequesterContext {
  const user = request.user!;
  return { roles: user.roles, clubId: user.clubId };
}

export async function clubLegalInfoRoutes(app: FastifyInstance, opts: ClubLegalInfoRoutesOptions) {
  const { clubLegalInfoService } = opts;

  // Nur `app.authenticate` als preHandler (kein requireAnyRole) — anders
  // als die meisten übrigen /api/clubs/:id/*-Endpunkte MUSS dieser für
  // JEDE Rolle erreichbar sein (der Rechtstext wird für alle Mitglieder
  // angezeigt, siehe info.js), die Verein-Scoping-Prüfung übernimmt
  // stattdessen clubLegalInfoService.get() (ForbiddenError/ClubNotFoundError
  // über die zentrale Fehler-Registry, siehe plugins/httpErrorHandler.ts).
  app.get<{ Params: { id: string } }>(
    '/api/clubs/:id/legal-info',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const legalInfo = await clubLegalInfoService.get(request.params.id, requesterFrom(request));
      return reply.code(200).send({ legalInfo });
    },
  );

  app.patch<{ Params: { id: string } }>(
    '/api/clubs/:id/legal-info',
    { preHandler: [app.authenticate, requireAnyRole('admin', 'superadmin')] },
    async (request, reply) => {
      const body = parseInput(UpdateClubLegalInfoRequestSchema, request.body, reply);
      if (!body) return;

      const legalInfo = await clubLegalInfoService.update(request.params.id, body, requesterFrom(request));
      return reply.code(200).send({ legalInfo });
    },
  );
}
