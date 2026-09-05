// apps/api/src/modules/referees/referees.route.ts
//
// Endpunkte für die Wettkampfeinsätze von Kampfrichter:innen (docs/
// kampfrichter-modul-plan.md, Abschnitt 5). Läuft NICHT über die
// generische Sync-API (POST /api/sync/push/pull) — RefereeAssignment ist
// kein Sync-Store (siehe Plan, Abschnitt 5.1). Die Modul-Buchung eines
// Vereins (`enabledModules`, siehe packages/shared-types/src/modules.ts:
// MODULE_PACKAGES.kampfrichter) wird deshalb hier selbst durchgesetzt,
// analog qualifications.route.ts (direktes Vorbild für den
// Modul-Gate-Cache unten).
import type { FastifyInstance } from 'fastify';
import { CreateRefereeAssignmentRequestSchema, UpdateRefereeAssignmentRequestSchema } from '@lane1/shared-types';
import type { RefereesService, RequesterContext } from './referees.service.js';
import { requireAnyRole } from '../../plugins/authorize.js';
import { parseInput } from '../../plugins/parseInput.js';

// Minimale, für dieses Modul ausreichende Nachschlagemöglichkeit für die
// Modul-Pakete eines Vereins — bewusst dieselbe schlanke Form wie
// qualifications.route.ts: ClubModulesLookup, damit dieselbe
// PrismaClubRepository-Instanz (app.ts) alle drei Stellen bedient.
export interface ClubModulesLookup {
  findById(clubId: string): Promise<{ enabledModules: string[] } | null>;
}

export interface RefereesRoutesOptions {
  refereesService: RefereesService;
  clubs: ClubModulesLookup;
}

interface CachedClubModules {
  enabledModules: string[];
  expiresAt: number;
}

// Bewusst als eigene, kleine Cache-Closure dupliziert statt aus
// sync.route.ts/qualifications.route.ts extrahiert — siehe deren
// jeweilige Begründung ("bei einem dritten Verwendungsfall lohnt sich ein
// gemeinsamer Helper"): dies ist bereits der dritte Verwendungsfall, aber
// eine nachträgliche Extraktion ist bewusst nicht Teil dieses Plans, um
// den Umfang nicht über das Kampfrichter-Modul hinaus auszuweiten.
const CLUB_MODULES_CACHE_TTL_MS = 45_000;

function requesterFrom(request: { user?: { sub: string; roles: string[]; clubId: string | null } }): RequesterContext {
  const user = request.user!;
  return { id: user.sub, roles: user.roles, clubId: user.clubId };
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
  const { refereesService, clubs } = opts;

  const clubModulesCache = new Map<string, CachedClubModules>();
  const sweepInterval = setInterval(() => {
    const now = Date.now();
    for (const [clubId, entry] of clubModulesCache) {
      if (entry.expiresAt <= now) clubModulesCache.delete(clubId);
    }
  }, CLUB_MODULES_CACHE_TTL_MS);
  sweepInterval.unref?.();
  app.addHook('onClose', () => clearInterval(sweepInterval));

  async function resolveEnabledModules(clubId: string): Promise<string[]> {
    const now = Date.now();
    const cached = clubModulesCache.get(clubId);
    if (cached && cached.expiresAt > now) return cached.enabledModules;
    const club = await clubs.findById(clubId);
    const enabledModules = club?.enabledModules ?? [];
    clubModulesCache.set(clubId, { enabledModules, expiresAt: now + CLUB_MODULES_CACHE_TTL_MS });
    return enabledModules;
  }

  // Läuft NACH requireAnyRole() (siehe *Guard unten) — request.user.roles
  // ist an dieser Stelle bereits geprüft, `superadmin` (kein eigener
  // Verein) kommt hier also nie an.
  async function requireKampfrichterModule(request: { user?: { clubId: string | null } }, reply: { code: (n: number) => { send: (b: unknown) => void } }) {
    const clubId = request.user!.clubId!;
    const enabledModules = await resolveEnabledModules(clubId);
    if (!enabledModules.includes('kampfrichter')) {
      reply.code(403).send({
        error: 'module_not_enabled',
        message: 'Das Kampfrichter-Modul ist für diesen Verein nicht gebucht.',
      });
    }
  }

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

  app.delete<{ Params: { id: string } }>(
    '/api/me/referee-assignments/:id',
    { preHandler: selfGuard },
    async (request, reply) => {
      await refereesService.removeOwn(request.params.id, requesterFrom(request));
      return reply.code(204).send();
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
