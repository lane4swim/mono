// apps/api/src/modules/qualifications/qualifications.route.ts
//
// Endpunkte für das Qualifikationsmanagement (docs/nutzer-qualifikationen-
// plan.md). Läuft NICHT über die generische Sync-API (POST /api/sync/push/
// pull) — UserQualification ist kein Sync-Store (siehe Plan, Abschnitt
// 1.1). Die Modul-Buchung eines Vereins (`enabledModules`, siehe
// packages/shared-types/src/modules.ts: MODULE_PACKAGES.qualifications)
// wird deshalb hier selbst durchgesetzt, nicht über
// sync.permissions.ts: canRead()/canWrite().
import type { FastifyInstance } from 'fastify';
import {
  CreateUserQualificationRequestSchema,
  UpdateUserQualificationRequestSchema,
  UpdateQualificationReminderSettingRequestSchema,
  QualificationTypeSchema,
  DEFAULT_QUALIFICATION_REMINDER_THRESHOLDS_DAYS,
} from '@lane1/shared-types';
import type { QualificationsService, RequesterContext } from './qualifications.service.js';
import { requireAnyRole } from '../../plugins/authorize.js';
import { parseInput } from '../../plugins/parseInput.js';

// Minimale, für dieses Modul ausreichende Nachschlagemöglichkeit für die
// Modul-Pakete eines Vereins — bewusst dieselbe schlanke Form wie
// sync.route.ts: ClubModulesLookup (siehe dort), damit ein und dieselbe
// PrismaClubRepository-Instanz (app.ts) beide Stellen bedient, ohne dass
// dieses Modul von invitations/sync abhängen muss.
export interface ClubModulesLookup {
  findById(clubId: string): Promise<{ enabledModules: string[] } | null>;
}

export interface QualificationsRoutesOptions {
  qualificationsService: QualificationsService;
  clubs: ClubModulesLookup;
}

interface CachedClubModules {
  enabledModules: string[];
  expiresAt: number;
}

// Bewusst als eigene, kleine Cache-Closure dupliziert statt aus
// sync.route.ts extrahiert (siehe docs/nutzer-qualifikationen-plan.md,
// Abschnitt 1.2: "bei einem dritten Verwendungsfall lohnt sich ein
// gemeinsamer Helper") — bislang genau EIN Vorbild (sync.route.ts:
// resolveEnabledModules()), eine vorzeitige Extraktion wäre hier
// spekulative Abstraktion für einen bislang einzigen zweiten Fall.
const CLUB_MODULES_CACHE_TTL_MS = 45_000;

function requesterFrom(request: { user?: { sub: string; roles: string[]; clubId: string | null } }): RequesterContext {
  const user = request.user!;
  return { id: user.sub, roles: user.roles, clubId: user.clubId };
}

