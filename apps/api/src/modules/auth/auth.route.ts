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
import { requireRole } from '../../plugins/authorize.js';
import { parseInput } from '../../plugins/parseInput.js';

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
      const body = parseInput(AcceptInvitationRequestSchema, request.body, reply);
      if (!body) return;

      // EmailAlreadyRegisteredError/AthleteAlreadyLinkedError/
      // InvalidInvitationError: alle drei über die zentrale
      // Fehler-Registry abgedeckt (siehe plugins/httpErrorHandler.ts) —
      // kein eigenes catch mehr nötig.
      const result = await authService.acceptInvitation(body);
      return reply.code(201).send(result);
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
      const body = parseInput(LoginRequestSchema, request.body, reply);
      if (!body) return;

      const result = await authService.login(body);
      return reply.code(200).send(result);
    },
  );

  app.post(
    '/auth/refresh',
    {
      // Spezifisches Rate-Limit (statt nur des globalen 100/min aus
      // plugins/security.ts) — verhindert automatisiertes Durchprobieren
      // gestohlener/erratener Refresh-Tokens sowie übermäßiges Ausnutzen
      // der Token-Rotation. Schlüssel bewusst nur nach IP (nicht nach
      // Refresh-Token, der ja gerade erst validiert werden soll und für
      // nicht authentifizierte Anfragen kein sinnvoller Schlüssel wäre).
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const body = parseInput(RefreshRequestSchema, request.body, reply);
      if (!body) return;

      const result = await authService.refresh(body.refreshToken);
      return reply.code(200).send(result);
    },
  );

  app.post(
    '/auth/logout',
    {
      // Ebenfalls spezifisch begrenzt (siehe /auth/refresh oben) — auch
      // wenn Logout selbst harmlos ist, verhindert das Limit, dass diese
      // Route zum Durchprobieren/Invalidieren fremder Refresh-Tokens
      // missbraucht wird.
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const body = parseInput(LogoutRequestSchema, request.body, reply);
      if (!body) return;

      await authService.logout(body.refreshToken);
      return reply.code(204).send();
    },
  );

  // Nutzerverwaltung: bestehende Vereinsmitglieder anzeigen, sortiert
  // nach Rolle (admin -> trainer -> athlete) und danach nach Namen (siehe
  // authService.listClubMembers()). Nur admin/superadmin — admin sieht
  // immer den eigenen Verein, superadmin muss ?clubId=<uuid> angeben.
  app.get<{ Querystring: { clubId?: string } }>(
    '/api/users',
    { preHandler: [app.authenticate, requireRole('admin', 'superadmin')] },
    async (request, reply) => {
      const users = await authService.listClubMembers(
        { role: request.user!.role, clubId: request.user!.clubId },
        request.query.clubId,
      );
      return reply.code(200).send({ users });
    },
  );

  // Mögliche Zuständige für ein Handlungsfeld (Trainer:innen + Admins des
  // eigenen Vereins) — für den Dropdown in apps/web/js/modules/actionItems.js.
  // Anders als /api/users auch für die Rolle "trainer" zugänglich (nicht
  // nur admin/superadmin): Trainer:innen legen Handlungsfelder selbst an
  // und müssen sie ggf. an eine Kollegin/einen Kollegen zuweisen können.
  app.get(
    '/api/users/trainers',
    { preHandler: [app.authenticate, requireRole('trainer', 'admin')] },
    async (request, reply) => {
      const users = await authService.listAssignableTrainers({ clubId: request.user!.clubId });
      return reply.code(200).send({ users });
    },
  );

  app.get('/api/me', { preHandler: app.authenticate }, async (request, reply) => {
    const user = await authService.getMe(request.user!.sub);
    return reply.code(200).send(user);
  });

  app.patch('/api/me', { preHandler: app.authenticate }, async (request, reply) => {
    const body = parseInput(UpdateMeRequestSchema, request.body, reply);
    if (!body) return;

    const user = await authService.updateMe(request.user!.sub, body);
    return reply.code(200).send(user);
  });

  // Art. 15 DSGVO — Recht auf Auskunft: bündelt sämtliche zum eigenen
  // Konto gespeicherten Daten als JSON.
  app.get('/api/me/export', { preHandler: app.authenticate }, async (request, reply) => {
    const data = await authService.exportMyData(request.user!.sub);
    return reply.code(200).send(data);
  });

  // Art. 17 DSGVO — Recht auf Löschung: sofortiger Soft-Delete, endgültiger
  // Hard-Purge folgt zeitversetzt (siehe jobs/purgeExpiredDeletions.ts).
  // 200 statt 204, da die Antwort das Datum des endgültigen Löschens
  // mitteilt (Transparenzpflicht).
  app.delete('/api/me', { preHandler: app.authenticate }, async (request, reply) => {
    const { purgeAfter } = await authService.requestAccountDeletion(request.user!.sub);
    return reply.code(200).send({
      message: 'Ihr Konto wurde zur Löschung vorgemerkt und ist ab sofort deaktiviert.',
      purgeAfter: purgeAfter.toISOString(),
    });
  });
}
