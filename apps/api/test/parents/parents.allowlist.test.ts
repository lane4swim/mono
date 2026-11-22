// Issue #145: freigegebene Felder des Eltern-Zugangs, Altersgrenze und
// Kennzeichnung für Admins.
import { describe, it, expect } from 'vitest';
import {
  ParentChildOverviewSchema,
  ParentCalendarChildSchema,
  ParentLinkSchema,
  type ParentChildOverview,
} from '@lane1/shared-types';
import { createParentsService } from '../../src/modules/parents/parents.service.js';
import { parentLinkAgeStatus } from '../../src/modules/parents/parents.age.js';
import { InMemoryParentLinkRepository } from '../../src/modules/parents/parents.repository.memory.js';
import { InMemoryParentOverviewGateway } from '../../src/modules/parents/parents.overview.repository.memory.js';
import { InMemoryParentCalendarGateway } from '../../src/modules/parents/parents.calendar.repository.memory.js';
import type { RawChildCalendar } from '../../src/modules/parents/parents.calendar.repository.js';

const NO_AUDIT = { record: async () => {} };
const CLUB = '00000000-0000-0000-0000-0000000000c1';
const PARENT = 'parent-1';
const MINOR = '11111111-1111-1111-1111-111111111111';
const ADULT = '22222222-2222-2222-2222-222222222222';
const UNKNOWN_AGE = '33333333-3333-3333-3333-333333333333';
const TODAY = new Date('2026-11-22T10:00:00.000Z');

const keys = (schema: { shape: Record<string, unknown> }) => Object.keys(schema.shape).sort();
// Unterschema eines Arrays von Objekten bzw. eines Objekts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const inner = (schema: any) => (schema.element ?? schema);

describe('Freigegebene Felder (Allowlist)', () => {
  // Bewusst als ausgeschriebene Liste: eine Änderung der Felder, die Eltern
  // sehen, soll diesen Test anfassen müssen.
  it('Übersicht: genau diese Felder', () => {
    const s = ParentChildOverviewSchema.shape;
    expect(keys(ParentChildOverviewSchema)).toEqual(['athlete', 'recentResults', 'upcomingCompetitions', 'upcomingSessions']);
    expect(keys(s.athlete)).toEqual(['firstName', 'groupId', 'groupName', 'id', 'lastName', 'trainerNames']);
    expect(keys(inner(s.upcomingSessions))).toEqual(['date', 'groupName', 'id']);
    expect(keys(inner(s.upcomingCompetitions))).toEqual(['competitionId', 'competitionName', 'date', 'event', 'eventNumber', 'heat', 'lane', 'seedTime']);
    expect(keys(inner(s.recentResults))).toEqual(['date', 'event', 'id', 'isPB', 'status', 'time']);
  });

  it('Kalender: genau diese Felder', () => {
    const s = ParentCalendarChildSchema.shape;
    expect(keys(ParentCalendarChildSchema)).toEqual(['athlete', 'calendarEntries', 'competitions', 'entries', 'groups', 'plans', 'sessions']);
    expect(keys(s.athlete)).toEqual(['firstName', 'groupId', 'id', 'lastName']);
    expect(keys(inner(s.groups))).toEqual(['id', 'name']);
    expect(keys(inner(s.calendarEntries))).toEqual(['endDate', 'groupId', 'id', 'kind', 'location', 'pauseDuring', 'startDate', 'startTime', 'endTime', 'title', 'weekdays'].sort());
    expect(keys(inner(s.plans))).toEqual(['days', 'groupId', 'id', 'name']);
    expect(keys(inner(s.sessions))).toEqual(['attendance', 'date', 'groupId', 'id']);
    expect(keys(inner(inner(s.sessions).shape.attendance))).toEqual(['athleteId', 'present']);
    expect(keys(inner(s.competitions))).toEqual(['course', 'date', 'entryDeadline', 'id', 'location', 'name', 'selectionDeadline']);
    expect(keys(inner(s.entries))).toEqual(['athleteId', 'competitionId', 'id']);
  });

  it('Verknüpfungen (Admin): genau diese Felder', () => {
    expect(keys(ParentLinkSchema)).toEqual(['ageStatus', 'athleteId', 'firstName', 'lastName']);
  });
});

