// apps/api/test/auth/auth.route.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { loadEnv } from '../../src/config/env.js';
import { createAuthService } from '../../src/modules/auth/auth.service.js';
import { InMemoryUserRepository, InMemoryRefreshTokenRepository } from '../../src/modules/auth/auth.repository.memory.js';
import { createInvitationsService } from '../../src/modules/invitations/invitations.service.js';
import { InMemoryClubRepository, InMemoryInvitationRepository } from '../../src/modules/invitations/invitations.repository.memory.js';
import { generateFreshKeyPair } from '../../src/auth/keys.js';
import { generateInvitationToken } from '../../src/auth/tokens.js';
import { createSyncService } from '../../src/modules/sync/sync.service.js';
import { InMemorySyncGateway } from '../../src/modules/sync/sync.gateway.memory.js';
import { InMemoryMailSender } from '../../src/mail/mailer.memory.js';
import { InMemoryProfileDataGateway } from '../../src/modules/profile/profile.repository.memory.js';

const testEnv = loadEnv({
  NODE_ENV: 'test',
  PORT: '3000',
  DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
  JWT_SIGNING_KEY: 'a'.repeat(32),
  CORS_ORIGIN: 'http://localhost:5173',
});

const CLUB_ID = '11111111-1111-1111-1111-111111111111';
const INVITER_ID = '99999999-9999-9999-9999-999999999999';

// Baut eine vollständige App mit In-Memory-Repositories für ALLE Module
// (auth + invitations + sync) — buildApp() bräuchte ohne diese Overrides
// einen generierten Prisma Client (siehe app.ts: getPrisma() wird nur
// aufgerufen, wenn kein Override übergeben wird).
async function buildTestApp() {
  const keyPair = generateFreshKeyPair();
  const users = new InMemoryUserRepository();
  const refreshTokens = new InMemoryRefreshTokenRepository();
  const clubs = new InMemoryClubRepository();
  const invitations = new InMemoryInvitationRepository();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const profileDb: any = { users: [], athletes: [], results: [], entries: [], actionItems: [], sessions: [] };

  const authService = createAuthService({
    users, refreshTokens, invitations,
    profileGateway: new InMemoryProfileDataGateway(profileDb),
    dataErasureRetentionDays: 30,
    keyPair, accessTtlSeconds: 900, refreshTtlDays: 30,
  });
  const invitationsService = createInvitationsService({
    clubs,
    invitations,
    mailer: new InMemoryMailSender(),
    frontendBaseUrl: 'https://app.example.org',
    clubInvitationTtlDays: 14,
    memberInvitationTtlDays: 7,
  });
  const syncService = createSyncService({ gateway: new InMemorySyncGateway() });

  // keyPair MUSS mit übergeben werden — sonst würde buildApp() intern sein
  // eigenes (anderes) Entwicklungs-Schlüsselpaar für die Token-Verifikation
  // nutzen, während authService oben mit einem separaten Schlüsselpaar
  // signiert (führt sonst zu 401 auf jeder geschützten Route).
  const app = await buildApp(testEnv, { authService, invitationsService, syncService, keyPair });
  return { app, invitations, profileDb };
}

async function seedInvitationToken(
  invitations: InMemoryInvitationRepository,
  overrides: Partial<{ email: string; role: string; clubId: string | null }> = {},
) {
  const { plainToken, tokenHash, expiresAt } = generateInvitationToken(7);
  await invitations.create({
    tokenHash,
    email: overrides.email ?? 'sabine.reuter@example.org',
    role: overrides.role ?? 'trainer',
    clubId: 'clubId' in overrides ? overrides.clubId! : CLUB_ID,
    athleteId: null,
    invitedById: INVITER_ID,
    expiresAt,
  });
  return plainToken;
}

