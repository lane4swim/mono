// Reine Logik des Kalendermoduls (js/modules/calendarEvents.js):
// Zeiträume der Ansichten und das Zusammenführen/Filtern der Termine je
// Person ("Meine Termine" vs. "Ganzer Verein").
import { describe, it, expect } from 'vitest';
import {
  periodRange, shiftAnchor, monthGridDays, isoWeek, quarterOf, personalContext, collectEvents,
  eventsInRange, countByType, EVENT_TYPES,
} from '../js/modules/calendarEvents.js';

describe('Zeiträume', () => {
  it('Woche: Montag bis Sonntag', () => {
    expect(periodRange('week', '2026-10-15')).toEqual({ start: '2026-10-12', end: '2026-10-18' });
    expect(periodRange('week', '2026-10-18')).toEqual({ start: '2026-10-12', end: '2026-10-18' });
  });

  it('Monat, Quartal und Jahr', () => {
    expect(periodRange('month', '2026-02-10')).toEqual({ start: '2026-02-01', end: '2026-02-28' });
    expect(periodRange('month', '2028-02-10')).toEqual({ start: '2028-02-01', end: '2028-02-29' });
    expect(periodRange('quarter', '2026-11-30')).toEqual({ start: '2026-10-01', end: '2026-12-31' });
    expect(periodRange('quarter', '2026-01-01')).toEqual({ start: '2026-01-01', end: '2026-03-31' });
    expect(periodRange('year', '2026-06-15')).toEqual({ start: '2026-01-01', end: '2026-12-31' });
    expect(quarterOf('2026-04-01')).toBe(2);
  });

  it('Blättern springt bei Monatsansichten auf den Monatsersten (kein Überlauf vom 31. Januar in den März)', () => {
    expect(shiftAnchor('month', '2026-01-31', 1)).toBe('2026-02-01');
    expect(shiftAnchor('month', '2026-01-15', -1)).toBe('2025-12-01');
    expect(shiftAnchor('quarter', '2026-11-20', 1)).toBe('2027-02-01');
    expect(shiftAnchor('year', '2026-10-15', -1)).toBe('2025-10-01');
    expect(shiftAnchor('week', '2026-12-30', 1)).toBe('2027-01-06');
  });

  it('Monatsraster besteht aus vollen Wochen ab Montag', () => {
    const days = monthGridDays('2026-10-15');
    expect(days.length % 7).toBe(0);
    expect(days[0]).toBe('2026-09-28'); // Montag vor dem 1. Oktober (Donnerstag)
    expect(days.at(-1)).toBe('2026-11-01'); // Sonntag nach dem 31. Oktober (Samstag)
  });

  it('ISO-Kalenderwoche', () => {
    expect(isoWeek('2026-01-01')).toBe(1); // Donnerstag -> KW 1
    expect(isoWeek('2026-10-15')).toBe(42);
    expect(isoWeek('2027-01-01')).toBe(53); // Freitag -> gehört zur KW 53/2026
    expect(isoWeek('2024-12-30')).toBe(1); // Montag -> KW 1/2025
  });
});

// ---- Fixtures --------------------------------------------------------------
const TRAINER = { id: 'u-trainer', athleteId: null };
const OTHER_TRAINER = 'u-other';
const MAYA_USER = { id: 'u-maya', athleteId: 'a-maya' };

