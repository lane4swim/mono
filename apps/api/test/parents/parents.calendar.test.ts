// Eltern-Kalender (GET /api/parents/calendar): Datenminimierung in
// shapeChildCalendar() und Zugriff nur für "parent" auf eigene Kinder.
import { describe, it, expect } from 'vitest';
import { buildApp } from '../../src/app.js';
import { loadEnv } from '../../src/config/env.js';
import { InMemoryClubRepository } from '../../src/modules/invitations/invitations.repository.memory.js';
import { createParentsService } from '../../src/modules/parents/parents.service.js';
import { InMemoryParentLinkRepository } from '../../src/modules/parents/parents.repository.memory.js';
import { InMemoryParentOverviewGateway } from '../../src/modules/parents/parents.overview.repository.memory.js';
import { InMemoryParentCalendarGateway } from '../../src/modules/parents/parents.calendar.repository.memory.js';
import { shapeChildCalendar, type RawChildCalendar } from '../../src/modules/parents/parents.calendar.repository.js';
import { generateFreshKeyPair, type KeyPair } from '../../src/auth/keys.js';
import { signAccessToken } from '../../src/auth/tokens.js';

const testEnv = loadEnv({ NODE_ENV: 'test', PORT: '3000', DATABASE_URL: 'postgresql://test:test@localhost:5432/test', CORS_ORIGIN: 'http://localhost:5173' });

const CLUB = '00000000-0000-0000-0000-00000000c1ab';
const OTHER_CLUB = '00000000-0000-0000-0000-00000000c2ab';
const CHILD = '11111111-1111-1111-1111-111111111111';
const SIBLING = '11111111-1111-1111-1111-111111111112';
const OTHER = '11111111-1111-1111-1111-111111111119';
const G_OWN = '22222222-2222-2222-2222-222222222221';
const G_OTHER = '22222222-2222-2222-2222-222222222222';
const id = (n: number) => `33333333-3333-3333-3333-${String(n).padStart(12, '0')}`;
const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const range = { from: d('2026-10-01'), to: d('2026-10-31') };

function raw(athleteId = CHILD): RawChildCalendar {
  const entry = (n: number, over: Partial<RawChildCalendar['calendarEntries'][number]>) => ({
    id: id(n), clubId: CLUB, kind: 'schoolHoliday', title: 'X', startDate: d('2026-10-05'), endDate: d('2026-10-09'), groupId: null,
    weekdays: [], startTime: null, endTime: null, pauseDuring: [], location: '', ...over,
  });
  const comp = (n: number, over: Partial<NonNullable<RawChildCalendar['entries'][number]['competition']>>) => ({
    id: id(n), clubId: CLUB, name: `C${n}`, date: d('2026-10-20'), location: 'Nord', course: 'SCM', entryDeadline: null, selectionDeadline: null, deletedAt: null, ...over,
  });
  return {
    athlete: { id: athleteId, clubId: CLUB, firstName: 'Mara', lastName: 'Vogel', groupId: G_OWN, group: { id: G_OWN, name: 'Nachwuchs' } },
    calendarEntries: [
      entry(1, { title: 'Herbstferien' }),
      entry(2, { kind: 'trainingSlot', title: 'Eigene Gruppe', groupId: G_OWN, startDate: d('2026-09-01'), endDate: d('2027-06-30'), weekdays: [1], startTime: '17:00', endTime: '18:00' }),
      entry(3, { kind: 'trainingCamp', title: 'Fremde Gruppe', groupId: G_OTHER }),
      entry(4, { title: 'Außerhalb', startDate: d('2026-12-20'), endDate: d('2027-01-05') }),
      entry(5, { title: 'Fremder Verein', clubId: OTHER_CLUB }),
    ],
    plans: [
      { id: id(10), clubId: CLUB, name: 'Woche 41', groupId: G_OWN, days: [{ date: '2026-10-06T00:00:00.000Z', sets: [{ kind: 'set', description: 'geheim' }], poolLength: 'SCM' }, { date: '2026-11-20T00:00:00.000Z', sets: [] }] },
      { id: id(11), clubId: CLUB, name: 'Fremde Gruppe', groupId: G_OTHER, days: [{ date: '2026-10-06T00:00:00.000Z', sets: [] }] },
      { id: id(12), clubId: CLUB, name: 'Vereinsweit', groupId: null, days: [{ date: '2026-10-06T00:00:00.000Z', sets: [] }] },
    ],
    sessions: [
      { id: id(20), clubId: CLUB, date: d('2026-10-06'), groupId: G_OWN, attendance: [{ athleteId, present: true, rpe: 8, note: 'müde' }, { athleteId: OTHER, present: false, rpe: null, note: 'krank' }] },
      { id: id(21), clubId: CLUB, date: d('2026-10-07'), groupId: G_OWN, attendance: [{ athleteId: OTHER, present: true }] },
    ],
    entries: [
      { id: id(30), athleteId, competition: comp(31, {}) },
      { id: id(32), athleteId, competition: comp(33, { date: d('2026-12-01'), entryDeadline: d('2026-10-25') }) },
      { id: id(34), athleteId, competition: comp(35, { date: d('2027-02-01') }) },
      { id: id(36), athleteId, competition: comp(37, { deletedAt: d('2026-09-01') }) },
    ],
  };
}