describe('POST /auth/register (einladungsbasiert)', () => {
  let app: FastifyInstance;
  let invitations: InMemoryInvitationRepository;
  beforeAll(async () => { ({ app, invitations } = await buildTestApp()); });
  afterAll(async () => { await app.close(); });

  it('registriert erfolgreich mit gültigem Einladungs-Token (201)', async () => {
    const token = await seedInvitationToken(invitations, { email: 'neu@example.org' });
    const response = await app.inject({
      method: 'POST', url: '/auth/register',
      payload: { token, name: 'Neue Person', password: 'ein-sicheres-passwort', consent: true },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().user.email).toBe('neu@example.org');
  });

  it('liefert 410 bei unbekanntem/erfundenem Token', async () => {
    const response = await app.inject({
      method: 'POST', url: '/auth/register',
      payload: { token: 'kein-echtes-token', name: 'X', password: 'ein-sicheres-passwort', consent: true },
    });
    expect(response.statusCode).toBe(410);
  });

  it('liefert 410 bei bereits verwendetem Token (kein doppeltes Einlösen)', async () => {
    const token = await seedInvitationToken(invitations, { email: 'einmalig@example.org' });
    await app.inject({ method: 'POST', url: '/auth/register', payload: { token, name: 'X', password: 'ein-sicheres-passwort', consent: true } });
    const second = await app.inject({ method: 'POST', url: '/auth/register', payload: { token, name: 'Y', password: 'ein-anderes-passwort', consent: true } });
    expect(second.statusCode).toBe(410);
  });

  it('liefert 400 bei fehlenden Pflichtfeldern', async () => {
    const response = await app.inject({ method: 'POST', url: '/auth/register', payload: { name: 'X' } });
    expect(response.statusCode).toBe(400);
  });

  it('kein offener Registrierungsweg mehr: ohne Token gibt es keine Möglichkeit, ein Konto anzulegen', async () => {
    // Es existiert schlicht kein Feld, mit dem man Rolle/Verein/E-Mail selbst
    // wählen könnte — das Schema (AcceptInvitationRequestSchema) kennt nur
    // token/name/password. Dieser Test dokumentiert das bewusst.
    const response = await app.inject({
      method: 'POST', url: '/auth/register',
      payload: { name: 'X', password: 'ein-sicheres-passwort', email: 'selbstgewaehlt@example.org', role: 'admin' },
    });
    expect(response.statusCode).toBe(400); // fehlendes token-Feld -> Validierungsfehler
  });
});

describe('POST /auth/login', () => {
  let app: FastifyInstance;
  let invitations: InMemoryInvitationRepository;
  beforeAll(async () => {
    ({ app, invitations } = await buildTestApp());
    const token = await seedInvitationToken(invitations, { email: 'sabine.reuter@example.org' });
    await app.inject({ method: 'POST', url: '/auth/register', payload: { token, name: 'Sabine', password: 'ein-sicheres-passwort', consent: true } });
  });
  afterAll(async () => { await app.close(); });

  it('meldet mit korrekten Zugangsdaten an (200)', async () => {
    const response = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'sabine.reuter@example.org', password: 'ein-sicheres-passwort', consent: true } });
    expect(response.statusCode).toBe(200);
  });

  it('liefert 401 bei falschem Passwort', async () => {
    const response = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'sabine.reuter@example.org', password: 'falsch', consent: true } });
    expect(response.statusCode).toBe(401);
  });
});

describe('Rate-Limiting auf /auth/login', () => {
  it('blockiert nach 5 fehlgeschlagenen Versuchen innerhalb einer Minute (429)', async () => {
    const { app, invitations } = await buildTestApp();
    const token = await seedInvitationToken(invitations, { email: 'ratelimit@example.org' });
    await app.inject({ method: 'POST', url: '/auth/register', payload: { token, name: 'X', password: 'ein-sicheres-passwort', consent: true } });

    const attempt = () => app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'ratelimit@example.org', password: 'falsch', consent: true } });
    const results = [];
    for (let i = 0; i < 6; i++) results.push(await attempt());
    const statusCodes = results.map((r) => r.statusCode);
    expect(statusCodes.slice(0, 5).every((code) => code === 401)).toBe(true);
    expect(statusCodes[5]).toBe(429);

    await app.close();
  });
});

describe('GET/PATCH /api/me (geschützt)', () => {
  let app: FastifyInstance;
  let accessToken: string;

  beforeAll(async () => {
    const built = await buildTestApp();
    app = built.app;
    const token = await seedInvitationToken(built.invitations, { email: 'sabine.reuter@example.org' });
    const registerResponse = await app.inject({ method: 'POST', url: '/auth/register', payload: { token, name: 'Sabine', password: 'ein-sicheres-passwort', consent: true } });
    accessToken = registerResponse.json().accessToken;
  });
  afterAll(async () => { await app.close(); });

  it('liefert 401 ohne Authorization-Header', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/me' });
    expect(response.statusCode).toBe(401);
  });

  it('liefert das eigene Profil mit gültigem Access Token', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/me', headers: { authorization: `Bearer ${accessToken}` } });
    expect(response.statusCode).toBe(200);
    expect(response.json().email).toBe('sabine.reuter@example.org');
  });

  it('aktualisiert den Namen per PATCH', async () => {
    const response = await app.inject({ method: 'PATCH', url: '/api/me', headers: { authorization: `Bearer ${accessToken}` }, payload: { name: 'Geänderter Name' } });
    expect(response.statusCode).toBe(200);
    expect(response.json().name).toBe('Geänderter Name');
  });
});

