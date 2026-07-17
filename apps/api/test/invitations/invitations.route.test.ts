// apps/api/test/invitations/invitations.route.test.ts
import { describe, it, expect } from 'vitest';
import { buildApp } from '../../src/app.js';
import { loadEnv } from '../../src/config/env.js';
import { createAuthService } from '../../src/modules/auth/auth.service.js';
import { InMemoryUserRepository, InMemoryRefreshTokenRepository } from '../../src/modules/auth/auth.repository.memory.js';
import { createInvitationsService } from '../../src/modules/invitations/invitations.service.js';
import { InMemoryClubRepository, InMemoryInvitationRepository } from '../../src/modules/invitations/invitations.repository.memory.js';
import { createSyncService } from '../../src/modules/sync/sync.service.js';
import { InMemorySyncGateway } from '../../src/modules/sync/sync.gateway.memory.js';
import { InMemoryMailSender } from '../../src/mail/mailer.memory.js';
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
  const users = new InMemoryUserRepository();
  const refreshTokens = new InMemoryRefreshTokenRepository();
  const clubs = new InMemoryClubRepository();
  const invitations = new InMemoryInvitationRepository();
  const mailer = new InMemoryMailSender();

  const authService = createAuthService({ users, refreshTokens, invitations, keyPair, accessTtlSeconds: 900, refreshTtlDays: 30 });
  const invitationsService = createInvitationsService({
    clubs, invitations, mailer, frontendBaseUrl: 'https://app.example.org',
    clubInvitationTtlDays: 14, memberInvitationTtlDays: 7,
  });
  const syncService = createSyncService({ gateway: new InMemorySyncGateway() });

  const app = await buildApp(testEnv, { authService, invitationsService, syncService, keyPair });
  return { app, keyPair, clubs, invitations, mailer };
}

// Baut ein gültiges Access Token für eine Rolle, ohne den kompletten
// Registrierungs-Flow durchlaufen zu müssen — die Route-Handler prüfen nur
// die Claims (sub/role/clubId), nicht ob der Nutzer "echt" via Einladung
// entstanden ist. WICHTIG: eine referenzierte clubId muss trotzdem über
// `clubs.create()` tatsächlich existieren, da der Service das prüft
// (siehe invitations.service.ts: ClubNotFoundError).
async function tokenFor(keyPair: KeyPair, role: string, clubId: string | null) {
  return signAccessToken(
    { sub: '00000000-0000-0000-0000-000000000001', role: role as never, clubId, athleteId: null },
    keyPair,
    900,
  );
}

describe('POST /api/clubs (nur superadmin)', () => {
  it('superadmin kann einen Verein anlegen (201) und die Einladungs-E-Mail wird versendet', async () => {
    const { app, keyPair, mailer } = await buildTestApp();
    const token = await tokenFor(keyPair, 'superadmin', null);
    const response = await app.inject({
      method: 'POST',
      url: '/api/clubs',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'SV Wasserfreunde', adminEmail: 'admin@sv.de', adminName: 'Petra Klein' },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().invitation.token).toBeTruthy();
    expect(mailer.sentEmails).toHaveLength(1);
    expect(mailer.sentEmails[0]).toMatchObject({ to: 'admin@sv.de', role: 'admin', clubName: 'SV Wasserfreunde' });
    await app.close();
  });

  it('admin darf keinen Verein anlegen (403)', async () => {
    const { app, keyPair, clubs } = await buildTestApp();
    const club = await clubs.create({ name: 'Club A' });
    const token = await tokenFor(keyPair, 'admin', club.id);
    const response = await app.inject({
      method: 'POST',
      url: '/api/clubs',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'X', adminEmail: 'a@b.de', adminName: 'Y' },
    });
    expect(response.statusCode).toBe(403);
    await app.close();
  });

  it('ohne Authentifizierung: 401', async () => {
    const { app } = await buildTestApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/clubs',
      payload: { name: 'X', adminEmail: 'a@b.de', adminName: 'Y' },
    });
    expect(response.statusCode).toBe(401);
    await app.close();
  });
});

describe('GET /api/clubs (nur superadmin, mit Mitgliederzahlen)', () => {
  it('liefert die Vereinsliste inkl. memberCounts für die Superadmin-Oberfläche', async () => {
    const { app, keyPair } = await buildTestApp();
    const token = await tokenFor(keyPair, 'superadmin', null);
    await app.inject({
      method: 'POST', url: '/api/clubs',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'SV Wasserfreunde', adminEmail: 'admin@sv.de', adminName: 'Petra Klein' },
    });

    const response = await app.inject({ method: 'GET', url: '/api/clubs', headers: { authorization: `Bearer ${token}` } });
    expect(response.statusCode).toBe(200);
    const { clubs } = response.json();
    expect(clubs).toHaveLength(1);
    expect(clubs[0].memberCounts).toEqual({ admin: 0, trainer: 0, athlete: 0 }); // Admin hat die Einladung noch nicht angenommen
    await app.close();
  });

  it('lehnt admin ab (403) — nur superadmin darf alle Vereine mit Mitgliederzahlen einsehen', async () => {
    const { app, keyPair, clubs } = await buildTestApp();
    const club = await clubs.create({ name: 'Club A' });
    const token = await tokenFor(keyPair, 'admin', club.id);
    const response = await app.inject({ method: 'GET', url: '/api/clubs', headers: { authorization: `Bearer ${token}` } });
    expect(response.statusCode).toBe(403);
    await app.close();
  });
});

