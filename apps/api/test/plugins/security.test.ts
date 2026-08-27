// apps/api/test/plugins/security.test.ts
//
// Regressionstests für Patch #5 (Sicherheitsreview, Punkt 4): explizite
// CSP statt Helmet-Defaults, sowie das CORS_ORIGIN="*"-Verbot in
// Produktion (siehe auch test/env.test.ts für die reine env.ts-Logik).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { parseCorsOrigin } from '../../src/plugins/security.js';
import { loadEnv, type Env } from '../../src/config/env.js';
import { createAuthService } from '../../src/modules/auth/auth.service.js';
import { InMemoryUserRepository, InMemoryRefreshTokenRepository, InMemoryPasswordResetTokenRepository } from '../../src/modules/auth/auth.repository.memory.js';
import { createInvitationsService } from '../../src/modules/invitations/invitations.service.js';
import { InMemoryClubRepository, InMemoryInvitationRepository, InMemoryAthleteRepository } from '../../src/modules/invitations/invitations.repository.memory.js';
import { generateFreshKeyPair } from '../../src/auth/keys.js';
import { createSyncService } from '../../src/modules/sync/sync.service.js';
import { InMemorySyncGateway } from '../../src/modules/sync/sync.gateway.memory.js';
import { InMemoryMailSender } from '../../src/mail/mailer.memory.js';
import { InMemoryProfileDataGateway } from '../../src/modules/profile/profile.repository.memory.js';

const testEnv = loadEnv({
  NODE_ENV: 'test',
  PORT: '3000',
  DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
  CORS_ORIGIN: 'http://localhost:5173',
});

// `env`-Parameter (statt fest `testEnv`) — der trustProxy-Testblock unten
// (Sicherheitsreview 2026-08-27, Befund H1) braucht eine eigene, davon
// abweichende TRUSTED_PROXY_IPS-Konfiguration.
async function buildTestApp(env: Env = testEnv): Promise<FastifyInstance> {
  const keyPair = generateFreshKeyPair();
  const invitations = new InMemoryInvitationRepository();
  const invitationsService = createInvitationsService({
    clubs: new InMemoryClubRepository(),
    invitations,
    athletes: new InMemoryAthleteRepository(),
    users: new InMemoryUserRepository(),
    mailer: new InMemoryMailSender(),
    frontendBaseUrl: 'https://app.example.org',
    clubInvitationTtlDays: 14,
    memberInvitationTtlDays: 7,
  });
  const authService = createAuthService({
    users: new InMemoryUserRepository(),
    refreshTokens: new InMemoryRefreshTokenRepository(),
    invitations: invitationsService,
    profileGateway: new InMemoryProfileDataGateway({ users: [], athletes: [], results: [], entries: [], actionItems: [], sessions: [] }),
    clubs: { findById: async () => null },
    dataErasureRetentionDays: 30,
    keyPair,
    passwordResetTokens: new InMemoryPasswordResetTokenRepository(),
    mailer: new InMemoryMailSender(),
    frontendBaseUrl: 'https://app.example.org',
    passwordResetTtlMinutes: 60,
    accessTtlSeconds: 900,
    refreshTtlDays: 30,
  });
  const syncService = createSyncService({ gateway: new InMemorySyncGateway() });
  return buildApp(env, { authService, invitationsService, syncService, clubs: { findById: async () => null }, keyPair });
}

describe('Security-Header (Helmet) — explizite CSP statt Defaults', () => {
  let app: FastifyInstance;

  beforeAll(async () => { app = await buildTestApp(); });
  afterAll(async () => { await app.close(); });

  it('liefert eine restriktive Content-Security-Policy (default-src \'none\')', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });
    const csp = response.headers['content-security-policy'];
    expect(csp).toBeDefined();
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("script-src 'none'");
    expect(csp).toContain("style-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
  });

  it('liefert X-Frame-Options: DENY', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.headers['x-frame-options']).toBe('DENY');
  });

  it('setzt "upgrade-insecure-requests" NICHT in development/test (würde lokales http://localhost brechen)', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });
    const csp = response.headers['content-security-policy'] as string;
    expect(csp).not.toContain('upgrade-insecure-requests');
  });
});

