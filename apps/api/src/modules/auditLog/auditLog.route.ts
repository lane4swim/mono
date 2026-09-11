// Endpunkt für die Audit-Log-Einsicht (docs/Plans/vereinsverwaltung-
// phase3-plan.md, Abschnitt 2) — ausschließlich lesend; Einträge entstehen
// ausschließlich serverintern über auditLogService.record() (siehe
// invitations.service.ts/auth.service.ts), es gibt bewusst KEINEN
// POST/PUT-Endpunkt für dieses Modul.
import type { FastifyInstance } from 'fastify';
import type { AuditLogService, RequesterContext } from './auditLog.service.js';
import { requireAnyRole } from '../../plugins/authorize.js';

export interface AuditLogRoutesOptions {
  auditLogService: AuditLogService;
}

function requesterFrom(request: { user?: { roles: string[]; clubId: string | null } }): RequesterContext {
  const user = request.user!;
  return { roles: user.roles, clubId: user.clubId };
}

export async function auditLogRoutes(app: FastifyInstance, opts: AuditLogRoutesOptions) {
  const { auditLogService } = opts;

  app.get<{ Querystring: { clubId?: string; before?: string; limit?: string } }>(
    '/api/audit-log',
    { preHandler: [app.authenticate, requireAnyRole('admin', 'superadmin')] },
    async (request, reply) => {
      const { clubId, before, limit } = request.query;
      const entries = await auditLogService.list(requesterFrom(request), {
        clubId,
        before: before ? new Date(before) : undefined,
        limit: limit ? Number(limit) : undefined,
      });
      return reply.code(200).send({ entries });
    },
  );
}