describe('parentLinkAgeStatus()', () => {
  it('volljährig ab dem 18. Geburtstag, am Vortag noch nicht', () => {
    const birthdate = new Date('2008-11-22T00:00:00.000Z');
    expect(parentLinkAgeStatus(birthdate, new Date('2026-11-21T23:59:00.000Z'))).toBe('minor');
    expect(parentLinkAgeStatus(birthdate, new Date('2026-11-22T00:00:00.000Z'))).toBe('adult');
  });

  it('am 29. Februar Geborene sind in Nicht-Schaltjahren ab dem 1. März volljährig', () => {
    const birthdate = new Date('2008-02-29T00:00:00.000Z');
    expect(parentLinkAgeStatus(birthdate, new Date('2026-02-28T12:00:00.000Z'))).toBe('minor');
    expect(parentLinkAgeStatus(birthdate, new Date('2026-03-01T00:00:00.000Z'))).toBe('adult');
  });

  it('ohne Geburtsdatum nicht prüfbar', () => {
    expect(parentLinkAgeStatus(null, TODAY)).toBe('birthdateMissing');
    expect(parentLinkAgeStatus(undefined, TODAY)).toBe('birthdateMissing');
  });
});

function overviewFor(id: string): ParentChildOverview {
  return {
    athlete: { id, firstName: 'Kind', lastName: id.slice(0, 4), groupId: null, groupName: null, trainerNames: [] },
    upcomingSessions: [], upcomingCompetitions: [], recentResults: [],
  };
}

function rawCalendar(id: string): RawChildCalendar {
  return { athlete: { id, clubId: CLUB, firstName: 'Kind', lastName: 'X', groupId: null, group: null }, calendarEntries: [], plans: [], sessions: [], entries: [] };
}

async function makeService(overviews: Map<string, ParentChildOverview> = new Map([MINOR, ADULT, UNKNOWN_AGE].map((id) => [id, overviewFor(id)]))) {
  const parentLinks = new InMemoryParentLinkRepository();
  for (const id of [MINOR, ADULT, UNKNOWN_AGE]) await parentLinks.create(PARENT, id);
  const birthdates: Record<string, Date | null> = {
    [MINOR]: new Date('2012-05-01T00:00:00.000Z'),
    [ADULT]: new Date('2008-01-15T00:00:00.000Z'),
    [UNKNOWN_AGE]: null,
  };
  return createParentsService({
    parentLinks,
    overview: new InMemoryParentOverviewGateway(overviews),
    calendar: new InMemoryParentCalendarGateway(new Map([MINOR, ADULT, UNKNOWN_AGE].map((id) => [id, rawCalendar(id)]))),
    users: { async findById(id) { return id === PARENT ? { id, clubId: CLUB, roles: ['parent'] } : null; } },
    athletes: { async findById(id) { return id in birthdates ? { id, clubId: CLUB, firstName: 'Kind', lastName: id.slice(0, 4), birthdate: birthdates[id] } : null; } },
    auditLog: NO_AUDIT,
    now: () => TODAY,
  });
}

describe('Volljährige Kinder', () => {
  const range = { from: new Date('2026-11-01T00:00:00.000Z'), to: new Date('2026-11-30T00:00:00.000Z') };

  it('erscheinen weder in der Übersicht noch im Kalender; ohne Geburtsdatum bleibt das Kind sichtbar', async () => {
    const service = await makeService();
    const overview = await service.getOverview({ id: PARENT, clubId: CLUB });
    expect(overview.children.map((c) => c.athlete.id).sort()).toEqual([MINOR, UNKNOWN_AGE].sort());
    const calendar = await service.getCalendar({ id: PARENT, clubId: CLUB }, range);
    expect(calendar.children.map((c) => c.athlete.id).sort()).toEqual([MINOR, UNKNOWN_AGE].sort());
  });

  it('sind für Admins in den Verknüpfungen gekennzeichnet', async () => {
    const service = await makeService();
    const links = await service.listLinks(PARENT, { id: 'admin-1', clubId: CLUB });
    expect(Object.fromEntries(links.map((l) => [l.athleteId, l.ageStatus]))).toEqual({
      [MINOR]: 'minor', [ADULT]: 'adult', [UNKNOWN_AGE]: 'birthdateMissing',
    });
  });
});

describe('Nicht freigegebene Felder', () => {
  it('brechen die Antwort ab, statt an Eltern zu gehen', async () => {
    const leaky = overviewFor(MINOR) as ParentChildOverview & { trainerNote?: string };
    (leaky.athlete as Record<string, unknown>).notes = 'interne Notiz';
    const service = await makeService(new Map([[MINOR, leaky]]));
    await expect(service.getOverview({ id: PARENT, clubId: CLUB })).rejects.toThrow();
  });
});
