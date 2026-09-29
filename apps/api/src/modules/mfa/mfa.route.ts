// Endpunkte der Zwei-Faktor-Anmeldung (Issue #97). Der zweite
// Anmeldeschritt (POST /auth/login/mfa) liegt in auth.route.ts.
import type { FastifyInstance } from 'fastify';
import {
  MfaConfirmRequestSchema,
  MfaDisableRequestSchema,
  MfaRecoveryCodesRequestSchema,
  MfaResetRequestSchema,
  ClubMfaPolicyRequestSchema,
} from '@lane1/shared-types';
import type { MfaService, MfaRequester } from './mfa.service.js';
import { parseInput } from '../../plugins/parseInput.js';
import { requireAnyRole } from '../../plugins/authorize.js';
import { accessTokenRateLimitKey } from '../auth/auth.route.js';

export interface MfaRoutesOptions {
  mfaService: MfaService;
}

function requesterFrom(request: { user?: { sub: string; roles: string[]; clubId: string | null } }): MfaRequester {
  const user = request.user!;
  return { id: user.sub, roles: user.roles, clubId: user.clubId };
}

// Schreibende Aufrufe prüfen Codes oder Passwörter — wie POST /api/me/password
// je Sitzung begrenzt.
const WRITE_LIMIT = { rateLimit: { max: 10, timeWindow: '1 minute', keyGenerator: accessTokenRateLimitKey } };

export async function mfaRoutes(app: FastifyInstance, opts: MfaRoutesOptions) {
  const { mfaService } = opts;

  app.get('/api/me/mfa', { preHandler: app.authenticate }, async (request, reply) => {
    return reply.code(200).send(await mfaService.status(requesterFrom(request).id));
  });

  app.post('/api/me/mfa/totp/setup', { preHandler: app.authenticate, config: WRITE_LIMIT }, async (request, reply) => {
    return reply.code(200).send(await mfaService.beginSetup(requesterFrom(request).id));
  });

  app.post('/api/me/mfa/totp/confirm', { preHandler: app.authenticate, config: WRITE_LIMIT }, async (request, reply) => {
    const body = parseInput(MfaConfirmRequestSchema, request.body, reply);
    if (!body) return;
    const { recoveryCodes, session } = await mfaService.confirmSetup(requesterFrom(request).id, body.code, body.currentPassword);
    return reply.code(200).send({ recoveryCodes, ...(session as object) });
  });

  app.delete('/api/me/mfa/totp', { preHandler: app.authenticate, config: WRITE_LIMIT }, async (request, reply) => {
    const body = parseInput(MfaDisableRequestSchema, request.body, reply);
    if (!body) return;
    const { session } = await mfaService.disable(requesterFrom(request).id, body.currentPassword, body);
    return reply.code(200).send(session);
  });

  app.post('/api/me/mfa/recovery-codes', { preHandler: app.authenticate, config: WRITE_LIMIT }, async (request, reply) => {
    const body = parseInput(MfaRecoveryCodesRequestSchema, request.body, reply);
    if (!body) return;
    return reply.code(200).send(await mfaService.regenerateRecoveryCodes(requesterFrom(request).id, body));
  });

  // POST statt DELETE: der Aufruf trägt Passwort (und ggf. Code) der
  // handelnden Person im Body, und DELETE-Bodies werden von Proxys und
  // Clients nicht überall zuverlässig weitergereicht.
  app.post<{ Params: { userId: string } }>(
    '/api/users/:userId/mfa/reset',
    { preHandler: [app.authenticate, requireAnyRole('admin', 'superadmin')], config: WRITE_LIMIT },
    async (request, reply) => {
      const body = parseInput(MfaResetRequestSchema, request.body, reply);
      if (!body) return;
      await mfaService.resetForUser(request.params.userId, requesterFrom(request), body.currentPassword, body);
      return reply.code(204).send();
    },
  );

  app.patch<{ Params: { id: string } }>(
    '/api/clubs/:id/mfa',
    { preHandler: [app.authenticate, requireAnyRole('admin', 'superadmin')], config: WRITE_LIMIT },
    async (request, reply) => {
      const body = parseInput(ClubMfaPolicyRequestSchema, request.body, reply);
      if (!body) return;
      const result = await mfaService.setClubAdminRequirement(request.params.id, body.requiredForAdmins, requesterFrom(request), body.currentPassword, body);
      return reply.code(200).send(result);
    },
  );
}