describe('POST /api/invitations (admin/superadmin)', () => {
  it('admin kann eine trainer-Einladung für den eigenen (bestehenden) Verein ausstellen (201)', async () => {
    const { app, keyPair, clubs } = await buildTestApp();
    const club = await clubs.create({ name: 'Club A' });
    const token = await tokenFor(keyPair, 'admin', club.id);
    const response = await app.inject({
      method: 'POST',
      url: '/api/invitations',
      headers: { authorization: `Bearer ${token}` },
      payload: { email: 'trainer@example.org', role: 'trainer' },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().clubId).toBe(club.id);
    await app.close();
  });

  it('admin darf keine admin-Einladung ausstellen (403)', async () => {
    const { app, keyPair, clubs } = await buildTestApp();
    const club = await clubs.create({ name: 'Club A' });
    const token = await tokenFor(keyPair, 'admin', club.id);
    const response = await app.inject({
      method: 'POST',
      url: '/api/invitations',
      headers: { authorization: `Bearer ${token}` },
      payload: { email: 'x@y.de', role: 'admin' },
    });
    expect(response.statusCode).toBe(403);
    await app.close();
  });

  it('trainer/athlete dürfen niemanden einladen (403)', async () => {
    const { app, keyPair, clubs } = await buildTestApp();
    const club = await clubs.create({ name: 'Club A' });
    const trainerToken = await tokenFor(keyPair, 'trainer', club.id);
    const response = await app.inject({
      method: 'POST',
      url: '/api/invitations',
      headers: { authorization: `Bearer ${trainerToken}` },
      payload: { email: 'x@y.de', role: 'trainer' },
    });
    expect(response.statusCode).toBe(403);
    await app.close();
  });

  it('liefert 404, wenn superadmin eine Einladung für einen nicht existierenden Verein ausstellen will', async () => {
    const { app, keyPair } = await buildTestApp();
    const token = await tokenFor(keyPair, 'superadmin', null);
    const response = await app.inject({
      method: 'POST',
      url: '/api/invitations',
      headers: { authorization: `Bearer ${token}` },
      payload: { email: 'x@y.de', role: 'admin', clubId: '00000000-0000-0000-0000-000000000000' },
    });
    expect(response.statusCode).toBe(404);
    await app.close();
  });
});

describe('GET /api/invitations/preview/:token (öffentlich)', () => {
  it('liefert eine Vorschau ohne Authentifizierung', async () => {
    const { app, keyPair, clubs } = await buildTestApp();
    const club = await clubs.create({ name: 'SV Wasserfreunde' });
    const superadminToken = await tokenFor(keyPair, 'superadmin', null);
    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/invitations',
      headers: { authorization: `Bearer ${superadminToken}` },
      payload: { email: 'trainer@sv.de', role: 'trainer', clubId: club.id },
    });
    const { token: invitationToken } = createResponse.json();

    const preview = await app.inject({ method: 'GET', url: `/api/invitations/preview/${invitationToken}` });
    expect(preview.statusCode).toBe(200);
    expect(preview.json().clubName).toBe('SV Wasserfreunde');
    await app.close();
  });

  it('liefert 410 für ein unbekanntes Token', async () => {
    const { app } = await buildTestApp();
    const response = await app.inject({ method: 'GET', url: '/api/invitations/preview/nicht-echt' });
    expect(response.statusCode).toBe(410);
    await app.close();
  });
});

describe('GET /api/invitations (Auflistung)', () => {
  it('admin sieht nur eigene Vereinseinladungen', async () => {
    const { app, keyPair, clubs } = await buildTestApp();
    const clubA = await clubs.create({ name: 'Club A' });
    const adminAToken = await tokenFor(keyPair, 'admin', clubA.id);
    await app.inject({
      method: 'POST',
      url: '/api/invitations',
      headers: { authorization: `Bearer ${adminAToken}` },
      payload: { email: 'trainer@a.de', role: 'trainer' },
    });

    const listResponse = await app.inject({
      method: 'GET',
      url: '/api/invitations',
      headers: { authorization: `Bearer ${adminAToken}` },
    });
    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json().invitations).toHaveLength(1);
    await app.close();
  });
});

describe('DELETE /api/invitations/:id (widerrufen)', () => {
  it('admin kann eine eigene Einladung widerrufen (204); sie ist danach ungültig', async () => {
    const { app, keyPair, clubs } = await buildTestApp();
    const club = await clubs.create({ name: 'Club A' });
    const adminToken = await tokenFor(keyPair, 'admin', club.id);
    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/invitations',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { email: 'trainer@a.de', role: 'trainer' },
    });
    const { id, token: invitationToken } = createResponse.json();

    const revokeResponse = await app.inject({
      method: 'DELETE',
      url: `/api/invitations/${id}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(revokeResponse.statusCode).toBe(204);

    const previewAfterRevoke = await app.inject({ method: 'GET', url: `/api/invitations/preview/${invitationToken}` });
    expect(previewAfterRevoke.statusCode).toBe(410);
    await app.close();
  });
});
