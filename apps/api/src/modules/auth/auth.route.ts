// apps/api/src/modules/auth/auth.route.ts
//
// Phase 1: echte Authentifizierungs-Routen (ersetzen die 501-Platzhalter
// aus Phase 0). Siehe Abschnitt 5 des Backend-Entwicklungsplans.
import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
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
  UpdateUserRolesRequestSchema,
} from '@lane1/shared-types';
import type { AuthService } from './auth.service.js';
import { requireAnyRole } from '../../plugins/authorize.js';
import { parseInput } from '../../plugins/parseInput.js';

// Review 30.08.2026, Befund S2: Rate-Limits für /api/me/password und
// /api/me/email zählten bislang NUR nach IP — die dortigen (jetzt
// überholten) Kommentare erklärten, dass request.user im keyGenerator
// technisch nicht erreichbar ist, weil der globale Rate-Limit-Hook
// (plugins/security.ts: hook: 'preHandler') vor JEDEM route-eigenen
// preHandler läuft, also auch vor app.authenticate. Der rohe
// Authorization-Header steht zu diesem Zeitpunkt aber schon zur
// Verfügung — HTTP-Header werden vom Server unabhängig von jeder
// Parsing-/Auth-Stufe bereitgestellt, anders als request.user (das erst
// app.authenticate setzt) oder request.body (das erst preValidation
// parst). Ein Hash des vorgelegten Access Tokens trennt die Budgets
// unterschiedlicher angemeldeter Personen genauso zuverlässig wie
// request.user.sub, ohne auf dessen Auswertung warten zu müssen.
//
// Bewusst NICHT dasselbe Muster für /auth/refresh, /auth/register,
// /auth/logout und /auth/reset-password unten (siehe deren jeweilige
// Kommentare): dort steht kein bereits gültiges, vom Server ausgestelltes
// Geheimnis zur Verfügung, sondern GENAU der Wert, den ein Angreifer zu
// erraten/stehlen versucht (Refresh-/Einladungs-/Reset-Token). Ein
// Schlüssel aus DIESEM Wert ließe sich durch einfaches Wechseln des
// geratenen Werts bei jedem Versuch umgehen — jeder neue Versuch bekäme
// sein eigenes, frisches Budget, wodurch das Limit seinen eigentlichen
// Zweck (das Durchprobieren vieler Werte zu verlangsamen) verlöre. Beim
// Access Token hier ist das anders: ein Angreifer besitzt zu jedem
// Zeitpunkt höchstens die Token, die er tatsächlich erbeutet hat, und
// kann sie nicht beliebig neu erzeugen — der Schlüssel bleibt für seine
// Versuche stabil.
function accessTokenRateLimitKey(request: FastifyRequest): string {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) return `${request.ip}:no-token`;
  return createHash('sha256').update(header).digest('hex');
}

