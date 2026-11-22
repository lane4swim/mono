import { describe, it, expect } from 'vitest';
import { ParentOverviewResponseSchema, ParentLinksResponseSchema, CreateParentLinkRequestSchema } from '../src/parent.js';

const CHILD_ID = '11111111-1111-1111-1111-111111111111';
const now = new Date().toISOString();

describe('ParentOverviewResponseSchema', () => {
  it('akzeptiert eine vollständige Übersicht mit mehreren Kindern', () => {
    const response = {
      children: [
        {
          athlete: { id: CHILD_ID, firstName: 'Mara', lastName: 'Vogel', groupId: null, groupName: null, trainerNames: ['Nina Brandt'] },
          upcomingSessions: [{ id: CHILD_ID, date: now, groupName: 'Leistungsgruppe' }],
          upcomingCompetitions: [{ competitionId: CHILD_ID, competitionName: 'Bezirksmeisterschaften', date: now, event: '100 Freistil', eventNumber: '12', heat: 3, lane: 4, seedTime: 72.35 }],
          recentResults: [{ id: CHILD_ID, event: '100 Freistil', time: 62.35, date: now, isPB: true, status: 'OK' }],
        },
      ],
    };
    expect(ParentOverviewResponseSchema.safeParse(response).success).toBe(true);
  });

  it('akzeptiert eine leere Kinderliste (kein Fehler, einfach nichts anzuzeigen)', () => {
    expect(ParentOverviewResponseSchema.safeParse({ children: [] }).success).toBe(true);
  });

  it('lehnt ein Result mit ungültigem status-Typ ab', () => {
    const response = {
      children: [{
        athlete: { id: CHILD_ID, firstName: 'Mara', lastName: 'Vogel', groupId: null, groupName: null, trainerNames: ['Nina Brandt'] },
        upcomingSessions: [],
        upcomingCompetitions: [],
        recentResults: [{ id: CHILD_ID, event: '100 Freistil', time: null, date: now, isPB: false, status: 123 }],
      }],
    };
    expect(ParentOverviewResponseSchema.safeParse(response).success).toBe(false);
  });
});

describe('ParentLinksResponseSchema', () => {
  it('akzeptiert eine Liste verknüpfter Kinder', () => {
    expect(ParentLinksResponseSchema.safeParse({ links: [{ athleteId: CHILD_ID, firstName: 'Mara', lastName: 'Vogel', ageStatus: 'minor' }] }).success).toBe(true);
  });

  it('verlangt den Altersstand und lehnt unbekannte Werte ab', () => {
    expect(ParentLinksResponseSchema.safeParse({ links: [{ athleteId: CHILD_ID, firstName: 'Mara', lastName: 'Vogel' }] }).success).toBe(false);
    expect(ParentLinksResponseSchema.safeParse({ links: [{ athleteId: CHILD_ID, firstName: 'Mara', lastName: 'Vogel', ageStatus: 'teen' }] }).success).toBe(false);
  });
});

// Issue #145: die Schemas sind die Freigabeliste — unbekannte Felder werden
// abgelehnt, auch verschachtelt.
describe('Strikte Eltern-Schemas', () => {
  const child = {
    athlete: { id: CHILD_ID, firstName: 'Mara', lastName: 'Vogel', groupId: null, groupName: null, trainerNames: [] },
    upcomingSessions: [], upcomingCompetitions: [], recentResults: [],
  };
  it('lehnt ein zusätzliches Feld beim Kind ab', () => {
    expect(ParentOverviewResponseSchema.safeParse({ children: [{ ...child, athlete: { ...child.athlete, notes: 'x' } }] }).success).toBe(false);
  });
  it('lehnt RPE in einer Einheit ab', () => {
    const session = { id: CHILD_ID, date: now, groupName: null, rpe: 7 };
    expect(ParentOverviewResponseSchema.safeParse({ children: [{ ...child, upcomingSessions: [session] }] }).success).toBe(false);
  });
});

describe('CreateParentLinkRequestSchema', () => {
  it('akzeptiert eine gültige athleteId', () => {
    expect(CreateParentLinkRequestSchema.safeParse({ athleteId: CHILD_ID }).success).toBe(true);
  });
  it('lehnt eine ungültige athleteId ab', () => {
    expect(CreateParentLinkRequestSchema.safeParse({ athleteId: 'not-a-uuid' }).success).toBe(false);
  });
});
