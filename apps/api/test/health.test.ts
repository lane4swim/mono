// apps/api/test/health.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadEnv } from '../src/config/env.js';
import { createAuthService } from '../src/modules/auth/auth.service.js';
import { InMemoryUserRepository, InMemoryRefreshTokenRepository } from '../src/modules/auth/auth.repository.memory.js';
import { createInvitationsService } from '../src/modules/invitations/invitations.service.js';
import { InMemoryClubRepository, InMemoryInvitationRepository } from '../src/modules/invitations/invitations.repository.memory.js';
import { generateFreshKeyPair } from '../src/auth/keys.js';
import { createSyncService } from '../src/modules/sync/sync.service.js';
import { InMemorySyncGateway } from '../src/modules/sync/sync.gateway.memory.js';
import { InMemoryMailSender } from '../src/mail/mailer.memory.js';
import { InMemoryProfileDataGateway } from '../src/modules/profile/profile.repository.memory.js';

const testEnv = loadEnv({
  NODE_ENV: 'test',
  PORT: '3000',
  DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
  JWT_SIGNING_KEY: 'a'.repeat(32),
  CORS_ORIGIN: 'http://localhost:5173',
});

// Health-Check braucht keine echten Services, aber buildApp() ruft ohne
// Override intern getPrisma() auf (Produktionspfad) — für Tests immer
// In-Memory-Overrides mitgeben, damit kein generierter Prisma Client/keine
// echte Datenbank nötig ist (siehe app.ts).
async function buildTestApp(): Promise<FastifyInstance> {
  const keyPair = generateFreshKeyPair();
  const invitations = new InMemoryInvitationRepository();
  const authService = createAuthService({
    users: new InMemoryUserRepository(),
    refreshTokens: new InMemoryRefreshTokenRepository(),
    invitations,
    profileGateway: new InMemoryProfileDataGateway({ users: [], athletes: [], results: [], entries: [], actionItems: [], sessions: [] }),
    dataErasureRetentionDays: 30,
    keyPair,
    accessTtlSeconds: 900,
    refreshTtlDays: 30,
  });
  const invitationsService = createInvitationsService({
    clubs: new InMemoryClubRepository(),
    invitations,
    mailer: new InMemoryMailSender(),
    frontendBaseUrl: 'https://app.example.org',
    clubInvitationTtlDays: 14,
    memberInvitationTtlDays: 7,
  });
  const syncService = createSyncService({ gateway: new InMemorySyncGateway() });
  return buildApp(testEnv, { authService, invitationsService, syncService, keyPair });
}

describe('GET /health', () => {
  let app: FastifyInstance;

  beforeAll(async () => { app = await buildTestApp(); });
  afterAll(async () => { await app.close(); });

  it('antwortet mit 200 und status: ok', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'ok' });
  });

  it('liefert eine numerische uptimeSeconds mit', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(typeof response.json().uptimeSeconds).toBe('number');
  });
});

describe('Sync-API (Phase 3 — jetzt implementiert, siehe test/sync/*.test.ts für Details)', () => {
  let app: FastifyInstance;

  beforeAll(async () => { app = await buildTestApp(); });
  afterAll(async () => { await app.close(); });

  it('POST /api/sync/push verlangt Authentifizierung (401 ohne Token, nicht mehr 501)', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/sync/push', payload: {} });
    expect(response.statusCode).toBe(401);
  });

  it('GET /api/sync/pull verlangt Authentifizierung (401 ohne Token, nicht mehr 501)', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/sync/pull' });
    expect(response.statusCode).toBe(401);
  });
});

describe('Auth (Phase 1 — jetzt echt implementiert, siehe test/auth/*.test.ts für Details)', () => {
  let app: FastifyInstance;

  beforeAll(async () => { app = await buildTestApp(); });
  afterAll(async () => { await app.close(); });

  it('POST /auth/login mit unbekannten Zugangsdaten liefert 401 (nicht mehr 501)', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'unbekannt@example.org', password: 'irgendwas', consent: true },
    });
    expect(response.statusCode).toBe(401);
  });
});
