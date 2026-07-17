// apps/api/src/modules/invitations/invitations.route.ts
//
// Endpunkte für den einladungsbasierten Registrierungsprozess. Siehe
// invitations.service.ts für die Autorisierungsmatrix.
import type { FastifyInstance } from 'fastify';
import { CreateClubRequestSchema, CreateInvitationRequestSchema } from '@lane1/shared-types';
import type { InvitationsService } from './invitations.service.js';
import {
  ForbiddenError,
  ClubNotFoundError,
  InvitationNotFoundError,
  InvitationExpiredError,
  InvitationAlreadyUsedError,
  InvitationRevokedError,
} from './invitations.service.js';
import { requireRole } from '../../plugins/authorize.js';

export interface InvitationsRoutesOptions {
  invitationsService: InvitationsService;
}

function requesterFrom(request: { user?: { sub: string; role: string; clubId: string | null } }) {
  const user = request.user!;
  return { id: user.sub, role: user.role, clubId: user.clubId };
}

export async function invitationsRoutes(app: FastifyInstance, opts: InvitationsRoutesOptions) {
  const { invitationsService } = opts;

  // Öffentlich (keine Authentifizierung) — die eingeladene Person kennt
  // ihre Rolle/ihren Verein noch nicht und ist naturgemäß noch nicht
  // eingeloggt, wenn sie den Link öffnet.
  app.get<{ Params: { token: string } }>('/api/invitations/preview/:token', async (request, reply) => {
    try {
      const preview = await invitationsService.preview(request.params.token);
      return reply.code(200).send(preview);
    } catch (err) {
      if (
        err instanceof InvitationNotFoundError ||
        err instanceof InvitationExpiredError ||
        err instanceof InvitationAlreadyUsedError ||
        err instanceof InvitationRevokedError
      ) {
        return reply.code(410).send({ error: 'invalid_invitation', message: err.message });
      }
      throw err;
    }
  });

  app.post(
    '/api/clubs',
    { preHandler: [app.authenticate, requireRole('superadmin')] },
    async (request, reply) => {
      const parsed = CreateClubRequestSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'validation_failed', issues: parsed.error.issues });

      const result = await invitationsService.createClub(parsed.data, requesterFrom(request));
      return reply.code(201).send(result);
    },
  );

  app.get('/api/clubs', { preHandler: [app.authenticate, requireRole('superadmin')] }, async (request, reply) => {
    const clubs = await invitationsService.listClubs(requesterFrom(request));
    return reply.code(200).send({ clubs });
  });

  app.post(
    '/api/invitations',
    { preHandler: [app.authenticate, requireRole('superadmin', 'admin')] },
    async (request, reply) => {
      const parsed = CreateInvitationRequestSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'validation_failed', issues: parsed.error.issues });

      try {
        const invitation = await invitationsService.createInvitation(parsed.data, requesterFrom(request));
        return reply.code(201).send(invitation);
      } catch (err) {
        if (err instanceof ForbiddenError) return reply.code(403).send({ error: 'forbidden', message: err.message });
        if (err instanceof ClubNotFoundError) return reply.code(404).send({ error: 'club_not_found', message: err.message });
        throw err;
      }
    },
  );

  app.get(
    '/api/invitations',
    { preHandler: [app.authenticate, requireRole('superadmin', 'admin')] },
    async (request, reply) => {
      const invitations = await invitationsService.list(requesterFrom(request));
      return reply.code(200).send({ invitations });
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/invitations/:id',
    { preHandler: [app.authenticate, requireRole('superadmin', 'admin')] },
    async (request, reply) => {
      try {
        await invitationsService.revoke(request.params.id, requesterFrom(request));
        return reply.code(204).send();
      } catch (err) {
        if (err instanceof ForbiddenError) return reply.code(403).send({ error: 'forbidden', message: err.message });
        if (err instanceof InvitationNotFoundError) return reply.code(404).send({ error: 'not_found', message: err.message });
        throw err;
      }
    },
  );
}