describe('shapeChildCalendar — Datenminimierung', () => {
  const child = shapeChildCalendar(raw(), range);

  it('Saisonplanung: vereinsweit + eigene Gruppe, nur im Zeitraum und eigenen Verein, ohne Notizen', () => {
    expect(child.calendarEntries.map((e) => e.title)).toEqual(['Herbstferien', 'Eigene Gruppe']);
    expect(Object.keys(child.calendarEntries[0]!)).not.toContain('note');
    expect(Object.keys(child.calendarEntries[0]!)).not.toContain('clubId');
  });

  it('Pläne nur der eigenen Gruppe, nur Tage im Zeitraum, ohne Sätze', () => {
    expect(child.plans).toEqual([{ id: id(10), name: 'Woche 41', groupId: G_OWN, days: [{ date: '2026-10-06T00:00:00.000Z' }] }]);
  });

  it('Einheiten nur mit eigener Anwesenheit, ohne RPE/Notizen fremder oder eigener', () => {
    expect(child.sessions).toEqual([{ id: id(20), date: '2026-10-06T00:00:00.000Z', groupId: G_OWN, attendance: [{ athleteId: CHILD, present: true }] }]);
  });

  it('Wettkämpfe mit eigener Meldung, deren Datum oder Frist im Zeitraum liegt; gelöschte nicht', () => {
    expect(child.competitions.map((c) => c.name)).toEqual(['C31', 'C33']);
    expect(child.entries.map((e) => e.competitionId)).toEqual([id(31), id(33)]);
  });

  it('liefert die eigene Gruppe mit Namen', () => {
    expect(child.groups).toEqual([{ id: G_OWN, name: 'Nachwuchs' }]);
  });
});

async function buildTestApp() {
  const keyPair = generateFreshKeyPair();
  const clubs = new InMemoryClubRepository();
  const parentLinks = new InMemoryParentLinkRepository();
  await parentLinks.create('parent-1', CHILD);
  await parentLinks.create('parent-1', SIBLING);
  const parentsService = createParentsService({
    parentLinks,
    overview: new InMemoryParentOverviewGateway(),
    calendar: new InMemoryParentCalendarGateway(new Map([[CHILD, raw(CHILD)], [SIBLING, raw(SIBLING)], [OTHER, raw(OTHER)]])),
    users: { async findById() { return null; } },
    athletes: { async findById() { return null; } },
    auditLog: { record: async () => {} },
  });
  const app = await buildApp(testEnv, { clubs, keyPair, parentsService });
  return { app, keyPair };
}
const tokenFor = (keyPair: KeyPair, sub: string, role: string) => signAccessToken({ sub, roles: [role] as never, clubId: CLUB, athleteId: null }, keyPair, 900);

describe('GET /api/parents/calendar', () => {
  it('liefert die Kalender aller eigenen Kinder — nie fremde', async () => {
    const { app, keyPair } = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/api/parents/calendar?from=2026-10-01&to=2026-10-31', headers: { authorization: `Bearer ${await tokenFor(keyPair, 'parent-1', 'parent')}` } });
    expect(res.statusCode).toBe(200);
    expect(res.json().children.map((c: { athlete: { id: string } }) => c.athlete.id)).toEqual([CHILD, SIBLING]);
    const none = await app.inject({ method: 'GET', url: '/api/parents/calendar?from=2026-10-01&to=2026-10-31', headers: { authorization: `Bearer ${await tokenFor(keyPair, 'parent-2', 'parent')}` } });
    expect(none.json().children).toEqual([]);
    await app.close();
  });

  it('nur Rolle "parent"', async () => {
    const { app, keyPair } = await buildTestApp();
    for (const role of ['trainer', 'admin', 'athlete', 'referee', 'superadmin']) {
      const res = await app.inject({ method: 'GET', url: '/api/parents/calendar?from=2026-10-01&to=2026-10-31', headers: { authorization: `Bearer ${await tokenFor(keyPair, 'parent-1', role)}` } });
      expect(res.statusCode, role).toBe(403);
    }
    const anon = await app.inject({ method: 'GET', url: '/api/parents/calendar?from=2026-10-01&to=2026-10-31' });
    expect(anon.statusCode).toBe(401);
    await app.close();
  });

  it('prüft den Zeitraum (Format, Reihenfolge, Höchstlänge)', async () => {
    const { app, keyPair } = await buildTestApp();
    const auth = { authorization: `Bearer ${await tokenFor(keyPair, 'parent-1', 'parent')}` };
    for (const q of ['from=2026-10-01', 'from=01.10.2026&to=2026-10-31', 'from=2026-10-31&to=2026-10-01', 'from=2024-01-01&to=2026-12-31']) {
      const res = await app.inject({ method: 'GET', url: `/api/parents/calendar?${q}`, headers: auth });
      expect(res.statusCode, q).toBe(400);
    }
    await app.close();
  });
});
