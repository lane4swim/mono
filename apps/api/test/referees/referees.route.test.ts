import { describe, it, expect } from 'vitest';
import { buildApp } from '../../src/app.js';
import { loadEnv } from '../../src/config/env.js';
import { InMemoryUserRepository } from '../../src/modules/auth/auth.repository.memory.js';
import { InMemoryClubRepository } from '../../src/modules/invitations/invitations.repository.memory.js';
import { createRefereesService } from '../../src/modules/referees/referees.service.js';
import { InMemoryRefereeAssignmentRepository, InMemoryCompetitionRepository } from '../../src/modules/referees/referees.repository.memory.js';
import { generateFreshKeyPair, type KeyPair } from '../../src/auth/keys.js';
import { signAccessToken } from '../../src/auth/tokens.js';
import { createAuditLogService } from '../../src/modules/auditLog/auditLog.service.js';
import { InMemoryAuditLogRepository } from '../../src/modules/auditLog/auditLog.repository.memory.js';

const testEnv = loadEnv({
  NODE_ENV: 'test',
  PORT: '3000',
  DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
  CORS_ORIGIN: 'http://localhost:5173',
});

const COMPETITION_IN_CLUB = '55555555-5555-5555-5555-555555555555';
const COMPETITION_IN_OTHER_CLUB = '66666666-6666-6666-6666-666666666666';

async function buildTestApp({ enabledModules = ['kampfrichter'] }: { enabledModules?: string[] } = {}) {
  const keyPair = generateFreshKeyPair();
  const users = new InMemoryUserRepository();
  const clubs = new InMemoryClubRepository();
  const club = await clubs.create({ name: 'SV Wasserfreunde', enabledModules });
  const otherClub = await clubs.create({ name: 'Anderer Verein' });

  const admin = await users.create({ clubId: club.id, name: 'Admina Musterfrau', email: 'admin@sv.de', passwordHash: 'x', roles: ['admin'], consentGivenAt: new Date(), consentVersion: 'v1' });
  const referee = await users.create({ clubId: club.id, name: 'Ronja Kampfrichter', email: 'referee@sv.de', passwordHash: 'x', roles: ['referee'], consentGivenAt: new Date(), consentVersion: 'v1' });
  const otherClubReferee = await users.create({ clubId: otherClub.id, name: 'Ben Zwei', email: 'referee@other.de', passwordHash: 'x', roles: ['referee'], consentGivenAt: new Date(), consentVersion: 'v1' });

  const assignments = new InMemoryRefereeAssignmentRepository();
  const competitions = new InMemoryCompetitionRepository([
    { id: COMPETITION_IN_CLUB, clubId: club.id },
    { id: COMPETITION_IN_OTHER_CLUB, clubId: otherClub.id },
  ]);
  const refereesService = createRefereesService({ assignments, users, competitions, auditLog: createAuditLogService({ entries: new InMemoryAuditLogRepository() }) });

  const app = await buildApp(testEnv, { refereesService, clubs, keyPair });
  return { app, keyPair, club, otherClub, admin, referee, otherClubReferee };
}

async function tokenFor(keyPair: KeyPair, sub: string, role: string, clubId: string | null) {
  return signAccessToken({ sub, roles: [role] as never, clubId, athleteId: null }, keyPair, 900);
}

function validPayload(overrides: Record<string, unknown> = {}) {
  return {
    competitionName: 'Kreismeisterschaft',
    date: '2026-03-01T00:00:00.000Z',
    function: 'zeitnehmer',
    ...overrides,
  };
}

