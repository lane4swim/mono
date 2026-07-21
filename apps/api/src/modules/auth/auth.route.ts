// apps/api/src/modules/auth/auth.route.ts
//
// Phase 1: echte Authentifizierungs-Routen (ersetzen die 501-Platzhalter
// aus Phase 0). Siehe Abschnitt 5 des Backend-Entwicklungsplans.
import type { FastifyInstance } from 'fastify';
import {
  AcceptInvitationRequestSchema,
  LoginRequestSchema,
  RefreshRequestSchema,
  LogoutRequestSchema,
  UpdateMeRequestSchema,
} from '@lane1/shared-types';
import type { AuthService } from './auth.service.js';
import {
  EmailAlreadyRegisteredError,
  InvalidCredentialsError,
  InvalidRefreshTokenError,
  InvalidInvitationError,
  UserNotFoundError,
  ClubIdRequiredError,
} from './auth.service.js';
import { UserNotFoundForExportError, ErasureAlreadyRequestedError } from '../profile/profile.repository.js';
import { requireRole } from '../../plugins/authorize.js';

export async function authRoutes(app: FastifyInstance, opts: { authService: AuthService }) {
  const { authService } = opts;

  app.post(
    '/auth/register',
    {
      // Trotz Einladungspflicht weiterhin rate-limitiert — verhindert
      // automatisiertes Durchprobieren von Einladungs-Tokens.
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const parsed = AcceptInvitationRequestSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'validation_failed', issues: parsed.error.issues });

      try {
        const result = await authService.acceptInvitation(parsed.data);
        return reply.code(201).send(result);
      } catch (err) {
        if (err instanceof EmailAlreadyRegisteredError) {
          return reply.code(409).send({ error: 'email_taken', message: err.message });
        }
        if (err instanceof InvalidInvitationError) {
          return reply.code(410).send({ error: 'invalid_invitation', message: err.message });
        }
        throw err;
      }
    },
  );

  app.post(
    '/auth/login',
    {
      // Abschnitt 5.2: Rate-Limiting speziell gegen Brute-Force auf Login —
      // Schlüssel kombiniert IP + E-Mail, damit ein Angreifer nicht durch
      // Verteilung auf viele E-Mails oder viele IPs den Grenzwert umgeht,
      // ohne legitime Nutzer:innen mit derselben IP (z. B. Verein/NAT)
      // gegenseitig zu blockieren.
      config: {
        rateLimit: {
          max: 5,
          timeWindow: '1 minute',
          keyGenerator: (request) => {
            const email = (request.body as { email?: string } | undefined)?.email ?? 'unknown';
            return `${request.ip}:${email}`;
          },
        },
      },
    },
    async (request, reply) => {
      const parsed = LoginRequestSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'validation_failed', issues: parsed.error.issues });

      try {
        const result = await authService.login(parsed.data);
        return reply.code(200).send(result);
      } catch (err) {
        if (err instanceof InvalidCredentialsError) {
          return reply.code(401).send({ error: 'invalid_credentials', message: err.message });
        }
        throw err;
      }
    },
  );

  app.post('/auth/refresh', async (request, reply) => {
    const parsed = RefreshRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'validation_failed', issues: parsed.error.issues });

    try {
      const result = await authService.refresh(parsed.data.refreshToken);
      return reply.code(200).send(result);
    } catch (err) {
      if (err instanceof InvalidRefreshTokenError) {
        return reply.code(401).send({ error: 'invalid_refresh_token', message: err.message });
      }
      throw err;
    }
  });

  app.post('/auth/logout', async (request, reply) => {
    const parsed = LogoutRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'validation_failed', issues: parsed.error.issues });

    await authService.logout(parsed.data.refreshToken);
    return reply.code(204).send();
  });

  // Nutzerverwaltung: bestehende Vereinsmitglieder anzeigen, sortiert
  // nach Rolle (admin -> trainer -> athlete) und danach nach Namen (siehe
  // authService.listClubMembers()). Nur admin/superadmin — admin sieht
  // immer den eigenen Verein, superadmin muss ?clubId=<uuid> angeben.
  app.get<{ Querystring: { clubId?: string } }>(
    '/api/users',
    { preHandler: [app.authenticate, requireRole('admin', 'superadmin')] },
    async (request, reply) => {
      try {
        const users = await authService.listClubMembers(
          { role: request.user!.role, clubId: request.user!.clubId },
          request.query.clubId,
        );
        return reply.code(200).send({ users });
      } catch (err) {
        if (err instanceof ClubIdRequiredError) {
          return reply.code(400).send({ error: 'club_id_required', message: err.message });
        }
        throw err;
      }
    },
  );

  app.get('/api/me', { preHandler: app.authenticate }, async (request, reply) => {
    try {
      const user = await authService.getMe(request.user!.sub);
      return reply.code(200).send(user);
    } catch (err) {
      if (err instanceof UserNotFoundError) {
        return reply.code(404).send({ error: 'not_found', message: err.message });
      }
      throw err;
    }
  });

  app.patch('/api/me', { preHandler: app.authenticate }, async (request, reply) => {
    const parsed = UpdateMeRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'validation_failed', issues: parsed.error.issues });

    try {
      const user = await authService.updateMe(request.user!.sub, parsed.data);
      return reply.code(200).send(user);
    } catch (err) {
      if (err instanceof EmailAlreadyRegisteredError) {
        return reply.code(409).send({ error: 'email_taken', message: err.message });
      }
      if (err instanceof UserNotFoundError) {
        return reply.code(404).send({ error: 'not_found', message: err.message });
      }
      throw err;
    }
  });

  // Art. 15 DSGVO — Recht auf Auskunft: bündelt sämtliche zum eigenen
  // Konto gespeicherten Daten als JSON.
  app.get('/api/me/export', { preHandler: app.authenticate }, async (request, reply) => {
    try {
      const data = await authService.exportMyData(request.user!.sub);
      return reply.code(200).send(data);
    } catch (err) {
      if (err instanceof UserNotFoundForExportError) {
        return reply.code(404).send({ error: 'not_found', message: err.message });
      }
      throw err;
    }
  });

  // Art. 17 DSGVO — Recht auf Löschung: sofortiger Soft-Delete, endgültiger
  // Hard-Purge folgt zeitversetzt (siehe jobs/purgeExpiredDeletions.ts).
  // 200 statt 204, da die Antwort das Datum des endgültigen Löschens
  // mitteilt (Transparenzpflicht).
  app.delete('/api/me', { preHandler: app.authenticate }, async (request, reply) => {
    try {
      const { purgeAfter } = await authService.requestAccountDeletion(request.user!.sub);
      return reply.code(200).send({
        message: 'Ihr Konto wurde zur Löschung vorgemerkt und ist ab sofort deaktiviert.',
        purgeAfter: purgeAfter.toISOString(),
      });
    } catch (err) {
      if (err instanceof UserNotFoundForExportError) {
        return reply.code(404).send({ error: 'not_found', message: err.message });
      }
      if (err instanceof ErasureAlreadyRequestedError) {
        return reply.code(409).send({ error: 'erasure_already_requested', message: err.message });
      }
      throw err;
    }
  });
}
