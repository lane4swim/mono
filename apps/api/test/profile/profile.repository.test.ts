// apps/api/test/profile/profile.repository.test.ts
import { describe, it, expect } from 'vitest';
import { InMemoryProfileDataGateway, type InMemoryProfileDatabase } from '../../src/modules/profile/profile.repository.memory.js';
import { UserNotFoundForExportError, ErasureAlreadyRequestedError } from '../../src/modules/profile/profile.repository.js';

function makeDb(overrides: Partial<InMemoryProfileDatabase> = {}): InMemoryProfileDatabase {
  return {
    users: [],
    athletes: [],
    results: [],
    entries: [],
    actionItems: [],
    sessions: [],
    ...overrides,
  };
}

const CLUB_ID = 'club-1';
const ATHLETE_ID = 'athlete-1';
const USER_ID = 'user-1';

function makeAthleteUser() {
  return {
    id: USER_ID, clubId: CLUB_ID, athleteId: ATHLETE_ID, deletedAt: null,
    name: 'Mara Vogel', email: 'mara.vogel@example.org', role: 'athlete', passwordHash: 'hash',
  };
}

describe('InMemoryProfileDataGateway.exportUserData', () => {
  it('wirft, wenn der Nutzer nicht existiert', async () => {
    const gateway = new InMemoryProfileDataGateway(makeDb());
    await expect(gateway.exportUserData('nope')).rejects.toThrow(UserNotFoundForExportError);
  });

  it('liefert das eigene Profil ohne passwordHash', async () => {
    const db = makeDb({ users: [{ ...makeAthleteUser(), athleteId: null }] });
    const gateway = new InMemoryProfileDataGateway(db);
    const result = await gateway.exportUserData(USER_ID);
    expect(result.user).not.toHaveProperty('passwordHash');
    expect(result.user.email).toBe('mara.vogel@example.org');
    expect(result.athlete).toBeNull();
  });

  it('bündelt Athletenprofil, Ergebnisse, Startlisteneinträge, Handlungsfelder und Anwesenheit für einen verknüpften Nutzer', async () => {
    const db = makeDb({
      users: [makeAthleteUser()],
      athletes: [{ id: ATHLETE_ID, firstName: 'Mara', lastName: 'Vogel', deletedAt: null }],
      results: [{ id: 'r1', athleteId: ATHLETE_ID, event: '100 Freistil', deletedAt: null }],
      entries: [{ id: 'e1', athleteId: ATHLETE_ID, event: '100 Freistil', deletedAt: null }],
      actionItems: [{ id: 'a1', athleteId: ATHLETE_ID, title: 'Atemtechnik', deletedAt: null }],
      sessions: [
        { id: 's1', clubId: CLUB_ID, date: new Date('2026-06-01'), attendance: [{ athleteId: ATHLETE_ID, present: true, rpe: 7 }] },
        { id: 's2', clubId: CLUB_ID, date: new Date('2026-06-08'), attendance: [{ athleteId: 'other-athlete', present: true, rpe: 5 }] },
      ],
    });
    const gateway = new InMemoryProfileDataGateway(db);
    const result = await gateway.exportUserData(USER_ID);

    expect(result.athlete).toMatchObject({ id: ATHLETE_ID, firstName: 'Mara' });
    expect(result.results).toHaveLength(1);
    expect(result.entries).toHaveLength(1);
    expect(result.actionItems).toHaveLength(1);
    // Nur die Anwesenheit dieser Person, nicht die anderer Athlet:innen der
    // zweiten Einheit.
    expect(result.attendance).toHaveLength(1);
    expect(result.attendance[0]).toMatchObject({ sessionId: 's1', present: true, rpe: 7 });
    expect(result.format).toBe('lane1-user-data-export-v1');
  });

  it('liefert leere Arrays für eine Trainer:in ohne verknüpftes Athletenprofil', async () => {
    const db = makeDb({ users: [{ id: 'trainer-1', clubId: CLUB_ID, athleteId: null, deletedAt: null, name: 'Sabine', email: 's@x.de', role: 'trainer', passwordHash: 'h' }] });
    const gateway = new InMemoryProfileDataGateway(db);
    const result = await gateway.exportUserData('trainer-1');
    expect(result.athlete).toBeNull();
    expect(result.results).toEqual([]);
    expect(result.attendance).toEqual([]);
  });
});

describe('InMemoryProfileDataGateway.requestErasure', () => {
  it('wirft, wenn der Nutzer nicht existiert', async () => {
    const gateway = new InMemoryProfileDataGateway(makeDb());
    await expect(gateway.requestErasure('nope', 30)).rejects.toThrow(UserNotFoundForExportError);
  });

  it('setzt deletedAt sofort auf User UND verknüpftes Athletenprofil samt Ergebnissen/Einträgen/Handlungsfeldern', async () => {
    const db = makeDb({
      users: [makeAthleteUser()],
      athletes: [{ id: ATHLETE_ID, deletedAt: null }],
      results: [{ id: 'r1', athleteId: ATHLETE_ID, deletedAt: null }],
      entries: [{ id: 'e1', athleteId: ATHLETE_ID, deletedAt: null }],
      actionItems: [{ id: 'a1', athleteId: ATHLETE_ID, deletedAt: null }],
    });
    const gateway = new InMemoryProfileDataGateway(db);
    await gateway.requestErasure(USER_ID, 30);

    expect(db.users[0]!.deletedAt).not.toBeNull();
    expect(db.athletes[0]!.deletedAt).not.toBeNull();
    expect(db.results[0]!.deletedAt).not.toBeNull();
    expect(db.entries[0]!.deletedAt).not.toBeNull();
    expect(db.actionItems[0]!.deletedAt).not.toBeNull();
  });

  it('setzt purgeAfter auf "jetzt + retentionDays"', async () => {
    const db = makeDb({ users: [{ ...makeAthleteUser(), athleteId: null }] });
    const gateway = new InMemoryProfileDataGateway(db);
    const before = Date.now();
    const request = await gateway.requestErasure(USER_ID, 30);
    const expectedMs = before + 30 * 24 * 60 * 60 * 1000;
    expect(Math.abs(request.purgeAfter.getTime() - expectedMs)).toBeLessThan(5000);
    expect(request.status).toBe('pending');
  });

  it('lehnt eine zweite Löschanfrage für denselben Nutzer ab', async () => {
    const db = makeDb({ users: [{ ...makeAthleteUser(), athleteId: null }] });
    const gateway = new InMemoryProfileDataGateway(db);
    await gateway.requestErasure(USER_ID, 30);
    await expect(gateway.requestErasure(USER_ID, 30)).rejects.toThrow(ErasureAlreadyRequestedError);
  });
});