describe('Kampfrichter-Modul — Modul-Gate', () => {
  it('liefert 403, wenn der Verein das Modul "kampfrichter" nicht gebucht hat', async () => {
    const { app, keyPair, referee } = await buildTestApp({ enabledModules: ['athletes'] });
    const token = await tokenFor(keyPair, referee.id, 'referee', referee.clubId);
    const response = await app.inject({ method: 'GET', url: '/api/me/referee-assignments', headers: { authorization: `Bearer ${token}` } });
    expect(response.statusCode).toBe(403);
    expect(response.json().error).toBe('module_not_enabled');
    await app.close();
  });

  it('erlaubt den Zugriff, wenn das Modul gebucht ist', async () => {
    const { app, keyPair, referee } = await buildTestApp();
    const token = await tokenFor(keyPair, referee.id, 'referee', referee.clubId);
    const response = await app.inject({ method: 'GET', url: '/api/me/referee-assignments', headers: { authorization: `Bearer ${token}` } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ assignments: [] });
    await app.close();
  });

  it('superadmin ist ausgeschlossen (403, kein eigener Verein)', async () => {
    const { app, keyPair } = await buildTestApp();
    const token = await tokenFor(keyPair, '00000000-0000-0000-0000-000000000099', 'superadmin', null);
    const response = await app.inject({ method: 'GET', url: '/api/me/referee-assignments', headers: { authorization: `Bearer ${token}` } });
    expect(response.statusCode).toBe(403);
    await app.close();
  });

  it('trainer (ohne referee-Rolle) darf die eigene Einsatzliste nicht abrufen (403)', async () => {
    const { app, keyPair, club } = await buildTestApp();
    const token = await tokenFor(keyPair, '00000000-0000-0000-0000-000000000001', 'trainer', club.id);
    const response = await app.inject({ method: 'GET', url: '/api/me/referee-assignments', headers: { authorization: `Bearer ${token}` } });
    expect(response.statusCode).toBe(403);
    await app.close();
  });
});