export async function authRoutes(app: FastifyInstance, opts: { authService: AuthService }) {
  const { authService } = opts;

  app.post(
    '/auth/register',
    {
      // Trotz Einladungspflicht weiterhin rate-limitiert — verhindert
      // automatisiertes Durchprobieren von Einladungs-Tokens. Bewusst
      // weiterhin NUR nach IP geschlüsselt, nicht nach dem Token selbst
      // (siehe die ausführliche Begründung bei accessTokenRateLimitKey()
      // oben) — der Grenzwert ist stattdessen von 10 auf 20 pro Minute
      // angehoben (Review 30.08.2026, Befund S2), damit eine Trainings-
      // gruppe, die gemeinsam am Vereinsheim-WLAN mehrere Einladungen
      // annimmt, sich nicht gegenseitig aussperrt.
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
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
      // nicht authentifizierte Anfragen kein sinnvoller Schlüssel wäre) —
      // siehe die ausführliche Begründung bei accessTokenRateLimitKey()
      // oben, warum ein Schlüssel aus dem Token selbst hier sogar
      // KONTRAPRODUKTIV wäre.
      //
      // Review 30.08.2026, Befund S2: Grenzwert von 10 auf 60 pro Minute
      // angehoben — das ist der praktisch relevante Fall der IP-Schlüsse-
      // lung, da apiClient.js JEDE angemeldete Sitzung automatisch und
      // ohne Zutun proaktiv erneuert (siehe dort:
      // PROACTIVE_REFRESH_MARGIN_MS), nicht nur bei einer bewussten
      // Nutzer:innen-Aktion wie einem Login. Mehrere Geräte am selben
      // Vereinsheim-WLAN erneuern dadurch unabhängig voneinander,
      // gebündelt auf dieselbe öffentliche IP — 10/Minute reichte dafür
      // in der Praxis nicht. Die 256 Bit Entropie des Refresh Tokens
      // (siehe auth/tokens.ts) machen ein tatsächliches Erraten so oder
      // so unerreichbar; der höhere Grenzwert ändert daran nichts
      // Messbares, nimmt aber echten Nutzer:innen die Reibung.
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
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
      // missbraucht wird. Review 30.08.2026, Befund S2: bewusst
      // unverändert (weder Schlüssel noch Grenzwert) — anders als
      // /auth/refresh löst Logout keine automatische Hintergrundlast aus,
      // eine legitime NAT-Kollision ist hier unrealistisch; ein Schlüssel
      // aus dem Refresh Token selbst wäre aus demselben Grund wie bei
      // /auth/refresh kontraproduktiv (siehe accessTokenRateLimitKey()
      // oben).
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
  // Review 30.08.2026, Befund S2: bewusst unverändert (weder Schlüssel
  // noch Grenzwert) — ein Passwort-Reset ist eine seltene, bewusste
  // Einzelhandlung ohne automatischen Hintergrund-Trigger, eine legitime
  // NAT-Kollision ist hier unrealistisch; ein Schlüssel aus dem
  // vorgelegten Reset-Token wäre aus demselben Grund wie bei
  // /auth/refresh kontraproduktiv (siehe accessTokenRateLimitKey() oben).
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
    { preHandler: [app.authenticate, requireAnyRole('admin', 'superadmin')] },
    async (request, reply) => {
      const users = await authService.listClubMembers(
        { roles: request.user!.roles, clubId: request.user!.clubId },
        request.query.clubId,
      );
      return reply.code(200).send({ users });
    },
  );

  // Rollen einer Person im eigenen Verein ändern (docs/kampfrichter-modul-
  // plan.md, Abschnitt 1.4) — nur admin, nie superadmin (der zu keinem
  // Verein gehört und daher auch niemandes Rollen im Verein ändern kann).
  // ForeignClubUserError/CannotAssignSuperadminError/LastAdminError: über
  // die zentrale Fehler-Registry abgedeckt (siehe plugins/httpErrorHandler.ts).
  app.patch<{ Params: { userId: string } }>(
    '/api/users/:userId/roles',
    { preHandler: [app.authenticate, requireAnyRole('admin')] },
    async (request, reply) => {
      const body = parseInput(UpdateUserRolesRequestSchema, request.body, reply);
      if (!body) return;

      const user = await authService.updateUserRoles(request.params.userId, body.roles, { clubId: request.user!.clubId });
      return reply.code(200).send(user);
    },
  );

  // Mögliche Zuständige für ein Handlungsfeld (Trainer:innen + Admins des
  // eigenen Vereins) — für den Dropdown in apps/web/js/modules/actionItems.js.
  // Anders als /api/users auch für die Rolle "trainer" zugänglich (nicht
  // nur admin/superadmin): Trainer:innen legen Handlungsfelder selbst an
  // und müssen sie ggf. an eine Kollegin/einen Kollegen zuweisen können.
  app.get(
    '/api/users/trainers',
    { preHandler: [app.authenticate, requireAnyRole('trainer', 'admin')] },
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
  // Rate-Limit verhindert automatisiertes Durchprobieren des aktuellen
  // Passworts mit einem entwendeten, noch gültigen Access Token. Bis
  // Review 30.08.2026 (Befund S2) war der Schlüssel nur die IP —
  // request.user ist im keyGenerator technisch nicht erreichbar (der
  // globale Rate-Limit-Hook läuft laut plugins/security.ts:
  // hook: 'preHandler' VOR jedem route-eigenen preHandler, also auch vor
  // app.authenticate unten), wodurch sich ein Verein hinter NAT dieselbe
  // Fünf-Versuche-Grenze teilte, unabhängig davon, wie viele
  // unterschiedliche Konten dahinterstanden. accessTokenRateLimitKey()
  // (siehe oben) löst das über den bereits vorliegenden, rohen
  // Authorization-Header statt über request.user.
  app.post(
    '/api/me/password',
    {
      preHandler: app.authenticate,
      config: { rateLimit: { max: 5, timeWindow: '1 minute', keyGenerator: accessTokenRateLimitKey } },
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
  // Rate-Limit-Schlüssel: siehe /api/me/password oben und
  // accessTokenRateLimitKey() (Review 30.08.2026, Befund S2) — derselbe
  // Grund gilt hier unverändert.
  app.post(
    '/api/me/email',
    {
      preHandler: app.authenticate,
      config: { rateLimit: { max: 5, timeWindow: '1 minute', keyGenerator: accessTokenRateLimitKey } },
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
