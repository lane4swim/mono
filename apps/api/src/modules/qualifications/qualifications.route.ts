// Endpunkte für das Qualifikationsmanagement (docs/nutzer-qualifikationen-
// plan.md). Läuft NICHT über die generische Sync-API (POST /api/sync/push/
// pull) — UserQualification ist kein Sync-Store (siehe Plan, Abschnitt
// 1.1). Die Modul-Buchung eines Vereins (`enabledModules`, siehe
// packages/shared-types/src/modules.ts: MODULE_PACKAGES.qualifications)
// wird deshalb hier selbst durchgesetzt — über das gemeinsame Modul-Gate
// (plugins/clubModules.ts: requireClubModule()), nicht über
// sync.permissions.ts: canRead()/canWrite().
import type { FastifyInstance } from 'fastify';
import {
  CreateUserQualificationRequestSchema,
  UpdateUserQualificationRequestSchema,
  UpdateQualificationReminderSettingRequestSchema,
  QualificationTypeSchema,
  DEFAULT_QUALIFICATION_REMINDER_THRESHOLDS_DAYS,
} from '@lane1/shared-types';
import type { QualificationsService } from './qualifications.service.js';
import { requireAnyRole } from '../../plugins/authorize.js';
import { parseInput } from '../../plugins/parseInput.js';
import { requesterFrom } from '../../plugins/requester.js';
import { requireClubModule, type ClubModulesResolver } from '../../plugins/clubModules.js';

export interface QualificationsRoutesOptions {
  qualificationsService: QualificationsService;
  // Gebuchte Module des Vereins, siehe plugins/clubModules.ts.
  clubModules: ClubModulesResolver;
}

export async function qualificationsRoutes(app: FastifyInstance, opts: QualificationsRoutesOptions) {
  const { qualificationsService, clubModules } = opts;

  const requireQualificationsModule = requireClubModule(clubModules, 'qualifications', 'Das Qualifikationsmanagement ist für diesen Verein nicht gebucht.');

  // Eigene, schreibgeschützte Ansicht — jede Rolle außer superadmin.
  // `referee` ist Teil davon, weil die Kampfrichter-Seite (kampfrichter.js)
  // GET /api/qualification-settings mitnutzt, um ihre eigenen
  // Erinnerungs-Schwellen anzuzeigen (siehe Issue #54).
  const selfGuard = [app.authenticate, requireAnyRole('admin', 'trainer', 'athlete', 'referee'), requireQualificationsModule];
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