const groups = [
  { id: 'g-a', name: 'Leistungsgruppe', trainerIds: [TRAINER.id] },
  { id: 'g-b', name: 'Nachwuchs', trainerIds: [OTHER_TRAINER] },
];
const athletes = [
  { id: 'a-maya', firstName: 'Maya', lastName: 'Vogel', groupId: 'g-a' },
  { id: 'a-lukas', firstName: 'Lukas', lastName: 'Weber', groupId: 'g-b' },
];
const data = {
  groups,
  athletes,
  plans: [
    { id: 'p-a', name: 'Woche A', groupId: 'g-a', days: [{ date: '2026-10-12T00:00:00.000Z', sets: [] }, { date: '2026-10-14', sets: [] }] },
    { id: 'p-b', name: 'Woche B', groupId: 'g-b', days: [{ date: '2026-10-13', sets: [] }] },
    { id: 'p-all', name: 'Vereinstraining', groupId: null, days: [{ date: '2026-10-16', sets: [] }] },
  ],
  sessions: [
    { id: 's-a', date: '2026-10-12', groupId: 'g-a', attendance: [{ athleteId: 'a-maya', present: true }], coachIds: [] },
    { id: 's-b', date: '2026-10-13', groupId: 'g-b', attendance: [{ athleteId: 'a-lukas', present: true }], coachIds: [] },
    // Vertretung: Trainer:in hat in fremder Gruppe mitbetreut.
    { id: 's-b2', date: '2026-10-15', groupId: 'g-b', attendance: [], coachIds: [TRAINER.id] },
  ],
  competitions: [
    { id: 'c-maya', name: 'Bezirksmeisterschaften', date: '2026-11-05', location: 'Nord', course: 'SCM' },
    { id: 'c-lukas', name: 'Nachwuchscup', date: '2026-11-12', location: 'Ost', course: 'LCM' },
    { id: 'c-open', name: 'Frühjahrsmeeting', date: '2027-03-01', location: '', course: 'LCM' },
  ],
  entries: [
    { id: 'e1', competitionId: 'c-maya', athleteId: 'a-maya' },
    { id: 'e2', competitionId: 'c-lukas', athleteId: 'a-lukas' },
  ],
  actionItems: [
    { id: 'ai-maya', athleteId: 'a-maya', title: 'Wenden', status: 'offen', assignedTrainerId: TRAINER.id, dueDate: '2026-10-20T00:00:00.000Z' },
    { id: 'ai-lukas', athleteId: 'a-lukas', title: 'Atmung', status: 'progress', assignedTrainerId: OTHER_TRAINER, dueDate: '2026-10-21' },
    { id: 'ai-unassigned', athleteId: 'a-maya', title: 'Start', status: 'offen', assignedTrainerId: null, dueDate: '2026-10-22' },
    { id: 'ai-done', athleteId: 'a-maya', title: 'Erledigt', status: 'done', assignedTrainerId: TRAINER.id, dueDate: '2026-10-23' },
    { id: 'ai-nodue', athleteId: 'a-maya', title: 'Ohne Frist', status: 'offen', assignedTrainerId: TRAINER.id, dueDate: null },
  ],
  qualifications: [
    { id: 'q1', type: 'trainerC', expiresOn: '2026-12-31T00:00:00.000Z', renewalCourseOrganizedOn: '2026-11-20T00:00:00.000Z', note: '' },
    { id: 'q2', type: 'rettungsschwimmer', expiresOn: null, renewalCourseOrganizedOn: null, note: '' },
  ],
  refereeAssignments: [
    { id: 'r1', date: '2026-10-25T00:00:00.000Z', competitionName: 'Landesmeisterschaften', competitionPlace: 'Halle', function: 'zeitnehmer' },
  ],
};
const ALL = EVENT_TYPES;
const ids = (events, type) => events.filter((e) => !type || e.type === type).map((e) => e.id);

