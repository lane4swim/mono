// apps/api/src/app.ts
//
// Trennung von "App bauen" (app.ts) und "App starten" (index.ts) ist
// bewusst — so kann ein Test die App per Fastify's `.inject()` gegen
// echte Route-Handler testen, ohne einen Netzwerk-Port zu belegen.
//
// Phase 1: `overrides.authService`/`overrides.invitationsService` erlauben
// es Tests, die Business-Logik mit In-Memory-Repositories statt Prisma zu
// verdrahten (siehe *.repository.memory.ts) — Produktion nutzt ohne
// Override automatisch die Prisma-Implementierung.
import Fastify, { type FastifyInstance } from 'fastify';
import type { Env } from './config/env.js';
import { registerSecurityPlugins } from './plugins/security.js';
import { registerHttpErrorHandler } from './plugins/httpErrorHandler.js';
import authenticatePlugin from './plugins/authenticate.js';
import { healthRoutes } from './modules/health/health.route.js';
import { authRoutes } from './modules/auth/auth.route.js';
import { syncRoutes } from './modules/sync/sync.route.js';
import { invitationsRoutes } from './modules/invitations/invitations.route.js';
import { createAuthService, type AuthService } from './modules/auth/auth.service.js';
import { PrismaUserRepository, PrismaRefreshTokenRepository, PrismaPasswordResetTokenRepository } from './modules/auth/auth.repository.js';
import { createInvitationsService, type InvitationsService } from './modules/invitations/invitations.service.js';
import { PrismaClubRepository, PrismaInvitationRepository, PrismaAthleteRepository } from './modules/invitations/invitations.repository.js';
import { createSyncService, type SyncService } from './modules/sync/sync.service.js';
import { PrismaSyncGateway } from './modules/sync/sync.gateway.js';
import { PrismaProfileDataGateway } from './modules/profile/profile.repository.js';
import { SmtpMailSender, ConsoleMailSender, type MailSender } from './mail/mailer.js';
import { resolveKeyPair } from './auth/keys.js';
import { getPrisma } from './db/prisma.js';

export interface BuildAppOverrides {
  authService?: AuthService;
  invitationsService?: InvitationsService;
  syncService?: SyncService;
  mailer?: MailSender;
  keyPair?: ReturnType<typeof resolveKeyPair>;
}

// Standardmäßige Gültigkeitsdauer von Einladungen (kann später konfigurierbar
// gemacht werden, z. B. über env.ts, falls gewünscht).
const CLUB_INVITATION_TTL_DAYS = 14; // Admin-Einladungen: etwas großzügiger
const MEMBER_INVITATION_TTL_DAYS = 7; // Trainer:in-/Athlet:in-Einladungen
// "Passwort vergessen" (Sicherheitsreview 2026-08, Befund M5) — bewusst
// deutlich kürzer als jede Einladungs-TTL oben (siehe auth/tokens.ts:
// generatePasswordResetToken()-Kommentar für die Begründung).
const PASSWORD_RESET_TTL_MINUTES = 60;

function resolveMailer(env: Env): MailSender {
  if (!env.SMTP_HOST) return new ConsoleMailSender();
  return new SmtpMailSender({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    user: env.SMTP_USER,
    password: env.SMTP_PASSWORD,
    fromEmail: env.SMTP_FROM_EMAIL,
    fromName: env.SMTP_FROM_NAME,
  });
}

