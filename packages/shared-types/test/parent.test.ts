import { describe, it, expect } from 'vitest';
import { ParentOverviewResponseSchema, ParentLinksResponseSchema, CreateParentLinkRequestSchema } from '../src/parent.js';

const CHILD_ID = '11111111-1111-1111-1111-111111111111';
const now = new Date().toISOString();

describe('ParentOverviewResponseSchema', () => {
  it('akzeptiert eine vollständige Übersicht mit mehreren Kindern', () => {
    const response = {
      children: [
        {
          athlete: { id: CHILD_ID, firstName: 'Mara', lastName: 'Vogel', groupId: null, groupName: null },
          upcomingSessions: [{ id: CHILD_ID, date: now, groupName: 'Leistungsgruppe' }],
          upcomingCompetitions: [{ competitionId: CHILD_ID, competitionName: 'Bezirksmeisterschaften', date: now, event: '100 Freistil' }],
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
        athlete: { id: CHILD_ID, firstName: 'Mara', lastName: 'Vogel', groupId: null, groupName: null },
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
    expect(ParentLinksResponseSchema.safeParse({ links: [{ athleteId: CHILD_ID, firstName: 'Mara', lastName: 'Vogel' }] }).success).toBe(true);
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