describe('POST /auth/refresh + /auth/logout', () => {
  let app: FastifyInstance;
  let refreshToken: string;

  beforeAll(async () => {
    const built = await buildTestApp();
    app = built.app;
    const token = await seedInvitationToken(built.invitations, { email: 'sabine.reuter@example.org' });
    const registerResponse = await app.inject({ method: 'POST', url: '/auth/register', payload: { token, name: 'Sabine', password: 'ein-sicheres-passwort', consent: true } });
    refreshToken = registerResponse.json().refreshToken;
  });
  afterAll(async () => { await app.close(); });

  it('stellt mit gültigem Refresh Token neue Tokens aus', async () => {
    const response = await app.inject({ method: 'POST', url: '/auth/refresh', payload: { refreshToken } });
    expect(response.statusCode).toBe(200);
    refreshToken = response.json().refreshToken;
  });

  it('logout invalidiert das Refresh Token', async () => {
    await app.inject({ method: 'POST', url: '/auth/logout', payload: { refreshToken } });
    const response = await app.inject({ method: 'POST', url: '/auth/refresh', payload: { refreshToken } });
    expect(response.statusCode).toBe(401);
  });
});

describe('GET /api/me/export (Art. 15 DSGVO)', () => {
  it('liefert 401 ohne Authentifizierung', async () => {
    const { app } = await buildTestApp();
    const response = await app.inject({ method: 'GET', url: '/api/me/export' });
    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it('liefert das eigene Profil als Export, wenn eingeloggt', async () => {
    const { app, invitations, profileDb } = await buildTestApp();
    const token = await seedInvitationToken(invitations, { email: 'export@example.org' });
    const registerResponse = await app.inject({ method: 'POST', url: '/auth/register', payload: { token, name: 'X', password: 'ein-sicheres-passwort', consent: true } });
    const { accessToken, user } = registerResponse.json();
    profileDb.users.push({ id: user.id, clubId: user.clubId, athleteId: user.athleteId, deletedAt: null, name: user.name, email: user.email });

    const response = await app.inject({ method: 'GET', url: '/api/me/export', headers: { authorization: `Bearer ${accessToken}` } });
    expect(response.statusCode).toBe(200);
    expect(response.json().format).toBe('lane1-user-data-export-v1');
    expect(response.json().user.email).toBe('export@example.org');
    await app.close();
  });
});

describe('DELETE /api/me (Art. 17 DSGVO)', () => {
  it('liefert 401 ohne Authentifizierung', async () => {
    const { app } = await buildTestApp();
    const response = await app.inject({ method: 'DELETE', url: '/api/me' });
    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it('markiert das Konto zur Löschung vor und liefert das purgeAfter-Datum', async () => {
    const { app, invitations, profileDb } = await buildTestApp();
    const token = await seedInvitationToken(invitations, { email: 'delete@example.org' });
    const registerResponse = await app.inject({ method: 'POST', url: '/auth/register', payload: { token, name: 'X', password: 'ein-sicheres-passwort', consent: true } });
    const { accessToken, user } = registerResponse.json();
    profileDb.users.push({ id: user.id, clubId: user.clubId, athleteId: user.athleteId, deletedAt: null, name: user.name, email: user.email });

    const response = await app.inject({ method: 'DELETE', url: '/api/me', headers: { authorization: `Bearer ${accessToken}` } });
    expect(response.statusCode).toBe(200);
    expect(response.json().purgeAfter).toBeTruthy();
    await app.close();
  });

  it('invalidiert alle Refresh Tokens des Kontos', async () => {
    const { app, invitations, profileDb } = await buildTestApp();
    const token = await seedInvitationToken(invitations, { email: 'delete2@example.org' });
    const registerResponse = await app.inject({ method: 'POST', url: '/auth/register', payload: { token, name: 'X', password: 'ein-sicheres-passwort', consent: true } });
    const { accessToken, refreshToken: rt, user } = registerResponse.json();
    profileDb.users.push({ id: user.id, clubId: user.clubId, athleteId: user.athleteId, deletedAt: null, name: user.name, email: user.email });

    await app.inject({ method: 'DELETE', url: '/api/me', headers: { authorization: `Bearer ${accessToken}` } });
    const refreshResponse = await app.inject({ method: 'POST', url: '/auth/refresh', payload: { refreshToken: rt } });
    expect(refreshResponse.statusCode).toBe(401);
    await app.close();
  });

  it('liefert 409 bei einer zweiten Löschanfrage für dasselbe Konto', async () => {
    const { app, invitations, profileDb } = await buildTestApp();
    const token = await seedInvitationToken(invitations, { email: 'delete3@example.org' });
    const registerResponse = await app.inject({ method: 'POST', url: '/auth/register', payload: { token, name: 'X', password: 'ein-sicheres-passwort', consent: true } });
    const { accessToken, user } = registerResponse.json();
    profileDb.users.push({ id: user.id, clubId: user.clubId, athleteId: user.athleteId, deletedAt: null, name: user.name, email: user.email });

    await app.inject({ method: 'DELETE', url: '/api/me', headers: { authorization: `Bearer ${accessToken}` } });
    const second = await app.inject({ method: 'DELETE', url: '/api/me', headers: { authorization: `Bearer ${accessToken}` } });
    expect(second.statusCode).toBe(409);
    await app.close();
  });
});
