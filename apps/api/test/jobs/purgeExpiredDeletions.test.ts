// apps/api/test/jobs/purgeExpiredDeletions.test.ts
import { describe, it, expect } from 'vitest';
import { purgeExpiredDeletions } from '../../src/jobs/purgeExpiredDeletions.js';
import { InMemoryErasureJobGateway, type InMemoryErasureDatabase } from '../../src/jobs/erasure.repository.memory.js';

function makeDb(overrides: Partial<InMemoryErasureDatabase> = {}): InMemoryErasureDatabase {
  return {
    users: [],
    athletes: [],
    results: [],
    entries: [],
    actionItems: [],
    sessions: [],
    refreshTokens: [],
    deletionRequests: [],
    ...overrides,
  };
}

const NOW = new Date('2026-07-20T00:00:00.000Z');
const PAST = new Date('2026-07-01T00:00:00.000Z'); // vor NOW -> fällig
const FUTURE = new Date('2026-08-01T00:00:00.000Z'); // nach NOW -> noch nicht fällig

describe('purgeExpiredDeletions', () => {
  it('löscht nichts, wenn keine Löschanfrage fällig ist', async () => {
    const db = makeDb({
      users: [{ id: 'u1', clubId: null, athleteId: null }],
      deletionRequests: [{ id: 'req1', userId: 'u1', purgeAfter: FUTURE, status: 'pending', purgedAt: null }],
    });
    const gateway = new InMemoryErasureJobGateway(db);
    const result = await purgeExpiredDeletions(gateway, NOW);

    expect(result.processed).toBe(0);
    expect(db.users).toHaveLength(1); // unangetastet
  });

  it('löscht einen Nutzer ohne verknüpftes Athletenprofil vollständig', async () => {
    const db = makeDb({
      users: [{ id: 'u1', clubId: null, athleteId: null }],
      refreshTokens: [{ id: 't1', userId: 'u1' }],
      deletionRequests: [{ id: 'req1', userId: 'u1', purgeAfter: PAST, status: 'pending', purgedAt: null }],
    });
    const gateway = new InMemoryErasureJobGateway(db);
    const result = await purgeExpiredDeletions(gateway, NOW);

    expect(result.processed).toBe(1);
    expect(db.users).toHaveLength(0);
    expect(db.refreshTokens).toHaveLength(0);
    expect(db.deletionRequests).toHaveLength(0);
  });

  it('löscht einen verknüpften Athleten samt Ergebnissen/Einträgen/Handlungsfeldern und entfernt Anwesenheitseinträge aus Trainingseinheiten', async () => {
    const db = makeDb({
      users: [{ id: 'u1', clubId: 'club-1', athleteId: 'ath-1' }],
      athletes: [{ id: 'ath-1' }],
      results: [{ id: 'r1', athleteId: 'ath-1' }],
      entries: [{ id: 'e1', athleteId: 'ath-1' }],
      actionItems: [{ id: 'a1', athleteId: 'ath-1' }],
      sessions: [
        { id: 's1', clubId: 'club-1', attendance: [{ athleteId: 'ath-1', present: true }, { athleteId: 'ath-2', present: true }] },
        { id: 's2', clubId: 'club-2', attendance: [{ athleteId: 'ath-1', present: true }] }, // anderer Verein -> unangetastet
      ],
      deletionRequests: [{ id: 'req1', userId: 'u1', purgeAfter: PAST, status: 'pending', purgedAt: null }],
    });
    const gateway = new InMemoryErasureJobGateway(db);
    await purgeExpiredDeletions(gateway, NOW);

    expect(db.athletes).toHaveLength(0);
    expect(db.results).toHaveLength(0);
    expect(db.entries).toHaveLength(0);
    expect(db.actionItems).toHaveLength(0);
    expect(db.sessions.find((s) => s.id === 's1')!.attendance).toEqual([{ athleteId: 'ath-2', present: true }]);
    // Sitzung eines ANDEREN Vereins bleibt unverändert (Scoping über clubId).
    expect(db.sessions.find((s) => s.id === 's2')!.attendance).toEqual([{ athleteId: 'ath-1', present: true }]);
  });

  it('verarbeitet mehrere fällige Löschanfragen in einem Lauf', async () => {
    const db = makeDb({
      users: [{ id: 'u1', clubId: null, athleteId: null }, { id: 'u2', clubId: null, athleteId: null }],
      deletionRequests: [
        { id: 'req1', userId: 'u1', purgeAfter: PAST, status: 'pending', purgedAt: null },
        { id: 'req2', userId: 'u2', purgeAfter: PAST, status: 'pending', purgedAt: null },
      ],
    });
    const gateway = new InMemoryErasureJobGateway(db);
    const result = await purgeExpiredDeletions(gateway, NOW);

    expect(result.processed).toBe(2);
    expect(db.users).toHaveLength(0);
  });

  it('ist bereits gelöschte Nutzer:innen gegenüber tolerant (kein Fehler bei erneutem Lauf)', async () => {
    const gateway = new InMemoryErasureJobGateway(makeDb());
    await expect(gateway.purgeUserAndDependents('unbekannt')).resolves.not.toThrow();
  });

  it('nur genau die fällige Anfrage wird bearbeitet, eine nicht-fällige bleibt unangetastet', async () => {
    const db = makeDb({
      users: [{ id: 'u1', clubId: null, athleteId: null }, { id: 'u2', clubId: null, athleteId: null }],
      deletionRequests: [
        { id: 'req1', userId: 'u1', purgeAfter: PAST, status: 'pending', purgedAt: null },
        { id: 'req2', userId: 'u2', purgeAfter: FUTURE, status: 'pending', purgedAt: null },
      ],
    });
    const gateway = new InMemoryErasureJobGateway(db);
    const result = await purgeExpiredDeletions(gateway, NOW);

    expect(result.processed).toBe(1);
    expect(db.users.map((u) => u.id)).toEqual(['u2']);
  });
});
