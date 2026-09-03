// apps/api/test/qualifications/qualifications.route.test.ts
import { describe, it, expect } from 'vitest';
import { buildApp } from '../../src/app.js';
import { loadEnv } from '../../src/config/env.js';
import { InMemoryUserRepository } from '../../src/modules/auth/auth.repository.memory.js';
import { InMemoryClubRepository } from '../../src/modules/invitations/invitations.repository.memory.js';
import { createQualificationsService } from '../../src/modules/qualifications/qualifications.service.js';
import { InMemoryUserQualificationRepository, InMemoryQualificationReminderSettingRepository } from '../../src/modules/qualifications/qualifications.repository.memory.js';
import { generateFreshKeyPair, type KeyPair } from '../../src/auth/keys.js';
import { signAccessToken } from '../../src/auth/tokens.js';

const testEnv = loadEnv({
  NODE_ENV: 'test',
  PORT: '3000',
  DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
  CORS_ORIGIN: 'http://localhost:5173',
});

async function buildTestApp({ enabledModules = ['qualifications'] }: { enabledModules?: string[] } = {}) {
  const keyPair = generateFreshKeyPair();
  const users = new InMemoryUserRepository();
  const clubs = new InMemoryClubRepository();
  const club = await clubs.create({ name: 'SV Wasserfreunde', enabledModules });

  const admin = await users.create({ clubId: club.id, name: 'Admina Musterfrau', email: 'admin@sv.de', passwordHash: 'x', role: 'admin', consentGivenAt: new Date(), consentVersion: 'v1' });
  const trainer = await users.create({ clubId: club.id, name: 'Trainer Eins', email: 'trainer@sv.de', passwordHash: 'x', role: 'trainer', consentGivenAt: new Date(), consentVersion: 'v1' });

  const qualifications = new InMemoryUserQualificationRepository();
  const reminderSettings = new InMemoryQualificationReminderSettingRepository();
  const qualificationsService = createQualificationsService({ qualifications, reminderSettings, users });

  const app = await buildApp(testEnv, { qualificationsService, clubs, keyPair });
  return { app, keyPair, club, admin, trainer };
}

async function tokenFor(keyPair: KeyPair, sub: string, role: string, clubId: string | null) {
  return signAccessToken({ sub, role: role as never, clubId, athleteId: null }, keyPair, 900);
}

describe('Qualifikationsmanagement — Modul-Gate', () => {
  it('liefert 403, wenn der Verein das Modul "qualifications" nicht gebucht hat', async () => {
    const { app, keyPair, admin } = await buildTestApp({ enabledModules: ['athletes'] });
    const token = await tokenFor(keyPair, admin.id, 'admin', admin.clubId);
    const response = await app.inject({ method: 'GET', url: '/api/me/qualifications', headers: { authorization: `Bearer ${token}` } });
    expect(response.statusCode).toBe(403);
    expect(response.json().error).toBe('module_not_enabled');
    await app.close();
  });

  it('erlaubt den Zugriff, wenn das Modul gebucht ist', async () => {
    const { app, keyPair, admin } = await buildTestApp();
    const token = await tokenFor(keyPair, admin.id, 'admin', admin.clubId);
    const response = await app.inject({ method: 'GET', url: '/api/me/qualifications', headers: { authorization: `Bearer ${token}` } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ qualifications: [] });
    await app.close();
  });

  it('superadmin ist ausgeschlossen (403 durch requireRole, kein eigener Verein)', async () => {
    const { app, keyPair } = await buildTestApp();
    const token = await tokenFor(keyPair, '00000000-0000-0000-0000-000000000099', 'superadmin', null);
    const response = await app.inject({ method: 'GET', url: '/api/me/qualifications', headers: { authorization: `Bearer ${token}` } });
    expect(response.statusCode).toBe(403);
    await app.close();
  });
});