export async function buildApp(env: Env, overrides: BuildAppOverrides = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: env.NODE_ENV !== 'test',
    // Sicherheitskorrektur (Sicherheitsreview 2026-08, Befund H2): ohne
    // trustProxy ignoriert Fastify den von allen Deployment-Anleitungen
    // gesetzten "X-Forwarded-For"-Header — request.ip ist dann für JEDE
    // Anfrage die Adresse des vorgeschalteten Nginx (siehe docs/deployment*.md),
    // nicht die des tatsächlichen Clients. Die drei IP-basierten
    // Rate-Limits (global in plugins/security.ts, sowie /auth/refresh und
    // /auth/logout in auth.route.ts) kollabierten dadurch auf einen
    // EINZIGEN, geteilten Zähler für die gesamte Installation — ein
    // einzelner Client konnte damit alle anderen aussperren. trustProxy:
    // true wertet "X-Forwarded-For" aus; request.ip zeigt danach wieder
    // die tatsächliche Client-Adresse.
    trustProxy: true,
  });

  await registerSecurityPlugins(app, env);
  // Auf der Wurzelinstanz registriert (vor jedem app.register() für die
  // Routen-Module unten) — gilt dadurch automatisch für alle Routen, ohne
  // dass jedes Modul einzeln daran denken muss.
  registerHttpErrorHandler(app);

  // Wichtig: dasselbe Schlüsselpaar wird sowohl für die Token-Ausstellung
  // (authService) als auch für die Verifikation (authenticate-Plugin)
  // verwendet. Ein Override muss beides konsistent mitbringen — siehe
  // test/auth/auth.route.test.ts, das genau deshalb `{ authService, keyPair }`
  // gemeinsam übergibt.
  const keyPair = overrides.keyPair ?? resolveKeyPair(env);
  await app.register(authenticatePlugin, { keyPair });

  const mailer = overrides.mailer ?? resolveMailer(env);

  // getPrisma() wird bewusst erst HIER (lazy) aufgerufen, und nur, wenn kein
  // Test-Override übergeben wurde — dadurch braucht keine Testumgebung
  // einen generierten Prisma Client oder eine echte Datenbank.
  const invitationsService =
    overrides.invitationsService ??
    createInvitationsService({
      clubs: new PrismaClubRepository(getPrisma()),
      invitations: new PrismaInvitationRepository(getPrisma()),
      athletes: new PrismaAthleteRepository(getPrisma()),
      users: new PrismaUserRepository(getPrisma()),
      mailer,
      frontendBaseUrl: env.FRONTEND_BASE_URL,
      clubInvitationTtlDays: CLUB_INVITATION_TTL_DAYS,
      memberInvitationTtlDays: MEMBER_INVITATION_TTL_DAYS,
    });

  const authService =
    overrides.authService ??
    createAuthService({
      users: new PrismaUserRepository(getPrisma()),
      refreshTokens: new PrismaRefreshTokenRepository(getPrisma()),
      // Dieselbe invitationsService-Instanz wie oben (nicht ein zweites,
      // unabhängiges PrismaInvitationRepository) — acceptInvitation() nutzt
      // dadurch exakt deren findValidByToken()/markUsed() statt einer
      // zweiten, potenziell abweichenden Implementierung (siehe
      // AuthServiceDeps.invitations-Kommentar in auth.service.ts).
      invitations: invitationsService,
      profileGateway: new PrismaProfileDataGateway(getPrisma()),
      dataErasureRetentionDays: env.DATA_ERASURE_RETENTION_DAYS,
      keyPair,
      // "Passwort vergessen" (Sicherheitsreview 2026-08, Befund M5) —
      // dieselbe mailer-Instanz wie invitationsService oben (nicht ein
      // zweiter resolveMailer()-Aufruf, der z. B. bei SmtpMailSender einen
      // zweiten, unnötigen Verbindungspool aufbauen würde).
      passwordResetTokens: new PrismaPasswordResetTokenRepository(getPrisma()),
      mailer,
      frontendBaseUrl: env.FRONTEND_BASE_URL,
      passwordResetTtlMinutes: PASSWORD_RESET_TTL_MINUTES,
      accessTtlSeconds: env.JWT_ACCESS_TTL_SECONDS,
      refreshTtlDays: env.JWT_REFRESH_TTL_DAYS,
    });

  const syncService =
    overrides.syncService ??
    createSyncService({ gateway: new PrismaSyncGateway(getPrisma()) });

  await app.register(healthRoutes);
  await app.register(authRoutes, { authService });
  await app.register(syncRoutes, { syncService });
  await app.register(invitationsRoutes, { invitationsService });

  return app;
}