describe('Security-Header (Helmet) — Produktionsmodus', () => {
  let prodApp: FastifyInstance;

  beforeAll(async () => {
    const prodEnv = loadEnv({
      NODE_ENV: 'production',
      PORT: '3000',
      DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
          JWT_PRIVATE_KEY: 'dummy-private-key', // wird wegen keyPair-Override unten nie tatsächlich geparst
      JWT_PUBLIC_KEY: 'dummy-public-key',
      CORS_ORIGIN: 'https://app.lane1.example.org',
      // Sicherheitsreview 2026-08-27, Befund H1: seit diesem Fix in
      // Produktion Pflicht (siehe env.test.ts für die dedizierten Tests
      // dieser Prüfung) — ohne diesen Wert würde bereits loadEnv() hier
      // abbrechen.
      TRUSTED_PROXY_IPS: '127.0.0.1',
    });
    const keyPair = generateFreshKeyPair();
    const invitations = new InMemoryInvitationRepository();
    const invitationsService = createInvitationsService({
      clubs: new InMemoryClubRepository(),
      invitations,
      athletes: new InMemoryAthleteRepository(),
      users: new InMemoryUserRepository(),
      mailer: new InMemoryMailSender(),
      frontendBaseUrl: 'https://app.example.org',
      clubInvitationTtlDays: 14,
      memberInvitationTtlDays: 7,
    });
    const authService = createAuthService({
      users: new InMemoryUserRepository(),
      refreshTokens: new InMemoryRefreshTokenRepository(),
      invitations: invitationsService,
      profileGateway: new InMemoryProfileDataGateway({ users: [], athletes: [], results: [], entries: [], actionItems: [], sessions: [] }),
      clubs: { findById: async () => null },
      dataErasureRetentionDays: 30,
      keyPair,
      passwordResetTokens: new InMemoryPasswordResetTokenRepository(),
      mailer: new InMemoryMailSender(),
      frontendBaseUrl: 'https://app.example.org',
      passwordResetTtlMinutes: 60,
      accessTtlSeconds: 900,
      refreshTtlDays: 30,
    });
    const syncService = createSyncService({ gateway: new InMemorySyncGateway() });
    prodApp = await buildApp(prodEnv, { authService, invitationsService, syncService, clubs: { findById: async () => null }, keyPair });
  });
  afterAll(async () => { await prodApp.close(); });

  it('setzt "upgrade-insecure-requests" in der CSP, wenn NODE_ENV=production', async () => {
    const response = await prodApp.inject({ method: 'GET', url: '/health' });
    const csp = response.headers['content-security-policy'] as string;
    expect(csp).toContain('upgrade-insecure-requests');
  });
});

