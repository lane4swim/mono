// apps/api/test/jobs/purgeExpiredDeletions.test.ts
import { describe, it, expect } from 'vitest';
import { MODULE_KEYS } from '@lane1/shared-types';
import { purgeExpiredDeletions } from '../../src/jobs/purgeExpiredDeletions.js';
import { ANONYMIZED_COMMENT_AUTHOR } from '../../src/jobs/commentAnonymization.js';
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

// Sicherheitsreview 2026-08, Befund N5: Comment.authorName (eingebettet in
// plans/exercises/templates) wurde vom Purge bislang gar nicht erfasst.
describe('purgeExpiredDeletions — Comment.authorName-Anonymisierung (Befund N5)', () => {
  it('anonymisiert Plan-, verschachtelte Set- und Übungskatalog-Kommentare der gelöschten Person, lässt den Kommentartext erhalten', async () => {
    const db = makeDb({
      users: [{ id: 'u1', clubId: 'club-1', athleteId: null, name: 'Mara Vogel' }],
      deletionRequests: [{ id: 'req1', userId: 'u1', purgeAfter: PAST }],
      plans: [
        {
          id: 'p1',
          clubId: 'club-1',
          comments: [{ id: 'c1', authorId: 'u1', authorName: 'Mara Vogel', text: 'Guter Plan', createdAt: NOW.toISOString() }],
          days: [
            {
              date: NOW.toISOString(),
              sets: [{ kind: 'set', id: 's1', comments: [{ id: 'c2', authorId: 'u1', authorName: 'Mara Vogel', text: 'Harte Serie', createdAt: NOW.toISOString() }] }],
            },
          ],
        },
      ],
      exercises: [
        { id: 'ex1', clubId: 'club-1', comments: [{ id: 'c3', authorId: 'u1', authorName: 'Mara Vogel', text: 'Technik-Hinweis', createdAt: NOW.toISOString() }] },
      ],
      templates: [
        { id: 't1', clubId: 'club-1', sets: [{ kind: 'set', id: 's2', comments: [{ id: 'c4', authorId: 'u1', authorName: 'Mara Vogel', text: 'Vorlagen-Hinweis', createdAt: NOW.toISOString() }] }] },
      ],
    });
    const gateway = new InMemoryErasureJobGateway(db);
    await purgeExpiredDeletions(gateway, NOW);

    const plan = db.plans![0]!;
    expect((plan.comments as Array<{ authorName: string; text: string }>)[0]).toMatchObject({ authorName: ANONYMIZED_COMMENT_AUTHOR, text: 'Guter Plan' });
    const day = (plan.days as Array<{ sets: Array<{ comments: Array<{ authorName: string; text: string }> }> }>)[0]!;
    expect(day.sets[0]!.comments[0]).toMatchObject({ authorName: ANONYMIZED_COMMENT_AUTHOR, text: 'Harte Serie' });

    const exercise = db.exercises![0]!;
    expect((exercise.comments as Array<{ authorName: string; text: string }>)[0]).toMatchObject({ authorName: ANONYMIZED_COMMENT_AUTHOR, text: 'Technik-Hinweis' });

    const template = db.templates![0]!;
    expect((template.sets as Array<{ comments: Array<{ authorName: string; text: string }> }>)[0]!.comments[0]).toMatchObject({ authorName: ANONYMIZED_COMMENT_AUTHOR, text: 'Vorlagen-Hinweis' });
  });

  it('lässt Kommentare ANDERER Personen und eines ANDEREN Vereins unangetastet', async () => {
    const db = makeDb({
      users: [{ id: 'u1', clubId: 'club-1', athleteId: null, name: 'Mara Vogel' }],
      deletionRequests: [{ id: 'req1', userId: 'u1', purgeAfter: PAST }],
      plans: [
        { id: 'p1', clubId: 'club-1', comments: [{ id: 'c1', authorId: 'u2', authorName: 'Jens Bauer', text: 'Nicht meins', createdAt: NOW.toISOString() }], days: [] },
        { id: 'p2', clubId: 'club-2', comments: [{ id: 'c2', authorId: 'u1', authorName: 'Mara Vogel', text: 'Anderer Verein', createdAt: NOW.toISOString() }], days: [] },
      ],
    });
    const gateway = new InMemoryErasureJobGateway(db);
    await purgeExpiredDeletions(gateway, NOW);

    expect((db.plans!.find((p) => p.id === 'p1')!.comments as Array<{ authorName: string }>)[0]!.authorName).toBe('Jens Bauer');
    expect((db.plans!.find((p) => p.id === 'p2')!.comments as Array<{ authorName: string }>)[0]!.authorName).toBe('Mara Vogel');
  });

  // Kommentare stammen ebenso von Trainer:innen/Admins ohne athleteId —
  // die Anonymisierung darf NICHT an ein verknüpftes Athletenprofil
  // gekoppelt sein (anders als die Ergebnisse/Einträge/Handlungsfelder
  // oben, die athleteId voraussetzen).
  it('funktioniert auch für ein Konto OHNE verknüpftes Athletenprofil (z. B. Trainer:in/Admin)', async () => {
    const db = makeDb({
      users: [{ id: 'u1', clubId: 'club-1', athleteId: null, name: 'Coach Nina' }],
      deletionRequests: [{ id: 'req1', userId: 'u1', purgeAfter: PAST }],
      exercises: [{ id: 'ex1', clubId: 'club-1', comments: [{ id: 'c1', authorId: 'u1', authorName: 'Coach Nina', text: 'Trainer-Hinweis', createdAt: NOW.toISOString() }] }],
    });
    const gateway = new InMemoryErasureJobGateway(db);
    await purgeExpiredDeletions(gateway, NOW);

    expect((db.exercises![0]!.comments as Array<{ authorName: string }>)[0]!.authorName).toBe(ANONYMIZED_COMMENT_AUTHOR);
  });
});

