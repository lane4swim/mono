// apps/api/src/modules/invitations/invitations.route.ts
//
// Endpunkte für den einladungsbasierten Registrierungsprozess. Siehe
// invitations.service.ts für die Autorisierungsmatrix.
import type { FastifyInstance } from 'fastify';
import { CreateClubRequestSchema, CreateInvitationRequestSchema } from '@lane1/shared-types';
import type { InvitationsService } from './invitations.service.js';
import { InvitationNotFoundError } from './invitations.service.js';
import { requireRole } from '../../plugins/authorize.js';
import { parseInput } from '../../plugins/parseInput.js';

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
      // Einzige Abweichung von der zentralen Fehler-Registry (siehe
      // plugins/httpErrorHandler.ts): dort liefert InvitationNotFoundError
      // 404 (der Fall in revoke() unten), hier bewusst 410 — für eine
      // Einladungsvorschau sind "nicht gefunden"/"abgelaufen"/"bereits
      // verwendet"/"widerrufen" ein und dieselbe Nutzerbotschaft ("dieser
      // Link funktioniert nicht mehr"). Die übrigen drei
      // Invitation*Error-Klassen landen bereits über die Registry korrekt
      // bei 410 und brauchen hier keine Sonderbehandlung mehr.
      if (err instanceof InvitationNotFoundError) {
        return reply.code(410).send({ error: 'invalid_invitation', message: err.message });
      }
      throw err;
    }
  });

  app.post(
    '/api/clubs',
    { preHandler: [app.authenticate, requireRole('superadmin')] },
    async (request, reply) => {
      const body = parseInput(CreateClubRequestSchema, request.body, reply);
      if (!body) return;

      const result = await invitationsService.createClub(body, requesterFrom(request));
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
      const body = parseInput(CreateInvitationRequestSchema, request.body, reply);
      if (!body) return;

      // ForbiddenError/ClubNotFoundError/AthleteNotFoundError/
      // AthleteClubMismatchError: alle vier über die zentrale
      // Fehler-Registry abgedeckt (siehe plugins/httpErrorHandler.ts).
      const invitation = await invitationsService.createInvitation(body, requesterFrom(request));
      return reply.code(201).send(invitation);
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
      // ForbiddenError/InvitationNotFoundError: beide über die zentrale
      // Fehler-Registry abgedeckt — InvitationNotFoundError landet hier
      // (anders als bei preview() oben) korrekt bei deren Standard-
      // Zuordnung (404), keine Sonderbehandlung nötig.
      await invitationsService.revoke(request.params.id, requesterFrom(request));
      return reply.code(204).send();
    },
  );
}
