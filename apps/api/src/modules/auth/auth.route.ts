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
} from './auth.service.js';

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
}
