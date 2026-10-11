// Statusanzeige der Hintergrundjobs für Superadmins (docs/future-features-
// brainstorm.md, 6.4) — rein lesend. Die Jobs betreffen die gesamte
// Instanz, nicht einen einzelnen Verein, daher nur superadmin.
import type { FastifyInstance } from 'fastify';
import type { JobsStatusService } from './jobs.service.js';
import { requireAnyRole } from '../../plugins/authorize.js';

export interface JobsRoutesOptions {
  jobsStatusService: JobsStatusService;
}

export async function jobsRoutes(app: FastifyInstance, opts: JobsRoutesOptions) {
  app.get('/api/admin/jobs', { preHandler: [app.authenticate, requireAnyRole('superadmin')] }, async (_request, reply) => {
    return reply.code(200).send(await opts.jobsStatusService.overview());
  });
}