// Regressionstests für die Code-Review-Korrektur: CORS_ORIGIN wurde
// unverändert als roher String an @fastify/cors weitergereicht — bei
// mehreren, kommagetrennt eingetragenen Origins (die Fehlermeldung in
// env.ts sprach bereits von "Origin(s)", ohne dass mehrere tatsächlich
// funktionierten) matchte @fastify/cors dadurch KEINE davon, da ein
// einzelner String als exakter Vergleichswert behandelt wird, nicht als
// Liste.
// Regressionstests, Teil 1 — Sicherheitsreview 2026-08, Befund H2: ohne
// trustProxy ignoriert Fastify "X-Forwarded-For" komplett — request.ip
// wäre dann für JEDE Anfrage die Adresse des vorgeschalteten Nginx (siehe
// docs/deployment*.md), nicht die des tatsächlichen Clients. Alle
// IP-basierten Rate-Limits kollabierten dadurch auf einen einzigen,
// geteilten Zähler für die gesamte Installation.
//
// Regressionstests, Teil 2 — Sicherheitsreview 2026-08-27, Befund H1: der
// damalige H2-Fix (`trustProxy: true`) vertraute JEDER Adresse in der
// Kette — ein Client konnte damit über einen selbst gesetzten
// "X-Forwarded-For"-Header sein eigenes request.ip frei bestimmen und so
// jedes IP-basierte Rate-Limit umgehen. Dieser Testblock baut die App
// jetzt mit einer KONKRETEN, korrekt konfigurierten Proxy-Adresse
// (TRUSTED_PROXY_IPS statt `trustProxy: true`) und prüft beide Befunde
// zusammen: echte, verschiedene Clients HINTER dem vertrauenswürdigen
// Proxy bekommen weiterhin getrennte Budgets (H2 bleibt behoben), aber
// eine Anfrage, die NICHT von der vertrauenswürdigen Proxy-Adresse kommt
// — oder die (via des vom Client selbst voranstellbaren Präfixes, den
// Nginx per `$proxy_add_x_forwarded_for` nur ANHÄNGT statt zu ersetzen)
// einen frei erfundenen Wert vorschiebt — kann ihr Budget nicht mehr
// durch einen gefälschten Header umgehen (H1 bleibt behoben).
describe('trustProxy — nur die konfigurierte Proxy-Adresse wird vertraut (Sicherheitsreview 2026-08-27, Befund H1)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const env = loadEnv({
      NODE_ENV: 'test',
      PORT: '3000',
      DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
      CORS_ORIGIN: 'http://localhost:5173',
      TRUSTED_PROXY_IPS: '127.0.0.1',
    });
    app = await buildTestApp(env);
  });
  afterAll(async () => { await app.close(); });

  it('zwei unterschiedliche Clients HINTER der vertrauenswürdigen Proxy-Adresse teilen sich NICHT dasselbe /auth/refresh-Budget (10/min)', async () => {
    // remoteAddress simuliert die Verbindung von Nginx (die einzige
    // vertrauenswürdige Adresse); ein einzelner Wert in "X-Forwarded-For"
    // entspricht dem Normalfall (kein weiterer Hop davor) — das ist exakt
    // das, was $proxy_add_x_forwarded_for für einen direkten Browser-
    // Client erzeugt.
    const attempt = (clientIp: string) =>
      app.inject({
        method: 'POST',
        url: '/auth/refresh',
        remoteAddress: '127.0.0.1',
        headers: { 'x-forwarded-for': clientIp },
        payload: { refreshToken: 'ungueltiges-token-fuer-rate-limit-test' },
      });

    const clientA = [];
    for (let i = 0; i < 10; i++) clientA.push(await attempt('203.0.113.10'));
    expect(clientA.every((r) => r.statusCode === 401)).toBe(true);
    // Client A ist jetzt bei seinem 10/10-Limit — der 11. eigene Versuch
    // würde 429 liefern (siehe "Rate-Limiting auf /auth/refresh" oben).

    const clientB = await attempt('203.0.113.20');
    expect(clientB.statusCode).toBe(401);
  });

  it('Befund H1: ein vom Client selbst vorangestellter X-Forwarded-For-Wert wird ignoriert — nur der von Nginx angehängte, echte Wert zählt', async () => {
    const attempt = (spoofedPrefix: string) =>
      app.inject({
        method: 'POST',
        url: '/auth/refresh',
        remoteAddress: '127.0.0.1', // die Verbindung kommt (korrekt) von Nginx
        // Simuliert $proxy_add_x_forwarded_for: Nginx HÄNGT die echte
        // Peer-Adresse an einen bereits vom Client mitgeschickten Wert an,
        // statt ihn zu ersetzen — genau der in Befund H1 beschriebene
        // Angriff.
        headers: { 'x-forwarded-for': `${spoofedPrefix}, 198.51.100.50` },
        payload: { refreshToken: 'ungueltiges-token-fuer-rate-limit-test' },
      });

    for (let i = 0; i < 10; i++) {
      // Jeder Versuch behauptet fälschlich, von einer ANDEREN Adresse zu
      // kommen — ohne den H1-Fix (`trustProxy: true`) bekäme jeder Versuch
      // dadurch sein eigenes, frisches Budget und wäre weiterhin 401.
      const res = await attempt(`203.0.113.${200 + i}`);
      expect(res.statusCode).toBe(401);
    }
    // Mit dem Fix zählt ausschließlich die echte, gleichbleibende Adresse
    // (198.51.100.50) — deren gemeinsames Budget ist nach zehn Versuchen
    // erschöpft, unabhängig vom vorangestellten Fälschungswert.
    const eleventh = await attempt('203.0.113.250');
    expect(eleventh.statusCode).toBe(429);
  });
});

