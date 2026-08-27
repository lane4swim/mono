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
  ForgotPasswordRequestSchema,
  ResetPasswordRequestSchema,
  ChangePasswordRequestSchema,
  ChangeEmailRequestSchema,
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

  // "Passwort vergessen" (Sicherheitsreview 2026-08, Befund M5) —
  // öffentlich (keine Authentifizierung, die Person hat ja gerade ihr
  // Passwort vergessen). Liefert IMMER dieselbe generische 200-Antwort,
  // unabhängig davon, ob die E-Mail-Adresse zu einem Konto gehört (siehe
  // authService.requestPasswordReset() — verhindert User-Enumeration).
  //
  // Rate-Limit analog zu /auth/login (IP + E-Mail kombiniert — verhindert
  // sowohl das Fluten EINER Person mit Reset-E-Mails als auch das
  // Durchprobieren vieler E-Mail-Adressen von einer IP), aber strenger
  // (3 statt 5 pro Minute) und mit einem deutlich längeren Zeitfenster:
  // anders als ein fehlgeschlagener Login-Versuch löst ein Treffer hier
  // tatsächlich einen E-Mail-Versand aus — spürbar teurer zu missbrauchen
  // (SMTP-Kosten/-Reputation, Störung der betroffenen Person) als ein
  // weiterer Login-Fehlversuch.
  app.post(
    '/auth/forgot-password',
    {
      config: {
        rateLimit: {
          max: 3,
          timeWindow: '15 minutes',
          keyGenerator: (request) => {
            const email = (request.body as { email?: string } | undefined)?.email ?? 'unknown';
            return `${request.ip}:${email}`;
          },
        },
      },
    },
    async (request, reply) => {
      const body = parseInput(ForgotPasswordRequestSchema, request.body, reply);
      if (!body) return;

      await authService.requestPasswordReset(body.email);
      return reply.code(200).send({
        message: 'Falls ein Konto mit dieser E-Mail-Adresse existiert, wurde eine E-Mail zum Zurücksetzen des Passworts versendet.',
      });
    },
  );

  // Löst das per E-Mail zugestellte Reset-Token ein — meldet die Person
  // bei Erfolg direkt an (siehe authService.resetPassword()-Kommentar).
  // Rate-Limit analog zu /auth/refresh: nur nach IP (kein sinnvoller
  // Nutzer-Bezug vor der Anmeldung), verhindert automatisiertes
  // Durchprobieren erratener/gestohlener Reset-Tokens — das Token selbst
  // ist mit 256 Bit Entropie zwar praktisch nicht erratbar, dies ist
  // zusätzliche Tiefenverteidigung, analog zu /auth/refresh.
  app.post(
    '/auth/reset-password',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const body = parseInput(ResetPasswordRequestSchema, request.body, reply);
      if (!body) return;

      // InvalidOrExpiredResetTokenError: über die zentrale Fehler-Registry
      // abgedeckt (siehe plugins/httpErrorHandler.ts).
      const result = await authService.resetPassword(body.token, body.newPassword);
      return reply.code(200).send(result);
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

  // Passwortwechsel für die eigene, eingeloggte Person (Sicherheitsreview
  // 2026-08, Befund M5) — verlangt zusätzlich das aktuelle Passwort (siehe
  // authService.changePassword()-Kommentar für die Begründung). Liefert
  // wie login()/resetPassword() ein frisches Token-Paar, damit die
  // AKTUELLE Sitzung ohne erneuten Login weiterläuft, während alle
  // ANDEREN Sitzungen widerrufen werden.
  //
  // Rate-Limit bewusst nur nach IP (nicht IP + Nutzer:in wie bei
  // /auth/login): der globale Rate-Limit-Hook läuft (siehe
  // plugins/security.ts: hook: 'preHandler') VOR jedem route-eigenen
  // preHandler — also auch vor app.authenticate unten —, request.user ist
  // im keyGenerator zu diesem Zeitpunkt daher noch NICHT gesetzt. Analog zu
  // /auth/refresh: verhindert dennoch automatisiertes Durchprobieren des
  // aktuellen Passworts mit einem entwendeten, noch gültigen Access Token.
  app.post(
    '/api/me/password',
    {
      preHandler: app.authenticate,
      config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const body = parseInput(ChangePasswordRequestSchema, request.body, reply);
      if (!body) return;

      // InvalidCurrentPasswordError: über die zentrale Fehler-Registry
      // abgedeckt (siehe plugins/httpErrorHandler.ts).
      const result = await authService.changePassword(request.user!.sub, body.currentPassword, body.newPassword);
      return reply.code(200).send(result);
    },
  );

  // E-Mail-Wechsel für die eigene, eingeloggte Person (Sicherheitsreview
  // 2026-08-27, Befund H2) — verlangt zusätzlich das aktuelle Passwort
  // (siehe authService.changeEmail()-Kommentar für die Begründung: ohne
  // diese Prüfung hätte ein kurzzeitig entwendeter, noch gültiger Access
  // Token gereicht, um kombiniert mit POST /auth/forgot-password eine
  // dauerhafte Kontoübernahme zu erreichen). `email` ist deshalb bewusst
  // NICHT mehr Teil von PATCH /api/me (siehe UpdateMeRequestSchema).
  // Liefert wie /api/me/password ein frisches Token-Paar, damit die
  // AKTUELLE Sitzung ohne erneuten Login weiterläuft, während alle
  // ANDEREN Sitzungen widerrufen werden.
  //
  // Rate-Limit bewusst nur nach IP (nicht IP + Nutzer:in), aus demselben
  // Grund wie /api/me/password oben: der globale Rate-Limit-Hook läuft
  // (siehe plugins/security.ts: hook: 'preHandler') VOR jedem
  // route-eigenen preHandler wie app.authenticate — request.user ist im
  // keyGenerator zu diesem Zeitpunkt noch nicht gesetzt.
  app.post(
    '/api/me/email',
    {
      preHandler: app.authenticate,
      config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const body = parseInput(ChangeEmailRequestSchema, request.body, reply);
      if (!body) return;

      // InvalidCurrentPasswordError/EmailAlreadyRegisteredError: über die
      // zentrale Fehler-Registry abgedeckt (siehe plugins/httpErrorHandler.ts).
      const result = await authService.changeEmail(request.user!.sub, body.currentPassword, body.newEmail);
      return reply.code(200).send(result);
    },
  );

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