describe('collectEvents', () => {
  it('normalisiert Datumswerte auf YYYY-MM-DD und sortiert nach Datum', () => {
    const ctx = personalContext({ user: TRAINER, staff: true, athletes, groups });
    const events = collectEvents({ data, types: ALL, scope: 'all', ctx });
    expect(events.every((e) => /^\d{4}-\d{2}-\d{2}$/.test(e.date))).toBe(true);
    expect(events.map((e) => e.date)).toEqual([...events.map((e) => e.date)].sort());
  });

  it('Scope "all": alles außer erledigten bzw. fristlosen Handlungsfeldern', () => {
    const ctx = personalContext({ user: TRAINER, staff: true, athletes, groups });
    const events = collectEvents({ data, types: ALL, scope: 'all', ctx });
    expect(ids(events, 'training')).toHaveLength(4);
    expect(ids(events, 'session')).toHaveLength(3);
    expect(ids(events, 'competition')).toHaveLength(3);
    expect(ids(events, 'deadline').sort()).toEqual(['deadline:ai-lukas', 'deadline:ai-maya', 'deadline:ai-unassigned']);
  });

  it('Trainer:in, "Meine Termine": betreute Gruppen, eigene Vertretungen, zugewiesene Fristen', () => {
    const ctx = personalContext({ user: TRAINER, staff: true, athletes, groups });
    const events = collectEvents({ data, types: ALL, scope: 'mine', ctx });
    expect(ids(events, 'training')).toEqual(['training:p-a:0', 'training:p-a:1', 'training:p-all:0']);
    expect(ids(events, 'session')).toEqual(['session:s-a', 'session:s-b2']);
    // Meldung aus eigener Gruppe + Wettkampf noch ganz ohne Meldungen
    expect(ids(events, 'competition')).toEqual(['competition:c-maya', 'competition:c-open']);
    // zugewiesen ODER unzugewiesen bei eigener Athletin
    expect(ids(events, 'deadline')).toEqual(['deadline:ai-maya', 'deadline:ai-unassigned']);
  });

  it('Trainer:in ohne jede Gruppenzuordnung sieht alle Gruppen als eigene', () => {
    const unassigned = groups.map((g) => ({ ...g, trainerIds: [] }));
    const ctx = personalContext({ user: TRAINER, staff: true, athletes, groups: unassigned });
    const events = collectEvents({ data: { ...data, groups: unassigned }, types: ALL, scope: 'mine', ctx });
    expect(ids(events, 'training')).toHaveLength(4);
    expect(ids(events, 'competition')).toHaveLength(3);
    // Zuweisungen an andere Trainer:innen bleiben trotzdem deren Fristen
    expect(ids(events, 'deadline')).toEqual(['deadline:ai-maya', 'deadline:ai-unassigned']);
  });

  it('Athletin: eigene Gruppe, eigene Anwesenheit, eigene Meldungen und Fristen', () => {
    const ctx = personalContext({ user: MAYA_USER, staff: false, athletes, groups });
    const events = collectEvents({ data, types: ALL, scope: 'mine', ctx });
    expect(ids(events, 'training')).toEqual(['training:p-a:0', 'training:p-a:1']);
    expect(ids(events, 'session')).toEqual(['session:s-a']);
    expect(ids(events, 'competition')).toEqual(['competition:c-maya']);
    expect(ids(events, 'deadline')).toEqual(['deadline:ai-maya', 'deadline:ai-unassigned']);
  });

  it('Athletenkonto ohne verknüpftes Profil bekommt keine fremden Vereinstermine', () => {
    const ctx = personalContext({ user: { id: 'u-x', athleteId: 'missing' }, staff: false, athletes, groups });
    const events = collectEvents({ data, types: ['training', 'session', 'competition', 'deadline'], scope: 'mine', ctx });
    expect(events).toEqual([]);
  });

  it('Qualifikationen: Ablauf und Verlängerungslehrgang als eigene Termine; Kampfrichtereinsätze', () => {
    const ctx = personalContext({ user: TRAINER, staff: true, athletes, groups });
    const labels = {
      qualificationExpires: (q) => `Ablauf ${q.type}`,
      qualificationRenewal: (q) => `Lehrgang ${q.type}`,
      refereeFunction: (a) => a.function,
    };
    const events = collectEvents({ data, types: ['qualification', 'referee'], scope: 'mine', ctx, labels });
    expect(events.map((e) => [e.date, e.title])).toEqual([
      ['2026-10-25', 'Landesmeisterschaften'],
      ['2026-11-20', 'Lehrgang trainerC'],
      ['2026-12-31', 'Ablauf trainerC'],
    ]);
    expect(events[0].detail).toBe('zeitnehmer · Halle');
  });

  it('wertet nur die übergebenen (verfügbaren) Typen aus', () => {
    const ctx = personalContext({ user: TRAINER, staff: true, athletes, groups });
    const events = collectEvents({ data, types: ['competition'], scope: 'all', ctx });
    expect(new Set(events.map((e) => e.type))).toEqual(new Set(['competition']));
  });

  it('Termine verweisen auf das jeweilige Fachmodul', () => {
    const ctx = personalContext({ user: TRAINER, staff: true, athletes, groups });
    const events = collectEvents({ data, types: ALL, scope: 'all', ctx });
    const byId = Object.fromEntries(events.map((e) => [e.id, e]));
    expect(byId['training:p-a:0'].route).toEqual(['plans', 'p-a']);
    expect(byId['session:s-a'].route).toEqual(['sessions', 's-a']);
    expect(byId['competition:c-maya'].route).toEqual(['competitions', 'c-maya']);
    expect(byId['deadline:ai-maya'].route).toEqual(['actionitems', 'ai-maya']);
    expect(byId['deadline:ai-maya'].detail).toBe('Maya Vogel');
  });

  it('zeigt gesetzte Wettkampffristen als eigene Wettkampf-Termine', () => {
    const ctx = personalContext({ user: TRAINER, staff: true, athletes, groups });
    const withDeadlines = {
      ...data,
      competitions: data.competitions.map((c) => (c.id === 'c-maya'
        ? { ...c, entryDeadline: '2026-10-22T00:00:00.000Z', selectionDeadline: '2026-10-15T00:00:00.000Z' }
        : { ...c, entryDeadline: null })),
    };
    const labels = {
      entryDeadline: (c) => `Meldeschluss: ${c.name}`,
      selectionDeadline: (c) => `Startauswahl: ${c.name}`,
      competitionDate: (c) => `am ${c.date}`,
    };
    const events = collectEvents({ data: withDeadlines, types: ['competition'], scope: 'all', ctx, labels });
    const byId = Object.fromEntries(events.map((e) => [e.id, e]));
    expect(byId['competition:c-maya:entryDeadline']).toMatchObject({
      type: 'competition', date: '2026-10-22', title: 'Meldeschluss: Bezirksmeisterschaften',
      detail: 'am 2026-11-05', route: ['competitions', 'c-maya'],
    });
    expect(byId['competition:c-maya:selectionDeadline']).toMatchObject({ date: '2026-10-15', title: 'Startauswahl: Bezirksmeisterschaften' });
    // Wettkämpfe ohne Fristen erzeugen keine zusätzlichen Termine.
    expect(events.filter((e) => e.id.startsWith('competition:c-lukas'))).toHaveLength(1);
    expect(events.filter((e) => e.id.startsWith('competition:c-open'))).toHaveLength(1);
  });

  it('Wettkampffristen folgen dem "Meine"-Filter des Wettkampfs', () => {
    const ctx = personalContext({ user: MAYA_USER, staff: false, athletes, groups });
    const withDeadlines = {
      ...data,
      competitions: data.competitions.map((c) => ({ ...c, entryDeadline: '2026-10-01T00:00:00.000Z' })),
    };
    const events = collectEvents({ data: withDeadlines, types: ['competition'], scope: 'mine', ctx });
    expect(events.map((e) => e.id).sort()).toEqual(['competition:c-maya', 'competition:c-maya:entryDeadline']);
  });
});

describe('eventsInRange / countByType', () => {
  const ctx = personalContext({ user: TRAINER, staff: true, athletes, groups });
  const events = collectEvents({ data, types: ALL, scope: 'all', ctx });

  it('filtert nach Zeitraum (inklusive Grenzen) und aktiven Typen', () => {
    const week = eventsInRange(events, '2026-10-12', '2026-10-18');
    expect(week.every((e) => e.date >= '2026-10-12' && e.date <= '2026-10-18')).toBe(true);
    expect(ids(week, 'training')).toHaveLength(4);
    const onlySessions = eventsInRange(events, '2026-10-12', '2026-10-18', ['session']);
    expect(new Set(onlySessions.map((e) => e.type))).toEqual(new Set(['session']));
    expect(eventsInRange(events, '2026-10-12', '2026-10-18', [])).toEqual([]);
  });

  it('zählt je Typ, auch Typen ohne Termine', () => {
    const counts = countByType(eventsInRange(events, '2026-10-12', '2026-10-18'));
    expect(counts).toMatchObject({ training: 4, session: 3, competition: 0, qualification: 0 });
  });
});
