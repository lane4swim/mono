// Endpunkte für die Wettkampfeinsätze von Kampfrichter:innen (docs/
// kampfrichter-modul-plan.md, Abschnitt 5). Läuft NICHT über die
// generische Sync-API (POST /api/sync/push/pull) — RefereeAssignment ist
// kein Sync-Store (siehe Plan, Abschnitt 5.1). Die Modul-Buchung eines
// Vereins (`enabledModules`, siehe packages/shared-types/src/modules.ts:
// MODULE_PACKAGES.kampfrichter) wird deshalb hier selbst durchgesetzt,
// über das gemeinsame Modul-Gate (plugins/clubModules.ts:
// requireClubModule()).
import type { FastifyInstance } from 'fastify';
import { CreateRefereeAssignmentRequestSchema, UpdateRefereeAssignmentRequestSchema, RespondRefereeAssignmentRequestSchema } from '@lane1/shared-types';
import type { RefereesService } from './referees.service.js';
import { requireAnyRole } from '../../plugins/authorize.js';
import { parseInput } from '../../plugins/parseInput.js';
import { requesterFrom } from '../../plugins/requester.js';
import { requireClubModule, type ClubModulesResolver } from '../../plugins/clubModules.js';

export interface RefereesRoutesOptions {
  refereesService: RefereesService;
  // Gebuchte Module des Vereins, siehe plugins/clubModules.ts.
  clubModules: ClubModulesResolver;
}

function toCreateInput(body: {
  competitionName: string;
  competitionPlace: string;
  competitionId?: string | null;
  date: string;
  function: string;
  note: string;
}) {
  return {
    competitionName: body.competitionName,
    competitionPlace: body.competitionPlace,
    competitionId: body.competitionId ?? null,
    date: new Date(body.date),
    function: body.function,
    note: body.note,
  };
}

function toUpdateInput(body: {
  competitionName?: string;
  competitionPlace?: string;
  competitionId?: string | null;
  date?: string;
  function?: string;
  note?: string;
}) {
  return {
    competitionName: body.competitionName,
    competitionPlace: body.competitionPlace,
    // `!== undefined` statt `?? undefined`: `competitionId: null`
    // (Verknüpfung bewusst entfernen) muss vom Feld-Weglassen (unverändert
    // lassen) unterscheidbar bleiben — analog UpdateUserQualificationInput
    // in qualifications.route.ts.
    competitionId: body.competitionId === undefined ? undefined : body.competitionId,
    date: body.date ? new Date(body.date) : undefined,
    function: body.function,
    note: body.note,
  };
}

export async function refereesRoutes(app: FastifyInstance, opts: RefereesRoutesOptions) {
  const { refereesService, clubModules } = opts;

  const requireKampfrichterModule = requireClubModule(clubModules, 'kampfrichter', 'Das Kampfrichter-Modul ist für diesen Verein nicht gebucht.');

  // Selbstverwaltung — ausschließlich referee (Plan Abschnitt 5.5).
  const selfGuard = [app.authenticate, requireAnyRole('referee'), requireKampfrichterModule];
  // Verwaltung im Namen einer Kampfrichter:in — ausschließlich admin.
  const adminGuard = [app.authenticate, requireAnyRole('admin'), requireKampfrichterModule];

  app.get('/api/me/referee-assignments', { preHandler: selfGuard }, async (request, reply) => {
    const assignments = await refereesService.listOwn(requesterFrom(request));
    return reply.code(200).send({ assignments });
  });

  app.post('/api/me/referee-assignments', { preHandler: selfGuard }, async (request, reply) => {
    const body = parseInput(CreateRefereeAssignmentRequestSchema, request.body, reply);
    if (!body) return;
    const assignment = await refereesService.createOwn(toCreateInput(body), requesterFrom(request));
    return reply.code(201).send(assignment);
  });

  app.patch<{ Params: { id: string } }>(
    '/api/me/referee-assignments/:id',
    { preHandler: selfGuard },
    async (request, reply) => {
      const body = parseInput(UpdateRefereeAssignmentRequestSchema, request.body, reply);
      if (!body) return;
      const assignment = await refereesService.updateOwn(request.params.id, toUpdateInput(body), requesterFrom(request));
      return reply.code(200).send(assignment);
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/me/referee-assignments/:id/response',
    { preHandler: selfGuard },
    async (request, reply) => {
      const body = parseInput(RespondRefereeAssignmentRequestSchema, request.body, reply);
      if (!body) return;
      const assignment = await refereesService.respondOwn(request.params.id, body, requesterFrom(request));
      return reply.code(200).send(assignment);
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/me/referee-assignments/:id',
    { preHandler: selfGuard },
    async (request, reply) => {
      await refereesService.removeOwn(request.params.id, requesterFrom(request));
      return reply.code(204).send();
    },
  );

  app.get('/api/referee-assignments/upcoming', { preHandler: adminGuard }, async (request, reply) => {
    const assignments = await refereesService.listUpcomingForClub(requesterFrom(request));
    return reply.code(200).send({ assignments });
  });

  app.get<{ Params: { competitionId: string } }>(
    '/api/competitions/:competitionId/referee-assignments',
    { preHandler: adminGuard },
    async (request, reply) => {
      const assignments = await refereesService.listForCompetition(request.params.competitionId, requesterFrom(request));
      return reply.code(200).send({ assignments });
    },
  );

  app.get<{ Params: { userId: string } }>(
    '/api/users/:userId/referee-assignments',
    { preHandler: adminGuard },
    async (request, reply) => {
      const assignments = await refereesService.listForMember(request.params.userId, requesterFrom(request));
      return reply.code(200).send({ assignments });
    },
  );

  app.post<{ Params: { userId: string } }>(
    '/api/users/:userId/referee-assignments',
    { preHandler: adminGuard },
    async (request, reply) => {
      const body = parseInput(CreateRefereeAssignmentRequestSchema, request.body, reply);
      if (!body) return;
      const assignment = await refereesService.createForMember(request.params.userId, toCreateInput(body), requesterFrom(request));
      return reply.code(201).send(assignment);
    },
  );

  app.patch<{ Params: { userId: string; id: string } }>(
    '/api/users/:userId/referee-assignments/:id',
    { preHandler: adminGuard },
    async (request, reply) => {
      const body = parseInput(UpdateRefereeAssignmentRequestSchema, request.body, reply);
      if (!body) return;
      const assignment = await refereesService.updateForMember(request.params.userId, request.params.id, toUpdateInput(body), requesterFrom(request));
      return reply.code(200).send(assignment);
    },
  );

  app.delete<{ Params: { userId: string; id: string } }>(
    '/api/users/:userId/referee-assignments/:id',
    { preHandler: adminGuard },
    async (request, reply) => {
      await refereesService.removeForMember(request.params.userId, request.params.id, requesterFrom(request));
      return reply.code(204).send();
    },
  );
}
