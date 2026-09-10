import { describe, it, expect } from 'vitest';
import { buildApp } from '../../src/app.js';
import { loadEnv } from '../../src/config/env.js';
import { InMemoryUserRepository } from '../../src/modules/auth/auth.repository.memory.js';
import { InMemoryClubRepository } from '../../src/modules/invitations/invitations.repository.memory.js';
import { InMemoryPushSubscriptionRepository } from '../../src/modules/push/push.repository.memory.js';
import { generateFreshKeyPair, type KeyPair } from '../../src/auth/keys.js';
import { signAccessToken } from '../../src/auth/tokens.js';

const testEnv = loadEnv({
  NODE_ENV: 'test',
  PORT: '3000',
  DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
  CORS_ORIGIN: 'http://localhost:5173',
});

async function buildTestApp() {
  const keyPair = generateFreshKeyPair();
  const users = new InMemoryUserRepository();
  const clubs = new InMemoryClubRepository();
  const club = await clubs.create({ name: 'SV Wasserfreunde', enabledModules: [] });
  const athlete = await users.create({ clubId: club.id, name: 'Anna Athletin', email: 'anna@sv.de', passwordHash: 'x', roles: ['athlete'], consentGivenAt: new Date(), consentVersion: 'v1' });
  const pushSubscriptions = new InMemoryPushSubscriptionRepository();
  const app = await buildApp(testEnv, { clubs, keyPair, pushSubscriptions });
  return { app, keyPair, club, athlete, pushSubscriptions };
}

async function tokenFor(keyPair: KeyPair, sub: string, role: string, clubId: string | null) {
  return signAccessToken({ sub, roles: [role] as never, clubId, athleteId: null }, keyPair, 900);
}

describe('Push-Abos — REST-Endpunkte', () => {
  it('liefert den öffentlichen Schlüssel als null, wenn keine VAPID-Konfiguration gesetzt ist', async () => {
    const { app, keyPair, athlete } = await buildTestApp();
    const token = await tokenFor(keyPair, athlete.id, 'athlete', athlete.clubId);
    const response = await app.inject({ method: 'GET', url: '/api/push/public-key', headers: { authorization: `Bearer ${token}` } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ publicKey: null });
    await app.close();
  });

  it('legt ein Abo an, unabhängig von gebuchten Modulen (kein Modul-Gate)', async () => {
    const { app, keyPair, athlete, pushSubscriptions } = await buildTestApp();
    const token = await tokenFor(keyPair, athlete.id, 'athlete', athlete.clubId);
    const response = await app.inject({
      method: 'POST',
      url: '/api/push/subscriptions',
      headers: { authorization: `Bearer ${token}` },
      payload: { endpoint: 'https://push.example/abc', keys: { p256dh: 'p', auth: 'a' } },
    });
    expect(response.statusCode).toBe(204);
    expect(await pushSubscriptions.listByUserId(athlete.id)).toHaveLength(1);
    await app.close();
  });

  it('entfernt nur das eigene Abo, nicht das eines fremden Kontos mit demselben Endpoint-Aufruf', async () => {
    const { app, keyPair, athlete, pushSubscriptions } = await buildTestApp();
    await pushSubscriptions.upsert('other-user', 'https://push.example/xyz', { p256dh: 'p', auth: 'a' });
    const token = await tokenFor(keyPair, athlete.id, 'athlete', athlete.clubId);
    const response = await app.inject({
      method: 'DELETE',
      url: '/api/push/subscriptions',
      headers: { authorization: `Bearer ${token}` },
      payload: { endpoint: 'https://push.example/xyz' },
    });
    expect(response.statusCode).toBe(204);
    expect(await pushSubscriptions.listByUserId('other-user')).toHaveLength(1);
    await app.close();
  });

  it('lehnt eine ungültige Payload mit 400 ab', async () => {
    const { app, keyPair, athlete } = await buildTestApp();
    const token = await tokenFor(keyPair, athlete.id, 'athlete', athlete.clubId);
    const response = await app.inject({
      method: 'POST',
      url: '/api/push/subscriptions',
      headers: { authorization: `Bearer ${token}` },
      payload: { endpoint: 'not-a-url' },
    });
    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it('lehnt eine unauthentifizierte Anfrage ab', async () => {
    const { app } = await buildTestApp();
    const response = await app.inject({ method: 'GET', url: '/api/push/public-key' });
    expect(response.statusCode).toBe(401);
    await app.close();
  });
});
