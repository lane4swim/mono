import { describe, it, expect } from 'vitest';
import { buildApp } from '../../src/app.js';
import { loadEnv } from '../../src/config/env.js';
import { createAuditLogService } from '../../src/modules/auditLog/auditLog.service.js';
import { InMemoryAuditLogRepository } from '../../src/modules/auditLog/auditLog.repository.memory.js';
import { generateFreshKeyPair, type KeyPair } from '../../src/auth/keys.js';
import { signAccessToken } from '../../src/auth/tokens.js';

const testEnv = loadEnv({
  NODE_ENV: 'test',
  PORT: '3000',
  DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
  CORS_ORIGIN: 'http://localhost:5173',
});

const CLUB_A = '11111111-1111-1111-1111-111111111111';

async function buildTestApp() {
  const keyPair = generateFreshKeyPair();
  const entries = new InMemoryAuditLogRepository();
  const auditLogService = createAuditLogService({ entries });
  await entries.create({ clubId: CLUB_A, actorId: 'admin-1', actorLabel: 'Admina <admin@a.de>', action: 'invitation.created', targetId: 'inv-1', targetLabel: 'neu@a.de', metadata: { role: 'trainer' } });

  const app = await buildApp(testEnv, { auditLogService, keyPair });
  return { app, keyPair, entries };
}

async function tokenFor(keyPair: KeyPair, role: string, clubId: string | null) {
  return signAccessToken({ sub: '00000000-0000-0000-0000-000000000001', roles: [role] as never, clubId, athleteId: null }, keyPair, 900);
}

describe('GET /api/audit-log', () => {
  it('verlangt Authentifizierung', async () => {
    const { app } = await buildTestApp();
    const response = await app.inject({ method: 'GET', url: '/api/audit-log' });
    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it('lehnt trainer/athlete ab (403)', async () => {
    const { app, keyPair } = await buildTestApp();
    for (const role of ['trainer', 'athlete']) {
      const token = await tokenFor(keyPair, role, CLUB_A);
      const response = await app.inject({ method: 'GET', url: '/api/audit-log', headers: { authorization: `Bearer ${token}` } });
      expect(response.statusCode).toBe(403);
    }
    await app.close();
  });

  it('admin sieht die Einträge des eigenen Vereins', async () => {
    const { app, keyPair } = await buildTestApp();
    const token = await tokenFor(keyPair, 'admin', CLUB_A);
    const response = await app.inject({ method: 'GET', url: '/api/audit-log', headers: { authorization: `Bearer ${token}` } });
    expect(response.statusCode).toBe(200);
    expect(response.json().entries).toHaveLength(1);
    expect(response.json().entries[0]).toMatchObject({ action: 'invitation.created', targetLabel: 'neu@a.de' });
  });

  it('superadmin sieht Einträge ohne eigenen Verein', async () => {
    const { app, keyPair } = await buildTestApp();
    const token = await tokenFor(keyPair, 'superadmin', null);
    const response = await app.inject({ method: 'GET', url: '/api/audit-log', headers: { authorization: `Bearer ${token}` } });
    expect(response.statusCode).toBe(200);
    expect(response.json().entries).toHaveLength(1);
  });
});
