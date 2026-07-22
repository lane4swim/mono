// apps/api/test/sync/sync.route.test.ts
import { describe, it, expect } from 'vitest';
import { buildApp } from '../../src/app.js';
import { loadEnv } from '../../src/config/env.js';
import { createAuthService } from '../../src/modules/auth/auth.service.js';
import { InMemoryUserRepository, InMemoryRefreshTokenRepository } from '../../src/modules/auth/auth.repository.memory.js';
import { createInvitationsService } from '../../src/modules/invitations/invitations.service.js';
import { InMemoryClubRepository, InMemoryInvitationRepository, InMemoryAthleteRepository } from '../../src/modules/invitations/invitations.repository.memory.js';
import { createSyncService } from '../../src/modules/sync/sync.service.js';
import { InMemorySyncGateway } from '../../src/modules/sync/sync.gateway.memory.js';
import { InMemoryMailSender } from '../../src/mail/mailer.memory.js';
import { InMemoryProfileDataGateway } from '../../src/modules/profile/profile.repository.memory.js';
import { generateFreshKeyPair, type KeyPair } from '../../src/auth/keys.js';
import { signAccessToken } from '../../src/auth/tokens.js';

const testEnv = loadEnv({
  NODE_ENV: 'test',
  PORT: '3000',
  DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
  JWT_SIGNING_KEY: 'a'.repeat(32),
  CORS_ORIGIN: 'http://localhost:5173',
});

async function buildTestApp() {
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
    athletes: new InMemoryAthleteRepository(),
    mailer: new InMemoryMailSender(),
    frontendBaseUrl: 'https://app.example.org',
    clubInvitationTtlDays: 14,
    memberInvitationTtlDays: 7,
  });
  const gateway = new InMemorySyncGateway();
  const syncService = createSyncService({ gateway });
  const app = await buildApp(testEnv, { authService, invitationsService, syncService, keyPair });
  return { app, gateway, keyPair };
}

async function tokenFor(keyPair: KeyPair, role: string, clubId: string | null, athleteId: string | null = null) {
  return signAccessToken(
    { sub: '00000000-0000-0000-0000-000000000001', role: role as never, clubId, athleteId },
    keyPair,
    900,
  );
}

const CLUB_ID = '11111111-1111-1111-1111-111111111111';

function makeGroupEvent(id: string, overrides: Partial<Record<string, unknown>> = {}) {
  const now = new Date().toISOString();
  const payload = { id, clubId: CLUB_ID, name: 'Leistungsgruppe', description: '', createdAt: now, updatedAt: now, ...overrides };
  return { id: `evt-${id}`, store: 'groups' as const, entityId: id, action: 'create' as const, payload, clientUpdatedAt: payload.updatedAt };
}

