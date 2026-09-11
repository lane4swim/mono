import { describe, it, expect } from 'vitest';
import { buildApp } from '../../src/app.js';
import { loadEnv } from '../../src/config/env.js';
import { InMemoryClubRepository } from '../../src/modules/invitations/invitations.repository.memory.js';
import { createParentsService } from '../../src/modules/parents/parents.service.js';
import { InMemoryParentLinkRepository } from '../../src/modules/parents/parents.repository.memory.js';
import { InMemoryParentOverviewGateway } from '../../src/modules/parents/parents.overview.repository.memory.js';
import { generateFreshKeyPair, type KeyPair } from '../../src/auth/keys.js';
import { signAccessToken } from '../../src/auth/tokens.js';
import type { ParentChildOverview } from '@lane1/shared-types';

const testEnv = loadEnv({
  NODE_ENV: 'test',
  PORT: '3000',
  DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
  CORS_ORIGIN: 'http://localhost:5173',
});

const CHILD_ID = '11111111-1111-1111-1111-111111111111';

function makeUsers(records: Record<string, { clubId: string | null; roles: string[] }>) {
  return { async findById(id: string) { const r = records[id]; return r ? { id, clubId: r.clubId, roles: r.roles } : null; } };
}
function makeAthletes(records: Record<string, { clubId: string; firstName: string; lastName: string }>) {
  return { async findById(id: string) { const r = records[id]; return r ? { id, ...r } : null; } };
}

async function buildTestApp() {
  const keyPair = generateFreshKeyPair();
  const clubs = new InMemoryClubRepository();
  const club = await clubs.create({ name: 'SV Wasserfreunde', enabledModules: [] });

  const parentLinks = new InMemoryParentLinkRepository();
  await parentLinks.create('parent-1', CHILD_ID);
  const overview: ParentChildOverview = {
    athlete: { id: CHILD_ID, firstName: 'Mara', lastName: 'Vogel', groupId: null, groupName: null },
    upcomingSessions: [],
    upcomingCompetitions: [],
    recentResults: [],
  };
  const parentsService = createParentsService({
    parentLinks,
    overview: new InMemoryParentOverviewGateway(new Map([[CHILD_ID, overview]])),
    users: makeUsers({
      'parent-1': { clubId: club.id, roles: ['parent'] },
      'trainer-1': { clubId: club.id, roles: ['trainer'] },
    }),
    athletes: makeAthletes({ [CHILD_ID]: { clubId: club.id, firstName: 'Mara', lastName: 'Vogel' } }),
  });

  const app = await buildApp(testEnv, { clubs, keyPair, parentsService });
  return { app, keyPair, club };
}

async function tokenFor(keyPair: KeyPair, sub: string, role: string, clubId: string | null) {
  return signAccessToken({ sub, roles: [role] as never, clubId, athleteId: null }, keyPair, 900);
}

describe('GET /api/parents/overview', () => {
  it('liefert die eigenen verknüpften Kinder für Rolle "parent"', async () => {
    const { app, keyPair, club } = await buildTestApp();
    const token = await tokenFor(keyPair, 'parent-1', 'parent', club.id);
    const response = await app.inject({ method: 'GET', url: '/api/parents/overview', headers: { authorization: `Bearer ${token}` } });
    expect(response.statusCode).toBe(200);
    expect(response.json().children).toHaveLength(1);
    expect(response.json().children[0].athlete.id).toBe(CHILD_ID);
    await app.close();
  });

  it('lehnt eine andere Rolle ab (403) — nur "parent" darf diesen Endpunkt nutzen', async () => {
    const { app, keyPair, club } = await buildTestApp();
    const token = await tokenFor(keyPair, 'trainer-1', 'trainer', club.id);
    const response = await app.inject({ method: 'GET', url: '/api/parents/overview', headers: { authorization: `Bearer ${token}` } });
    expect(response.statusCode).toBe(403);
    await app.close();
  });

  it('lehnt eine unauthentifizierte Anfrage ab (401)', async () => {
    const { app } = await buildTestApp();
    const response = await app.inject({ method: 'GET', url: '/api/parents/overview' });
    expect(response.statusCode).toBe(401);
    await app.close();
  });
});

describe('Admin-Verwaltung der Eltern-Kind-Verknüpfungen', () => {
  it('liefert die Verknüpfungen eines parent-Kontos für admin', async () => {
    const { app, keyPair, club } = await buildTestApp();
    const token = await tokenFor(keyPair, 'admin-1', 'admin', club.id);
    const response = await app.inject({ method: 'GET', url: '/api/parents/parent-1/links', headers: { authorization: `Bearer ${token}` } });
    expect(response.statusCode).toBe(200);
    expect(response.json().links).toEqual([{ athleteId: CHILD_ID, firstName: 'Mara', lastName: 'Vogel' }]);
    await app.close();
  });

  it('lehnt den Zugriff für Rolle "trainer" ab (403) — nur admin', async () => {
    const { app, keyPair, club } = await buildTestApp();
    const token = await tokenFor(keyPair, 'trainer-1', 'trainer', club.id);
    const response = await app.inject({ method: 'GET', url: '/api/parents/parent-1/links', headers: { authorization: `Bearer ${token}` } });
    expect(response.statusCode).toBe(403);
    await app.close();
  });

  it('lehnt den Zugriff für Rolle "parent" ab (403) — Verwaltung ist admin-only', async () => {
    const { app, keyPair, club } = await buildTestApp();
    const token = await tokenFor(keyPair, 'parent-1', 'parent', club.id);
    const response = await app.inject({ method: 'GET', url: '/api/parents/parent-1/links', headers: { authorization: `Bearer ${token}` } });
    expect(response.statusCode).toBe(403);
    await app.close();
  });
});
