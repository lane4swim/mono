import { describe, it, expect } from 'vitest';
import { buildApp } from '../../src/app.js';
import { loadEnv } from '../../src/config/env.js';
import { createAuditLogService } from '../../src/modules/auditLog/auditLog.service.js';
import { InMemoryAuditLogRepository } from '../../src/modules/auditLog/auditLog.repository.memory.js';
import { InMemoryJobStateRepository } from '../../src/jobs/scheduler/jobState.repository.memory.js';
import type { JobStateRecord, JobStateRepository } from '../../src/jobs/scheduler/jobState.repository.js';
import { generateFreshKeyPair, type KeyPair } from '../../src/auth/keys.js';
import { signAccessToken } from '../../src/auth/tokens.js';

const testEnv = loadEnv({
  NODE_ENV: 'test',
  PORT: '3000',
  DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
  CORS_ORIGIN: 'http://localhost:5173',
});

const CLUB_A = '11111111-1111-1111-1111-111111111111';

async function buildTestApp(jobStates: JobStateRepository = new InMemoryJobStateRepository()) {
  const keyPair = generateFreshKeyPair();
  const auditLogService = createAuditLogService({ entries: new InMemoryAuditLogRepository() });
  const app = await buildApp(testEnv, { auditLogService, keyPair, jobStates });
  return { app, keyPair };
}

async function tokenFor(keyPair: KeyPair, role: string, clubId: string | null) {
  return signAccessToken({ sub: '00000000-0000-0000-0000-000000000001', roles: [role] as never, clubId, athleteId: null }, keyPair, 900);
}

describe('GET /api/admin/jobs', () => {
  it('verlangt Authentifizierung', async () => {
    const { app } = await buildTestApp();
    expect((await app.inject({ method: 'GET', url: '/api/admin/jobs' })).statusCode).toBe(401);
    await app.close();
  });

  it('ist nur für superadmin zugänglich (admin/trainer: 403)', async () => {
    const { app, keyPair } = await buildTestApp();
    for (const role of ['admin', 'trainer']) {
      const token = await tokenFor(keyPair, role, CLUB_A);
      const response = await app.inject({ method: 'GET', url: '/api/admin/jobs', headers: { authorization: `Bearer ${token}` } });
      expect(response.statusCode).toBe(403);
    }
    await app.close();
  });

  it('listet alle Jobs mit letztem Lauf, auch solche, die noch nie liefen', async () => {
    const jobStates = new InMemoryJobStateRepository();
    const lastStartedAt = new Date(Date.now() - 60_000);
    jobStates.seed({ name: 'purge-deleted-data', lastStartedAt, lastFinishedAt: new Date(), lastStatus: 'success', lastSummary: { purgedAccounts: 2 } });
    const { app, keyPair } = await buildTestApp(jobStates);
    const token = await tokenFor(keyPair, 'superadmin', null);
    const response = await app.inject({ method: 'GET', url: '/api/admin/jobs', headers: { authorization: `Bearer ${token}` } });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.schedulerEnabled).toBe(true);
    expect(body.jobs.map((j: { name: string }) => j.name)).toEqual(['purge-deleted-data', 'notify-expiring-qualifications', 'notify-upcoming-sessions']);
    expect(body.jobs[0]).toMatchObject({
      schedule: { kind: 'daily', hourUtc: 2 },
      lastStatus: 'success',
      lastSummary: { purgedAccounts: 2 },
      lastStartedAt: lastStartedAt.toISOString(),
      running: false,
      stale: false,
    });
    expect(body.jobs[1]).toMatchObject({ lastStartedAt: null, lastStatus: null, stale: false });
    await app.close();
  });
});

describe('GET /health — jobs', () => {
  it('meldet "ok", solange kein Job auffällig ist', async () => {
    const { app } = await buildTestApp();
    expect((await app.inject({ method: 'GET', url: '/health' })).json()).toMatchObject({ status: 'ok', jobs: 'ok' });
    await app.close();
  });

  it('meldet "stale" ohne Details, wenn ein Job wiederholt fehlschlägt', async () => {
    const jobStates = new InMemoryJobStateRepository();
    jobStates.seed({ name: 'purge-deleted-data', lastStartedAt: new Date(), lastStatus: 'failed', lastError: 'geheim', consecutiveFailures: 3 });
    const { app } = await buildTestApp(jobStates);
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.json()).toMatchObject({ status: 'ok', jobs: 'stale' });
    expect(response.body).not.toContain('geheim');
    await app.close();
  });

  it('meldet "unknown", wenn der Jobzustand nicht lesbar ist, und bleibt erreichbar', async () => {
    const broken: JobStateRepository = {
      list: async (): Promise<JobStateRecord[]> => { throw new Error('connection refused'); },
      tryAcquire: async () => false,
      release: async () => {},
    };
    const { app } = await buildTestApp(broken);
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'ok', jobs: 'unknown' });
    await app.close();
  });
});