// Sicherheitsreview 2026-08-27, Befund M1: Invitation.email (die
// E-Mail-Adresse, AN die eine Einladung ausgestellt wurde) wurde vom
// Purge bislang gar nicht erfasst und blieb dauerhaft in der Datenbank
// stehen — unabhängig davon, ob die Einladung angenommen, abgelaufen oder
// widerrufen war.
describe('purgeExpiredDeletions — Invitation.email-Anonymisierung (Befund M1)', () => {
  it('anonymisiert JEDE Einladung an die E-Mail-Adresse der gelöschten Person und nullt deren athleteId', async () => {
    const db = makeDb({
      users: [{ id: 'u1', clubId: 'club-1', athleteId: 'ath-1', email: 'mara.vogel@example.org' }],
      deletionRequests: [{ id: 'req1', userId: 'u1', purgeAfter: PAST }],
      invitations: [
        { id: 'inv1', email: 'mara.vogel@example.org', athleteId: 'ath-1', role: 'athlete' },
        // Eine zweite, längst abgelaufene Einladung an dieselbe Adresse
        // (z. B. weil die erste ursprünglich verpasst wurde) — MUSS
        // ebenfalls erfasst werden, nicht nur die zuletzt angenommene.
        { id: 'inv2', email: 'mara.vogel@example.org', athleteId: 'ath-1', role: 'athlete' },
      ],
    });
    const gateway = new InMemoryErasureJobGateway(db);
    await purgeExpiredDeletions(gateway, NOW);

    for (const invitation of db.invitations!) {
      expect(invitation.email).toBe('geloeschtes-konto@geloescht.invalid');
      expect(invitation.athleteId).toBeNull();
    }
  });

  it('lässt Einladungen an eine ANDERE E-Mail-Adresse unangetastet, inkl. solcher, die diese Person selbst AUSGESTELLT hat', async () => {
    const db = makeDb({
      users: [{ id: 'u1', clubId: 'club-1', athleteId: null, email: 'coach.nina@example.org' }],
      deletionRequests: [{ id: 'req1', userId: 'u1', purgeAfter: PAST }],
      invitations: [
        { id: 'inv1', email: 'jemand-anderes@example.org', athleteId: null, role: 'trainer', invitedById: 'u1' },
      ],
    });
    const gateway = new InMemoryErasureJobGateway(db);
    await purgeExpiredDeletions(gateway, NOW);

    // Die Einladung wurde von der gelöschten Person AUSGESTELLT (invitedById),
    // nicht AN sie gerichtet (email) — bleibt bewusst unverändert (siehe
    // Begründung in erasure.repository.ts).
    expect(db.invitations![0]!.email).toBe('jemand-anderes@example.org');
    expect(db.invitations![0]!.invitedById).toBe('u1');
  });

  it('funktioniert auch ohne verknüpftes Athletenprofil (z. B. eine Trainer:innen-Einladung)', async () => {
    const db = makeDb({
      users: [{ id: 'u1', clubId: 'club-1', athleteId: null, email: 'coach.nina@example.org' }],
      deletionRequests: [{ id: 'req1', userId: 'u1', purgeAfter: PAST }],
      invitations: [{ id: 'inv1', email: 'coach.nina@example.org', athleteId: null, role: 'trainer' }],
    });
    const gateway = new InMemoryErasureJobGateway(db);
    await purgeExpiredDeletions(gateway, NOW);

    expect(db.invitations![0]!.email).toBe('geloeschtes-konto@geloescht.invalid');
  });
});

const NOW = new Date('2026-07-20T00:00:00.000Z');
const PAST = new Date('2026-07-01T00:00:00.000Z'); // vor NOW -> fällig
const FUTURE = new Date('2026-08-01T00:00:00.000Z'); // nach NOW -> noch nicht fällig