describe('parseCorsOrigin()', () => {
  it('gibt eine einzelne Origin unverändert als 1-elementiges Array zurück', () => {
    expect(parseCorsOrigin('https://training.example.org')).toEqual(['https://training.example.org']);
  });

  it('teilt mehrere kommagetrennte Origins auf und entfernt umgebende Leerzeichen', () => {
    expect(parseCorsOrigin('https://a.example.org, https://b.example.org,https://c.example.org')).toEqual([
      'https://a.example.org',
      'https://b.example.org',
      'https://c.example.org',
    ]);
  });

  // "*" bleibt ein Sonderfall: als roher String an @fastify/cors
  // weitergereicht aktiviert er dessen eingebaute Wildcard-Behandlung; ein
  // Array mit nur dem String "*" würde dagegen als (nie zutreffender)
  // exakter Vergleichswert behandelt.
  it('behandelt "*" als Sonderfall (Wildcard), nicht als Array mit einem Element', () => {
    expect(parseCorsOrigin('*')).toBe('*');
    expect(parseCorsOrigin(' * ')).toBe('*');
  });
});

describe('CORS — mehrere kommagetrennte Origins (End-to-End)', () => {
  let multiOriginApp: FastifyInstance;

  beforeAll(async () => {
    const env = loadEnv({
      NODE_ENV: 'test',
      PORT: '3000',
      DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
      CORS_ORIGIN: 'https://a.example.org,https://b.example.org',
    });
    const keyPair = generateFreshKeyPair();
    const invitations = new InMemoryInvitationRepository();
    const invitationsService = createInvitationsService({
      clubs: new InMemoryClubRepository(),
      invitations,
      athletes: new InMemoryAthleteRepository(),
      users: new InMemoryUserRepository(),
      mailer: new InMemoryMailSender(),
      frontendBaseUrl: 'https://app.example.org',
      clubInvitationTtlDays: 14,
      memberInvitationTtlDays: 7,
    });
    const authService = createAuthService({
      users: new InMemoryUserRepository(),
      refreshTokens: new InMemoryRefreshTokenRepository(),
      invitations: invitationsService,
      profileGateway: new InMemoryProfileDataGateway({ users: [], athletes: [], results: [], entries: [], actionItems: [], sessions: [] }),
      clubs: { findById: async () => null },
      dataErasureRetentionDays: 30,
      keyPair,
      passwordResetTokens: new InMemoryPasswordResetTokenRepository(),
      mailer: new InMemoryMailSender(),
      frontendBaseUrl: 'https://app.example.org',
      passwordResetTtlMinutes: 60,
      accessTtlSeconds: 900,
      refreshTtlDays: 30,
    });
    const syncService = createSyncService({ gateway: new InMemorySyncGateway() });
    multiOriginApp = await buildApp(env, { authService, invitationsService, syncService, clubs: { findById: async () => null }, keyPair });
  });
  afterAll(async () => { await multiOriginApp.close(); });

  it('erlaubt die ERSTE konfigurierte Origin', async () => {
    const response = await multiOriginApp.inject({ method: 'GET', url: '/health', headers: { origin: 'https://a.example.org' } });
    expect(response.headers['access-control-allow-origin']).toBe('https://a.example.org');
  });

  it('erlaubt auch die ZWEITE konfigurierte Origin (vormals nicht möglich)', async () => {
    const response = await multiOriginApp.inject({ method: 'GET', url: '/health', headers: { origin: 'https://b.example.org' } });
    expect(response.headers['access-control-allow-origin']).toBe('https://b.example.org');
  });

  it('lehnt eine NICHT konfigurierte Origin ab', async () => {
    const response = await multiOriginApp.inject({ method: 'GET', url: '/health', headers: { origin: 'https://fremd.example.org' } });
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });
});