describe('Selbstverwaltung (referee) — /api/me/referee-assignments', () => {
  it('referee kann eigene Einsätze anlegen, auflisten, bearbeiten und löschen', async () => {
    const { app, keyPair, referee } = await buildTestApp();
    const token = await tokenFor(keyPair, referee.id, 'referee', referee.clubId);

    const created = await app.inject({
      method: 'POST', url: '/api/me/referee-assignments',
      headers: { authorization: `Bearer ${token}` }, payload: validPayload(),
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().createdByAdminId).toBeNull();
    const id = created.json().id;

    const list = await app.inject({ method: 'GET', url: '/api/me/referee-assignments', headers: { authorization: `Bearer ${token}` } });
    expect(list.json().assignments).toHaveLength(1);

    const patched = await app.inject({
      method: 'PATCH', url: `/api/me/referee-assignments/${id}`,
      headers: { authorization: `Bearer ${token}` }, payload: { note: 'Guter Wettkampf' },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().note).toBe('Guter Wettkampf');

    const deleted = await app.inject({ method: 'DELETE', url: `/api/me/referee-assignments/${id}`, headers: { authorization: `Bearer ${token}` } });
    expect(deleted.statusCode).toBe(204);

    const listAfterDelete = await app.inject({ method: 'GET', url: '/api/me/referee-assignments', headers: { authorization: `Bearer ${token}` } });
    expect(listAfterDelete.json().assignments).toHaveLength(0);
    await app.close();
  });

  it('lehnt ein competitionId ab, das zu einem fremden Verein gehört (400)', async () => {
    const { app, keyPair, referee } = await buildTestApp();
    const token = await tokenFor(keyPair, referee.id, 'referee', referee.clubId);
    const response = await app.inject({
      method: 'POST', url: '/api/me/referee-assignments',
      headers: { authorization: `Bearer ${token}` }, payload: validPayload({ competitionId: COMPETITION_IN_OTHER_CLUB }),
    });
    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it('lehnt eine Anfrage ohne competitionName mit 400 ab (Validierung)', async () => {
    const { app, keyPair, referee } = await buildTestApp();
    const token = await tokenFor(keyPair, referee.id, 'referee', referee.clubId);
    const response = await app.inject({
      method: 'POST', url: '/api/me/referee-assignments',
      headers: { authorization: `Bearer ${token}` }, payload: { date: '2026-03-01T00:00:00.000Z', function: 'zeitnehmer' },
    });
    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it('admin darf NICHT über /api/me/referee-assignments schreiben (403, adminGuard verlangt referee-Rolle)', async () => {
    const { app, keyPair, admin } = await buildTestApp();
    const token = await tokenFor(keyPair, admin.id, 'admin', admin.clubId);
    const response = await app.inject({
      method: 'POST', url: '/api/me/referee-assignments',
      headers: { authorization: `Bearer ${token}` }, payload: validPayload(),
    });
    expect(response.statusCode).toBe(403);
    await app.close();
  });
});

describe('Verwaltung im Namen einer Kampfrichter:in (admin) — /api/users/:userId/referee-assignments', () => {
  it('admin kann für ein Vereinsmitglied Einsätze anlegen, auflisten, bearbeiten und löschen', async () => {
    const { app, keyPair, admin, referee } = await buildTestApp();
    const adminToken = await tokenFor(keyPair, admin.id, 'admin', admin.clubId);

    const created = await app.inject({
      method: 'POST', url: `/api/users/${referee.id}/referee-assignments`,
      headers: { authorization: `Bearer ${adminToken}` }, payload: validPayload(),
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().createdByAdminId).toBe(admin.id);
    const id = created.json().id;

    const list = await app.inject({ method: 'GET', url: `/api/users/${referee.id}/referee-assignments`, headers: { authorization: `Bearer ${adminToken}` } });
    expect(list.json().assignments).toHaveLength(1);

    const patched = await app.inject({
      method: 'PATCH', url: `/api/users/${referee.id}/referee-assignments/${id}`,
      headers: { authorization: `Bearer ${adminToken}` }, payload: { note: 'Nachgetragen' },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().note).toBe('Nachgetragen');

    const deleted = await app.inject({ method: 'DELETE', url: `/api/users/${referee.id}/referee-assignments/${id}`, headers: { authorization: `Bearer ${adminToken}` } });
    expect(deleted.statusCode).toBe(204);
    await app.close();
  });

  it('ein admin-seitig angelegter Eintrag lässt sich danach über /api/me weiter bearbeiten, createdByAdminId bleibt bestehen', async () => {
    const { app, keyPair, admin, referee } = await buildTestApp();
    const adminToken = await tokenFor(keyPair, admin.id, 'admin', admin.clubId);
    const refereeToken = await tokenFor(keyPair, referee.id, 'referee', referee.clubId);

    const created = await app.inject({
      method: 'POST', url: `/api/users/${referee.id}/referee-assignments`,
      headers: { authorization: `Bearer ${adminToken}` }, payload: validPayload(),
    });
    const id = created.json().id;

    const selfEdit = await app.inject({
      method: 'PATCH', url: `/api/me/referee-assignments/${id}`,
      headers: { authorization: `Bearer ${refereeToken}` }, payload: { note: 'von mir ergänzt' },
    });
    expect(selfEdit.statusCode).toBe(200);
    expect(selfEdit.json().createdByAdminId).toBe(admin.id);
    expect(selfEdit.json().note).toBe('von mir ergänzt');
    await app.close();
  });

  it('referee (ohne admin-Rolle) darf keine Einsätze im Namen einer anderen Person verwalten (403)', async () => {
    const { app, keyPair, referee, otherClubReferee } = await buildTestApp();
    const token = await tokenFor(keyPair, referee.id, 'referee', referee.clubId);
    const response = await app.inject({
      method: 'POST', url: `/api/users/${otherClubReferee.id}/referee-assignments`,
      headers: { authorization: `Bearer ${token}` }, payload: validPayload(),
    });
    expect(response.statusCode).toBe(403);
    await app.close();
  });

  it('admin darf keine Einsätze für ein Mitglied eines FREMDEN Vereins verwalten (403)', async () => {
    const { app, keyPair, admin, otherClubReferee } = await buildTestApp();
    const adminToken = await tokenFor(keyPair, admin.id, 'admin', admin.clubId);
    const response = await app.inject({
      method: 'POST', url: `/api/users/${otherClubReferee.id}/referee-assignments`,
      headers: { authorization: `Bearer ${adminToken}` }, payload: validPayload(),
    });
    expect(response.statusCode).toBe(403);
    await app.close();
  });

  it('referee kann eine admin-Anfrage über /response zu- oder absagen; ungültiger Status 400', async () => {
    const { app, keyPair, admin, referee } = await buildTestApp();
    const adminToken = await tokenFor(keyPair, admin.id, 'admin', admin.clubId);
    const refereeToken = await tokenFor(keyPair, referee.id, 'referee', referee.clubId);
    const created = await app.inject({ method: 'POST', url: `/api/users/${referee.id}/referee-assignments`, headers: { authorization: `Bearer ${adminToken}` }, payload: validPayload() });
    expect(created.json().status).toBe('requested');
    const id = created.json().id;

    const bad = await app.inject({ method: 'POST', url: `/api/me/referee-assignments/${id}/response`, headers: { authorization: `Bearer ${refereeToken}` }, payload: { status: 'requested' } });
    expect(bad.statusCode).toBe(400);
    const ok = await app.inject({ method: 'POST', url: `/api/me/referee-assignments/${id}/response`, headers: { authorization: `Bearer ${refereeToken}` }, payload: { status: 'confirmed', responseNote: 'Bin dabei' } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ status: 'confirmed', responseNote: 'Bin dabei' });
    const list = await app.inject({ method: 'GET', url: `/api/users/${referee.id}/referee-assignments`, headers: { authorization: `Bearer ${adminToken}` } });
    expect(list.json().assignments[0].status).toBe('confirmed');
    const asAdmin = await app.inject({ method: 'POST', url: `/api/me/referee-assignments/${id}/response`, headers: { authorization: `Bearer ${adminToken}` }, payload: { status: 'declined' } });
    expect(asAdmin.statusCode).toBe(403);
    await app.close();
  });

  it('Rollen-Matrix der Rückmelde-Endpunkte: /response nur referee, /upcoming nur admin (je eigener Verein)', async () => {
    const { app, keyPair, club, otherClub, admin, referee } = await buildTestApp();
    const adminToken = await tokenFor(keyPair, admin.id, 'admin', admin.clubId);
    const created = await app.inject({ method: 'POST', url: `/api/users/${referee.id}/referee-assignments`, headers: { authorization: `Bearer ${adminToken}` }, payload: validPayload({ date: '2099-03-01T00:00:00.000Z' }) });
    const id = created.json().id;
    const someone = '00000000-0000-0000-0000-0000000000bb';
    const cases: Array<[string, string, string | null, number, number]> = [
      // Rolle, sub, clubId, Status /response, Status /upcoming
      ['referee', referee.id, club.id, 200, 403],
      ['admin', admin.id, club.id, 403, 200],
      ['trainer', someone, club.id, 403, 403],
      ['athlete', someone, club.id, 403, 403],
      ['parent', someone, club.id, 403, 403],
      ['superadmin', someone, null, 403, 403],
    ];
    for (const [role, sub, clubId, respondStatus, upcomingStatus] of cases) {
      const token = await tokenFor(keyPair, sub, role, clubId);
      const respond = await app.inject({ method: 'POST', url: `/api/me/referee-assignments/${id}/response`, headers: { authorization: `Bearer ${token}` }, payload: { status: 'confirmed' } });
      expect(respond.statusCode, `/response als ${role}`).toBe(respondStatus);
      const upcoming = await app.inject({ method: 'GET', url: '/api/referee-assignments/upcoming', headers: { authorization: `Bearer ${token}` } });
      expect(upcoming.statusCode, `/upcoming als ${role}`).toBe(upcomingStatus);
      if (upcomingStatus === 200) expect(upcoming.json().assignments.map((a: { id: string }) => a.id)).toEqual([id]);
    }
    // admin eines fremden Vereins sieht die Einsätze dieses Vereins nicht.
    const foreignAdmin = await tokenFor(keyPair, someone, 'admin', otherClub.id);
    const foreign = await app.inject({ method: 'GET', url: '/api/referee-assignments/upcoming', headers: { authorization: `Bearer ${foreignAdmin}` } });
    expect(foreign.statusCode).toBe(200);
    expect(foreign.json().assignments).toEqual([]);
    await app.close();
  });
});