describe('purgeExpiredDeletions', () => {
  it('löscht nichts, wenn keine Löschanfrage fällig ist', async () => {
    const db = makeDb({
      users: [{ id: 'u1', clubId: null, athleteId: null }],
      deletionRequests: [{ id: 'req1', userId: 'u1', purgeAfter: FUTURE }],
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
      deletionRequests: [{ id: 'req1', userId: 'u1', purgeAfter: PAST }],
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
      deletionRequests: [{ id: 'req1', userId: 'u1', purgeAfter: PAST }],
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
        { id: 'req1', userId: 'u1', purgeAfter: PAST },
        { id: 'req2', userId: 'u2', purgeAfter: PAST },
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
        { id: 'req1', userId: 'u1', purgeAfter: PAST },
        { id: 'req2', userId: 'u2', purgeAfter: FUTURE },
      ],
    });
    const gateway = new InMemoryErasureJobGateway(db);
    const result = await purgeExpiredDeletions(gateway, NOW);

    expect(result.processed).toBe(1);
    expect(db.users.map((u) => u.id)).toEqual(['u2']);
  });
});

describe('purgeExpiredDeletions — Tombstones (Verbesserung: Löschungen bleiben meldbar)', () => {
  it('schreibt für Athletenprofil, Ergebnisse, Einträge und Handlungsfelder je eine Löschmarkierung', async () => {
    const tombstones: import('../../src/modules/sync/sync.gateway.js').TombstoneRecord[] = [];
    const db = makeDb({
      users: [{ id: 'u1', clubId: 'club-1', athleteId: 'ath-1' }],
      athletes: [{ id: 'ath-1' }],
      results: [{ id: 'r1', athleteId: 'ath-1' }],
      entries: [{ id: 'e1', athleteId: 'ath-1' }],
      actionItems: [{ id: 'a1', athleteId: 'ath-1' }],
      deletionRequests: [{ id: 'req1', userId: 'u1', purgeAfter: PAST }],
      tombstones,
    });
    const gateway = new InMemoryErasureJobGateway(db);
    await purgeExpiredDeletions(gateway, NOW);

    const entityIds = tombstones.map((t) => t.entityId).sort();
    expect(entityIds).toEqual(['a1', 'ath-1', 'e1', 'r1'].sort());
    expect(tombstones.every((t) => t.clubId === 'club-1')).toBe(true);
    expect(tombstones.find((t) => t.entityId === 'ath-1')!.store).toBe('athletes');
  });

  it('schreibt keine Tombstones für ein Konto ohne verknüpftes Athletenprofil', async () => {
    const tombstones: import('../../src/modules/sync/sync.gateway.js').TombstoneRecord[] = [];
    const db = makeDb({
      users: [{ id: 'u1', clubId: 'club-1', athleteId: null }],
      deletionRequests: [{ id: 'req1', userId: 'u1', purgeAfter: PAST }],
      tombstones,
    });
    const gateway = new InMemoryErasureJobGateway(db);
    await purgeExpiredDeletions(gateway, NOW);

    expect(tombstones).toHaveLength(0);
  });

  it('Ende-zu-Ende: ein vom Purge-Job geschriebener Tombstone wird über die Sync-API (pull) sichtbar', async () => {
    // Simuliert exakt den in der Analyse beschriebenen Grenzfall: ein
    // Gerät war während der gesamten Aufbewahrungsfrist offline und
    // bekommt daher nie ein reguläres "delete"-Signal über deletedAt —
    // der Tombstone ist die einzige verbleibende Möglichkeit.
    const { InMemorySyncGateway } = await import('../../src/modules/sync/sync.gateway.memory.js');
    const { createSyncService } = await import('../../src/modules/sync/sync.service.js');

    const sharedTombstones: import('../../src/modules/sync/sync.gateway.js').TombstoneRecord[] = [];
    const erasureDb = makeDb({
      users: [{ id: 'u1', clubId: 'club-1', athleteId: 'ath-1' }],
      athletes: [{ id: 'ath-1' }],
      deletionRequests: [{ id: 'req1', userId: 'u1', purgeAfter: PAST }],
      tombstones: sharedTombstones,
    });
    const erasureGateway = new InMemoryErasureJobGateway(erasureDb);

    // Vor dem Purge: das (nie synchronisierte) Gerät hätte hier noch
    // nichts von der Löschung erfahren.
    const syncGateway = new InMemorySyncGateway(sharedTombstones);
    const syncService = createSyncService({ gateway: syncGateway });

    await purgeExpiredDeletions(erasureGateway, NOW);

    const pullResult = await syncService.pull({}, { userId: 'u1', clubId: 'club-1', role: 'trainer', athleteId: null, enabledModules: MODULE_KEYS });
    expect(pullResult.changes).toContainEqual(
      expect.objectContaining({ store: 'athletes', entityId: 'ath-1', action: 'delete', payload: null }),
    );
  });
});
