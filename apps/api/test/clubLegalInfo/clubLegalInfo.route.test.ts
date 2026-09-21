import { describe, it, expect } from 'vitest';
import { buildApp } from '../../src/app.js';
import { loadEnv } from '../../src/config/env.js';
import { createClubLegalInfoService } from '../../src/modules/clubLegalInfo/clubLegalInfo.service.js';
import { InMemoryClubLegalInfoRepository } from '../../src/modules/clubLegalInfo/clubLegalInfo.repository.memory.js';
import { generateFreshKeyPair, type KeyPair } from '../../src/auth/keys.js';
import { signAccessToken } from '../../src/auth/tokens.js';

const testEnv = loadEnv({
  NODE_ENV: 'test',
  PORT: '3000',
  DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
  CORS_ORIGIN: 'http://localhost:5173',
});

const CLUB_A = '11111111-1111-1111-1111-111111111111';
const CLUB_B = '22222222-2222-2222-2222-222222222222';

async function buildTestApp() {
  const keyPair = generateFreshKeyPair();
  const legalInfo = new InMemoryClubLegalInfoRepository();
  legalInfo.seedClub(CLUB_A);
  legalInfo.seedClub(CLUB_B);
  const clubLegalInfoService = createClubLegalInfoService({ legalInfo });

  const app = await buildApp(testEnv, { clubLegalInfoService, keyPair });
  return { app, keyPair, legalInfo };
}

async function tokenFor(keyPair: KeyPair, role: string, clubId: string | null) {
  return signAccessToken({ sub: '00000000-0000-0000-0000-000000000001', roles: [role] as never, clubId, athleteId: null }, keyPair, 900);
}

describe('GET /api/clubs/:id/legal-info', () => {
  it('verlangt Authentifizierung', async () => {
    const { app } = await buildTestApp();
    const response = await app.inject({ method: 'GET', url: `/api/clubs/${CLUB_A}/legal-info` });
    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it('ist für JEDE Rolle des eigenen Vereins erreichbar', async () => {
    const { app, keyPair } = await buildTestApp();
    for (const role of ['admin', 'trainer', 'athlete', 'referee', 'parent']) {
      const token = await tokenFor(keyPair, role, CLUB_A);
      const response = await app.inject({ method: 'GET', url: `/api/clubs/${CLUB_A}/legal-info`, headers: { authorization: `Bearer ${token}` } });
      expect(response.statusCode).toBe(200);
      expect(response.json().legalInfo.clubId).toBe(CLUB_A);
    }
    await app.close();
  });

  it('lehnt den Abruf eines fremden Vereins ab (403)', async () => {
    const { app, keyPair } = await buildTestApp();
    const token = await tokenFor(keyPair, 'admin', CLUB_A);
    const response = await app.inject({ method: 'GET', url: `/api/clubs/${CLUB_B}/legal-info`, headers: { authorization: `Bearer ${token}` } });
    expect(response.statusCode).toBe(403);
    await app.close();
  });

  it('superadmin darf jeden Verein abrufen', async () => {
    const { app, keyPair } = await buildTestApp();
    const token = await tokenFor(keyPair, 'superadmin', null);
    const response = await app.inject({ method: 'GET', url: `/api/clubs/${CLUB_B}/legal-info`, headers: { authorization: `Bearer ${token}` } });
    expect(response.statusCode).toBe(200);
    await app.close();
  });
});

describe('PATCH /api/clubs/:id/legal-info', () => {
  const patchBody = {
    addressLine1: 'Schwimmbadstraße 1',
    postalCode: '12345',
    city: 'Musterstadt',
    representativeName: 'Erika Musterfrau',
    contactEmail: 'vorstand@verein-a.de',
    contactPhone: null,
    registerNumber: 'VR 1234',
    registerCourt: 'Amtsgericht Musterstadt',
    vatId: null,
    privacyContactEmail: null,
    supervisoryAuthority: null,
    dpoRequired: false,
    dpoName: null,
    dpoContact: null,
  };

  it('lehnt trainer/athlete/referee/parent ab (403)', async () => {
    const { app, keyPair } = await buildTestApp();
    for (const role of ['trainer', 'athlete', 'referee', 'parent']) {
      const token = await tokenFor(keyPair, role, CLUB_A);
      const response = await app.inject({
        method: 'PATCH',
        url: `/api/clubs/${CLUB_A}/legal-info`,
        headers: { authorization: `Bearer ${token}` },
        payload: patchBody,
      });
      expect(response.statusCode).toBe(403);
    }
    await app.close();
  });

  it('admin kann die Angaben des eigenen Vereins speichern', async () => {
    const { app, keyPair, legalInfo } = await buildTestApp();
    const token = await tokenFor(keyPair, 'admin', CLUB_A);
    const response = await app.inject({
      method: 'PATCH',
      url: `/api/clubs/${CLUB_A}/legal-info`,
      headers: { authorization: `Bearer ${token}` },
      payload: patchBody,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().legalInfo).toMatchObject(patchBody);
    await expect(legalInfo.findByClubId(CLUB_A)).resolves.toMatchObject(patchBody);
    await app.close();
  });

  it('admin darf NICHT den fremden Verein ändern (403)', async () => {
    const { app, keyPair } = await buildTestApp();
    const token = await tokenFor(keyPair, 'admin', CLUB_A);
    const response = await app.inject({
      method: 'PATCH',
      url: `/api/clubs/${CLUB_B}/legal-info`,
      headers: { authorization: `Bearer ${token}` },
      payload: patchBody,
    });
    expect(response.statusCode).toBe(403);
    await app.close();
  });

  it('lehnt unvollständige Eingaben ab (400)', async () => {
    const { app, keyPair } = await buildTestApp();
    const token = await tokenFor(keyPair, 'admin', CLUB_A);
    const response = await app.inject({
      method: 'PATCH',
      url: `/api/clubs/${CLUB_A}/legal-info`,
      headers: { authorization: `Bearer ${token}` },
      payload: { addressLine1: 'x' },
    });
    expect(response.statusCode).toBe(400);
    await app.close();
  });
});