describe('CRUD — nur admin darf schreiben', () => {
  it('admin kann für ein Mitglied des eigenen Vereins eine Qualifikation anlegen, auflisten, bearbeiten und löschen', async () => {
    const { app, keyPair, admin, trainer } = await buildTestApp();
    const adminToken = await tokenFor(keyPair, admin.id, 'admin', admin.clubId);

    const created = await app.inject({
      method: 'POST',
      url: `/api/users/${trainer.id}/qualifications`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { type: 'erste_hilfe', acquiredOn: '2024-01-01T00:00:00.000Z', expiresOn: '2027-01-01T00:00:00.000Z' },
    });
    expect(created.statusCode).toBe(201);
    const qualificationId = created.json().id;

    const list = await app.inject({ method: 'GET', url: `/api/users/${trainer.id}/qualifications`, headers: { authorization: `Bearer ${adminToken}` } });
    expect(list.statusCode).toBe(200);
    expect(list.json().qualifications).toHaveLength(1);

    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/users/${trainer.id}/qualifications/${qualificationId}`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { renewalCourseOrganizedOn: '2026-11-01T00:00:00.000Z' },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().renewalCourseOrganizedOn).toBe('2026-11-01T00:00:00.000Z');

    const deleted = await app.inject({ method: 'DELETE', url: `/api/users/${trainer.id}/qualifications/${qualificationId}`, headers: { authorization: `Bearer ${adminToken}` } });
    expect(deleted.statusCode).toBe(204);

    const listAfterDelete = await app.inject({ method: 'GET', url: `/api/users/${trainer.id}/qualifications`, headers: { authorization: `Bearer ${adminToken}` } });
    expect(listAfterDelete.json().qualifications).toHaveLength(0);
    await app.close();
  });

  it('trainer darf weder anlegen noch die Mitgliederliste eines anderen Kontos einsehen (403)', async () => {
    const { app, keyPair, trainer } = await buildTestApp();
    const trainerToken = await tokenFor(keyPair, trainer.id, 'trainer', trainer.clubId);

    const createAttempt = await app.inject({
      method: 'POST',
      url: `/api/users/${trainer.id}/qualifications`,
      headers: { authorization: `Bearer ${trainerToken}` },
      payload: { type: 'erste_hilfe', acquiredOn: '2024-01-01T00:00:00.000Z' },
    });
    expect(createAttempt.statusCode).toBe(403);

    const listAttempt = await app.inject({ method: 'GET', url: `/api/users/${trainer.id}/qualifications`, headers: { authorization: `Bearer ${trainerToken}` } });
    expect(listAttempt.statusCode).toBe(403);
    await app.close();
  });

  it('lehnt eine Anfrage mit expiresOn vor acquiredOn mit 400 ab', async () => {
    const { app, keyPair, admin, trainer } = await buildTestApp();
    const adminToken = await tokenFor(keyPair, admin.id, 'admin', admin.clubId);
    const response = await app.inject({
      method: 'POST',
      url: `/api/users/${trainer.id}/qualifications`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { type: 'erste_hilfe', acquiredOn: '2027-01-01T00:00:00.000Z', expiresOn: '2024-01-01T00:00:00.000Z' },
    });
    expect(response.statusCode).toBe(400);
    await app.close();
  });
});

describe('Erinnerungs-Schwellen', () => {
  it('admin kann Schwellen für einen Typ setzen und wieder abrufen', async () => {
    const { app, keyPair, admin } = await buildTestApp();
    const adminToken = await tokenFor(keyPair, admin.id, 'admin', admin.clubId);

    const put = await app.inject({
      method: 'PUT',
      url: '/api/qualification-settings/trainer_a',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { thresholdsDays: [90, 30] },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json()).toEqual({ type: 'trainer_a', thresholdsDays: [90, 30] });

    const list = await app.inject({ method: 'GET', url: '/api/qualification-settings', headers: { authorization: `Bearer ${adminToken}` } });
    expect(list.statusCode).toBe(200);
    expect(list.json().settings).toEqual([{ type: 'trainer_a', thresholdsDays: [90, 30] }]);
    expect(list.json().defaultThresholdsDays.length).toBeGreaterThan(0);
    await app.close();
  });

  it('trainer/athlete dürfen die Schwellen lesen (für den eigenen Status-Badge), aber nicht ändern', async () => {
    const { app, keyPair, admin, trainer } = await buildTestApp();
    const adminToken = await tokenFor(keyPair, admin.id, 'admin', admin.clubId);
    await app.inject({
      method: 'PUT',
      url: '/api/qualification-settings/trainer_a',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { thresholdsDays: [90, 30] },
    });

    const trainerToken = await tokenFor(keyPair, trainer.id, 'trainer', trainer.clubId);
    const read = await app.inject({ method: 'GET', url: '/api/qualification-settings', headers: { authorization: `Bearer ${trainerToken}` } });
    expect(read.statusCode).toBe(200);
    expect(read.json().settings).toEqual([{ type: 'trainer_a', thresholdsDays: [90, 30] }]);

    const write = await app.inject({
      method: 'PUT',
      url: '/api/qualification-settings/trainer_a',
      headers: { authorization: `Bearer ${trainerToken}` },
      payload: { thresholdsDays: [10] },
    });
    expect(write.statusCode).toBe(403);
    await app.close();
  });

  it('lehnt einen unbekannten Qualifikationstyp im Pfad ab (400)', async () => {
    const { app, keyPair, admin } = await buildTestApp();
    const adminToken = await tokenFor(keyPair, admin.id, 'admin', admin.clubId);
    const response = await app.inject({
      method: 'PUT',
      url: '/api/qualification-settings/nicht-existent',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { thresholdsDays: [30] },
    });
    expect(response.statusCode).toBe(400);
    await app.close();
  });
});