export async function qualificationsRoutes(app: FastifyInstance, opts: QualificationsRoutesOptions) {
  const { qualificationsService, clubs } = opts;

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

  // Läuft NACH requireAnyRole() (siehe *Guard unten) — request.user.roles ist an
  // dieser Stelle bereits geprüft, `superadmin` (kein eigener Verein) kommt
  // hier also nie an (Entscheidung zu Frage 5, Abschnitt 8 des Plans).
  async function requireQualificationsModule(request: { user?: { clubId: string | null } }, reply: { code: (n: number) => { send: (b: unknown) => void } }) {
    const clubId = request.user!.clubId!;
    const enabledModules = await resolveEnabledModules(clubId);
    if (!enabledModules.includes('qualifications')) {
      reply.code(403).send({
        error: 'module_not_enabled',
        message: 'Das Qualifikationsmanagement ist für diesen Verein nicht gebucht.',
      });
    }
  }

  // Eigene, schreibgeschützte Ansicht — jede Rolle außer superadmin.
  const selfGuard = [app.authenticate, requireAnyRole('admin', 'trainer', 'athlete'), requireQualificationsModule];
  // Verwaltung von Mitgliedern + Einstellungen — ausschließlich admin
  // (Entscheidung zu Frage 2, Abschnitt 8 des Plans).
  const adminGuard = [app.authenticate, requireAnyRole('admin'), requireQualificationsModule];

  app.get('/api/me/qualifications', { preHandler: selfGuard }, async (request, reply) => {
    const qualifications = await qualificationsService.listOwn(requesterFrom(request));
    return reply.code(200).send({ qualifications });
  });

  app.get<{ Params: { userId: string } }>(
    '/api/users/:userId/qualifications',
    { preHandler: adminGuard },
    async (request, reply) => {
      const qualifications = await qualificationsService.listForMember(request.params.userId, requesterFrom(request));
      return reply.code(200).send({ qualifications });
    },
  );

  app.post<{ Params: { userId: string } }>(
    '/api/users/:userId/qualifications',
    { preHandler: adminGuard },
    async (request, reply) => {
      const body = parseInput(CreateUserQualificationRequestSchema, request.body, reply);
      if (!body) return;
      const qualification = await qualificationsService.create(
        request.params.userId,
        {
          type: body.type,
          note: body.note,
          acquiredOn: new Date(body.acquiredOn),
          expiresOn: body.expiresOn ? new Date(body.expiresOn) : null,
          renewalCourseOrganizedOn: body.renewalCourseOrganizedOn ? new Date(body.renewalCourseOrganizedOn) : null,
        },
        requesterFrom(request),
      );
      return reply.code(201).send(qualification);
    },
  );

  app.patch<{ Params: { userId: string; id: string } }>(
    '/api/users/:userId/qualifications/:id',
    { preHandler: adminGuard },
    async (request, reply) => {
      const body = parseInput(UpdateUserQualificationRequestSchema, request.body, reply);
      if (!body) return;
      const qualification = await qualificationsService.update(
        request.params.userId,
        request.params.id,
        {
          type: body.type,
          note: body.note,
          acquiredOn: body.acquiredOn ? new Date(body.acquiredOn) : undefined,
          // `!== undefined` statt `?? null`/Kurzschluss: `expiresOn: null`
          // (Ablauf bewusst entfernen) muss vom Feld-Weglassen (unverändert
          // lassen) unterscheidbar bleiben — dasselbe gilt für
          // renewalCourseOrganizedOn unten.
          expiresOn: body.expiresOn === undefined ? undefined : body.expiresOn ? new Date(body.expiresOn) : null,
          renewalCourseOrganizedOn:
            body.renewalCourseOrganizedOn === undefined ? undefined : body.renewalCourseOrganizedOn ? new Date(body.renewalCourseOrganizedOn) : null,
        },
        requesterFrom(request),
      );
      return reply.code(200).send(qualification);
    },
  );

  app.delete<{ Params: { userId: string; id: string } }>(
    '/api/users/:userId/qualifications/:id',
    { preHandler: adminGuard },
    async (request, reply) => {
      await qualificationsService.remove(request.params.userId, request.params.id, requesterFrom(request));
      return reply.code(204).send();
    },
  );

  // Lesend für jede Rolle (selfGuard, nicht adminGuard) — siehe Kommentar
  // an qualifications.service.ts: listReminderSettings().
  app.get('/api/qualification-settings', { preHandler: selfGuard }, async (request, reply) => {
    const settings = await qualificationsService.listReminderSettings(requesterFrom(request));
    return reply.code(200).send({ settings, defaultThresholdsDays: DEFAULT_QUALIFICATION_REMINDER_THRESHOLDS_DAYS });
  });

  app.put<{ Params: { type: string } }>(
    '/api/qualification-settings/:type',
    { preHandler: adminGuard },
    async (request, reply) => {
      const body = parseInput(UpdateQualificationReminderSettingRequestSchema, request.body, reply);
      if (!body) return;
      const type = parseInput(QualificationTypeSchema, request.params.type, reply);
      if (!type) return;
      const setting = await qualificationsService.setReminderSetting(type, body.thresholdsDays, requesterFrom(request));
      return reply.code(200).send(setting);
    },
  );
}
