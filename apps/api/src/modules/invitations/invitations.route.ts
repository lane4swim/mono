// apps/api/src/modules/invitations/invitations.route.ts
//
// Endpunkte für den einladungsbasierten Registrierungsprozess. Siehe
// invitations.service.ts für die Autorisierungsmatrix.
import type { FastifyInstance } from 'fastify';
import { CreateClubRequestSchema, CreateInvitationRequestSchema, UpdateClubRequestSchema, UpdateClubIdentityRequestSchema, InvitationPreviewRequestSchema } from '@lane1/shared-types';
import type { InvitationsService } from './invitations.service.js';
import { InvitationNotFoundError } from './invitations.service.js';
import { requireAnyRole } from '../../plugins/authorize.js';
import { parseInput } from '../../plugins/parseInput.js';

export interface InvitationsRoutesOptions {
  invitationsService: InvitationsService;
}

function requesterFrom(request: { user?: { sub: string; roles: string[]; clubId: string | null } }) {
  const user = request.user!;
  return { id: user.sub, roles: user.roles, clubId: user.clubId };
}

export async function invitationsRoutes(app: FastifyInstance, opts: InvitationsRoutesOptions) {
  const { invitationsService } = opts;

  // Öffentlich (keine Authentifizierung) — die eingeladene Person kennt
  // ihre Rolle/ihren Verein noch nicht und ist naturgemäß noch nicht
  // eingeloggt, wenn sie den Link öffnet.
  //
  // Sicherheitskorrektur (Sicherheitsreview 2026-08, Befund M3): bewusst
  // POST mit Token im Body statt GET mit Token als URL-Pfadparameter
  // (siehe InvitationPreviewRequestSchema-Kommentar in
  // packages/shared-types/src/invitation.ts) — verhindert, dass das Token
  // über Fastifys req.url-Logging in Zugriffs-/Anwendungslogs landet. Der
  // geteilte Einladungslink selbst ändert sich dadurch NICHT (bleibt
  // #/accept-invite/<token> im URL-Fragment, siehe buildInviteUrl() in
  // invitations.service.ts) — nur der interne API-Aufruf, den das
  // Frontend beim Öffnen dieses Links macht.
  //
  // Zusätzlich rate-limitiert (statt nur des globalen 100/min aus
  // plugins/security.ts) — verhindert automatisiertes Durchprobieren von
  // Einladungs-Tokens über diesen einzigen unauthentifizierten Endpunkt.
  app.post(
    '/api/invitations/preview',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const body = parseInput(InvitationPreviewRequestSchema, request.body, reply);
      if (!body) return;
      try {
        const preview = await invitationsService.preview(body.token);
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
    },
  );

  app.post(
    '/api/clubs',
    { preHandler: [app.authenticate, requireAnyRole('superadmin')] },
    async (request, reply) => {
      const body = parseInput(CreateClubRequestSchema, request.body, reply);
      if (!body) return;

      const result = await invitationsService.createClub(body, requesterFrom(request));
      return reply.code(201).send(result);
    },
  );

  app.get('/api/clubs', { preHandler: [app.authenticate, requireAnyRole('superadmin')] }, async (request, reply) => {
    const clubs = await invitationsService.listClubs(requesterFrom(request));
    return reply.code(200).send({ clubs });
  });

  app.patch<{ Params: { id: string } }>(
    '/api/clubs/:id',
    { preHandler: [app.authenticate, requireAnyRole('superadmin')] },
    async (request, reply) => {
      const body = parseInput(UpdateClubRequestSchema, request.body, reply);
      if (!body) return;

      // ClubNotFoundError: über die zentrale Fehler-Registry abgedeckt (404).
      const club = await invitationsService.updateClubModules(request.params.id, body.enabledModules, requesterFrom(request));
      return reply.code(200).send({ club });
    },
  );

  // Eigener Endpunkt statt Erweiterung von PATCH /api/clubs/:id oben, damit
  // Admins ihre eigene Vereinskennung pflegen können, ohne die
  // Superadmin-only-Modulverwaltung mitzubenötigen (siehe
  // invitations.service.ts: updateClubIdentity()).
  app.patch<{ Params: { id: string } }>(
    '/api/clubs/:id/identity',
    { preHandler: [app.authenticate, requireAnyRole('admin', 'superadmin')] },
    async (request, reply) => {
      const body = parseInput(UpdateClubIdentityRequestSchema, request.body, reply);
      if (!body) return;

      // ClubNotFoundError/ForbiddenError: über die zentrale Fehler-Registry
      // abgedeckt (404 bzw. 403).
      const club = await invitationsService.updateClubIdentity(request.params.id, body, requesterFrom(request));
      return reply.code(200).send({ club });
    },
  );

  app.post(
    '/api/invitations',
    { preHandler: [app.authenticate, requireAnyRole('superadmin', 'admin')] },
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
    { preHandler: [app.authenticate, requireAnyRole('superadmin', 'admin')] },
    async (request, reply) => {
      const invitations = await invitationsService.list(requesterFrom(request));
      return reply.code(200).send({ invitations });
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/invitations/:id',
    { preHandler: [app.authenticate, requireAnyRole('superadmin', 'admin')] },
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