describe('POST /api/sync/push', () => {
  it('lehnt nicht authentifizierte Anfragen ab (401)', async () => {
    const { app } = await buildTestApp();
    const response = await app.inject({ method: 'POST', url: '/api/sync/push', payload: { events: [] } });
    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it('lehnt Superadmin ab (403) — Superadmin gehört zu keinem Verein', async () => {
    const { app, keyPair } = await buildTestApp();
    const token = await tokenFor(keyPair, 'superadmin', null);
    const response = await app.inject({
      method: 'POST', url: '/api/sync/push',
      headers: { authorization: `Bearer ${token}` },
      payload: { events: [] },
    });
    expect(response.statusCode).toBe(403);
    await app.close();
  });

  it('wendet ein gültiges create-Event für einen eingeloggten Trainer an (200)', async () => {
    const { app, keyPair, gateway } = await buildTestApp();
    const token = await tokenFor(keyPair, 'trainer', CLUB_ID);
    const event = makeGroupEvent('22222222-2222-2222-2222-222222222222');
    const response = await app.inject({
      method: 'POST', url: '/api/sync/push',
      headers: { authorization: `Bearer ${token}` },
      payload: { events: [event] },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().results).toEqual([{ eventId: event.id, status: 'applied' }]);
    expect(await gateway.findById('groups', event.entityId)).not.toBeNull();
    await app.close();
  });

  it('liefert 400 bei einem leeren events-Array (Schema verlangt mindestens ein Event)', async () => {
    const { app, keyPair } = await buildTestApp();
    const token = await tokenFor(keyPair, 'admin', CLUB_ID);
    const response = await app.inject({
      method: 'POST', url: '/api/sync/push',
      headers: { authorization: `Bearer ${token}` },
      payload: { events: [] },
    });
    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it('athlete-Rolle darf ebenfalls synchronisieren (eigene Trainingsdaten)', async () => {
    const { app, keyPair } = await buildTestApp();
    const token = await tokenFor(keyPair, 'athlete', CLUB_ID);
    const event = makeGroupEvent('33333333-3333-3333-3333-333333333333');
    const response = await app.inject({
      method: 'POST', url: '/api/sync/push',
      headers: { authorization: `Bearer ${token}` },
      payload: { events: [event] },
    });
    expect(response.statusCode).toBe(200);
    await app.close();
  });

  it('athlete-Rolle darf "actionItems" NICHT per Push verändern (Rollen-Scopierung, Patch #6, End-to-End über HTTP)', async () => {
    const { app, keyPair } = await buildTestApp();
    const athleteId = '55555555-5555-5555-5555-555555555555';
    const token = await tokenFor(keyPair, 'athlete', CLUB_ID, athleteId);
    const now = new Date().toISOString();
    const payload = {
      id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', clubId: CLUB_ID, athleteId,
      title: 'X', description: '', category: 'technik', status: 'offen',
      createdDate: now, dueDate: null, createdAt: now, updatedAt: now,
    };
    const event = { id: 'evt-actionitem', store: 'actionItems' as const, entityId: payload.id, action: 'create' as const, payload, clientUpdatedAt: now };
    const response = await app.inject({
      method: 'POST', url: '/api/sync/push',
      headers: { authorization: `Bearer ${token}` },
      payload: { events: [event] },
    });
    expect(response.statusCode).toBe(200); // die HTTP-Antwort selbst ist 200; der Fehler steckt im Event-Ergebnis
    expect(response.json().results[0].status).toBe('error');
    await app.close();
  });
});

describe('GET /api/sync/pull', () => {
  it('lehnt nicht authentifizierte Anfragen ab (401)', async () => {
    const { app } = await buildTestApp();
    const response = await app.inject({ method: 'GET', url: '/api/sync/pull' });
    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it('liefert zuvor gepushte Änderungen zurück (Push-dann-Pull-Rundlauf)', async () => {
    const { app, keyPair } = await buildTestApp();
    const token = await tokenFor(keyPair, 'trainer', CLUB_ID);
    const event = makeGroupEvent('44444444-4444-4444-4444-444444444444');

    await app.inject({
      method: 'POST', url: '/api/sync/push',
      headers: { authorization: `Bearer ${token}` },
      payload: { events: [event] },
    });

    const pullResponse = await app.inject({ method: 'GET', url: '/api/sync/pull', headers: { authorization: `Bearer ${token}` } });
    expect(pullResponse.statusCode).toBe(200);
    const body = pullResponse.json();
    expect(body.changes.some((c: { entityId: string }) => c.entityId === event.entityId)).toBe(true);
    expect(body.hasMore).toBe(false);
    await app.close();
  });

  it('lehnt Superadmin ab (403)', async () => {
    const { app, keyPair } = await buildTestApp();
    const token = await tokenFor(keyPair, 'superadmin', null);
    const response = await app.inject({ method: 'GET', url: '/api/sync/pull', headers: { authorization: `Bearer ${token}` } });
    expect(response.statusCode).toBe(403);
    await app.close();
  });

  it('athlete-Rolle sieht per Pull nur eigene "actionItems" (Rollen-Scopierung, Patch #6, End-to-End über HTTP)', async () => {
    const { app, keyPair, gateway } = await buildTestApp();
    const athleteId = '55555555-5555-5555-5555-555555555555';
    const foreignAthleteId = '66666666-6666-6666-6666-666666666666';
    const now = new Date();
    gateway.seed('actionItems', {
      id: 'own-item', clubId: CLUB_ID, athleteId, title: 'Eigenes Ziel', description: '', category: 'technik',
      status: 'offen', createdDate: now, dueDate: null, createdAt: now, updatedAt: now, deletedAt: null,
    });
    gateway.seed('actionItems', {
      id: 'foreign-item', clubId: CLUB_ID, athleteId: foreignAthleteId, title: 'Fremdes Ziel', description: '', category: 'technik',
      status: 'offen', createdDate: now, dueDate: null, createdAt: now, updatedAt: now, deletedAt: null,
    });

    const token = await tokenFor(keyPair, 'athlete', CLUB_ID, athleteId);
    const response = await app.inject({ method: 'GET', url: '/api/sync/pull', headers: { authorization: `Bearer ${token}` } });
    expect(response.statusCode).toBe(200);
    const entityIds = response.json().changes.map((c: { entityId: string }) => c.entityId);
    expect(entityIds).toContain('own-item');
    expect(entityIds).not.toContain('foreign-item');
    await app.close();
  });
});
