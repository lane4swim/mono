// Endpunkt für die Audit-Log-Einsicht (docs/Plans/vereinsverwaltung-
// phase3-plan.md, Abschnitt 2) — ausschließlich lesend; Einträge entstehen
// ausschließlich serverintern über auditLogService.record() (siehe
// invitations.service.ts/auth.service.ts), es gibt bewusst KEINEN
// POST/PUT-Endpunkt für dieses Modul.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AuditLogService, RequesterContext } from './auditLog.service.js';
import { requireAnyRole } from '../../plugins/authorize.js';
import { parseInput } from '../../plugins/parseInput.js';

// Ungeprüft führten `?before=kein-datum` (Invalid Date) und `?limit=abc`
// (NaN) zu einem ungefangenen Prisma-Fehler (500) statt einer 400, und ein
// negatives `limit` hätte Prisma als "von hinten holen" gedeutet. Die
// Obergrenze (200) setzt weiterhin auditLogService.list().
const AuditLogQuerySchema = z.object({
  clubId: z.string().uuid().optional(),
  before: z.string().datetime().optional(),
  limit: z.coerce.number().int().positive().optional(),
});

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
      const query = parseInput(AuditLogQuerySchema, request.query, reply);
      if (!query) return;
      const { clubId, before, limit } = query;
      const entries = await auditLogService.list(requesterFrom(request), {
        clubId,
        before: before ? new Date(before) : undefined,
        limit,
      });
      return reply.code(200).send({ entries });
    },
  );
}
