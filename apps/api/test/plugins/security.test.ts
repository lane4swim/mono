// apps/api/test/plugins/security.test.ts
//
// Regressionstests für Patch #5 (Sicherheitsreview, Punkt 4): explizite
// CSP statt Helmet-Defaults, sowie das CORS_ORIGIN="*"-Verbot in
// Produktion (siehe auch test/env.test.ts für die reine env.ts-Logik).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { parseCorsOrigin } from '../../src/plugins/security.js';
import { loadEnv } from '../../src/config/env.js';
import { createAuthService } from '../../src/modules/auth/auth.service.js';
import { InMemoryUserRepository, InMemoryRefreshTokenRepository } from '../../src/modules/auth/auth.repository.memory.js';
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

async function buildTestApp(): Promise<FastifyInstance> {
  const keyPair = generateFreshKeyPair();
  const invitations = new InMemoryInvitationRepository();
  const invitationsService = createInvitationsService({
    clubs: new InMemoryClubRepository(),
    invitations,
    athletes: new InMemoryAthleteRepository(),
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
    dataErasureRetentionDays: 30,
    keyPair,
    accessTtlSeconds: 900,
    refreshTtlDays: 30,
  });
  const syncService = createSyncService({ gateway: new InMemorySyncGateway() });
  return buildApp(testEnv, { authService, invitationsService, syncService, keyPair });
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
    });
    const keyPair = generateFreshKeyPair();
    const invitations = new InMemoryInvitationRepository();
    const invitationsService = createInvitationsService({
      clubs: new InMemoryClubRepository(),
      invitations,
      athletes: new InMemoryAthleteRepository(),
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
      dataErasureRetentionDays: 30,
      keyPair,
      accessTtlSeconds: 900,
      refreshTtlDays: 30,
    });
    const syncService = createSyncService({ gateway: new InMemorySyncGateway() });
    prodApp = await buildApp(prodEnv, { authService, invitationsService, syncService, keyPair });
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
      dataErasureRetentionDays: 30,
      keyPair,
      accessTtlSeconds: 900,
      refreshTtlDays: 30,
    });
    const syncService = createSyncService({ gateway: new InMemorySyncGateway() });
    multiOriginApp = await buildApp(env, { authService, invitationsService, syncService, keyPair });
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
