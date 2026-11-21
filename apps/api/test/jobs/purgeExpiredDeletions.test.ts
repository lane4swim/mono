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

// Kommentare (Store "comments", Issue #141): Name und Zuordnung der
// gelöschten Person werden entfernt, der Text bleibt erhalten.
function comment(overrides: Record<string, unknown>) {
  return { id: 'c1', clubId: 'club-1', targetStore: 'plans', targetId: 'p1', entryId: null, authorId: 'u1', authorName: 'Mara Vogel', text: 'Guter Plan', ...overrides };
}

describe('purgeExpiredDeletions — Kommentar-Anonymisierung', () => {
  it('anonymisiert die Kommentare der gelöschten Person an jedem Ziel und lässt den Text erhalten', async () => {
    const db = makeDb({
      users: [{ id: 'u1', clubId: 'club-1', athleteId: null, name: 'Mara Vogel' }],
      deletionRequests: [{ id: 'req1', userId: 'u1', purgeAfter: PAST }],
      comments: [
        comment({ id: 'c1' }),
        comment({ id: 'c2', entryId: 's1', text: 'Harte Serie' }),
        comment({ id: 'c3', targetStore: 'exercises', targetId: 'ex1', text: 'Technik-Hinweis' }),
      ],
    });
    await purgeExpiredDeletions(new InMemoryErasureJobGateway(db), NOW);

    for (const c of db.comments!) {
      expect(c).toMatchObject({ authorId: null, authorName: ANONYMIZED_COMMENT_AUTHOR });
    }
    expect(db.comments!.map((c) => c.text)).toEqual(['Guter Plan', 'Harte Serie', 'Technik-Hinweis']);
  });

  it('lässt Kommentare ANDERER Personen und eines ANDEREN Vereins unangetastet', async () => {
    const db = makeDb({
      users: [{ id: 'u1', clubId: 'club-1', athleteId: null, name: 'Mara Vogel' }],
      deletionRequests: [{ id: 'req1', userId: 'u1', purgeAfter: PAST }],
      comments: [
        comment({ id: 'c1', authorId: 'u2', authorName: 'Jens Bauer' }),
        comment({ id: 'c2', clubId: 'club-2' }),
      ],
    });
    await purgeExpiredDeletions(new InMemoryErasureJobGateway(db), NOW);

    expect(db.comments!.find((c) => c.id === 'c1')).toMatchObject({ authorId: 'u2', authorName: 'Jens Bauer' });
    expect(db.comments!.find((c) => c.id === 'c2')).toMatchObject({ authorId: 'u1', authorName: 'Mara Vogel' });
  });

  it('erkennt Altbestand ohne Zuordnung am Namen, aber nicht bei fremder authorId', async () => {
    const db = makeDb({
      users: [{ id: 'u1', clubId: 'club-1', athleteId: null, name: 'Mara Vogel' }],
      deletionRequests: [{ id: 'req1', userId: 'u1', purgeAfter: PAST }],
      comments: [
        comment({ id: 'c1', authorId: null }),
        comment({ id: 'c2', authorId: 'u2' }),
      ],
    });
    await purgeExpiredDeletions(new InMemoryErasureJobGateway(db), NOW);

    expect(db.comments!.find((c) => c.id === 'c1')!.authorName).toBe(ANONYMIZED_COMMENT_AUTHOR);
    expect(db.comments!.find((c) => c.id === 'c2')!.authorName).toBe('Mara Vogel');
  });

  it('löscht Kommentare an den gelöschten Ergebnissen der Person samt Löschmarkierung', async () => {
    const tombstones: NonNullable<InMemoryErasureDatabase['tombstones']> = [];
    const db = makeDb({
      users: [{ id: 'u1', clubId: 'club-1', athleteId: 'a1', name: 'Mara Vogel' }],
      athletes: [{ id: 'a1' }],
      results: [{ id: 'r1', athleteId: 'a1' }, { id: 'r2', athleteId: 'a-other' }],
      deletionRequests: [{ id: 'req1', userId: 'u1', purgeAfter: PAST }],
      tombstones,
      comments: [
        comment({ id: 'c1', targetStore: 'results', targetId: 'r1', authorId: 'u-coach', authorName: 'Coach Nina' }),
        comment({ id: 'c2', targetStore: 'results', targetId: 'r2', authorId: 'u-coach', authorName: 'Coach Nina' }),
      ],
    });
    await purgeExpiredDeletions(new InMemoryErasureJobGateway(db), NOW);

    expect(db.comments!.map((c) => c.id)).toEqual(['c2']);
    expect(tombstones).toContainEqual(expect.objectContaining({ store: 'comments', entityId: 'c1' }));
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
    const syncService = createSyncService({ gateway: syncGateway, pullSettleMs: 0 });

    await purgeExpiredDeletions(erasureGateway, NOW);

    const pullResult = await syncService.pull({}, { userId: 'u1', clubId: 'club-1', roles: ['trainer'], athleteId: null, enabledModules: MODULE_KEYS });
    expect(pullResult.changes).toContainEqual(
      expect.objectContaining({ store: 'athletes', entityId: 'ath-1', action: 'delete', payload: null }),
    );
  });
});

// Issue #96: Audit-Log-Einträge überleben den Purge, aber ohne Name,
// E-Mail-Adresse und Konto-ID der gelöschten Person.
describe('purgeExpiredDeletions — Audit-Log-Pseudonymisierung (Issue #96)', () => {
  it('pseudonymisiert Einträge von und über die Person mit EINEM gemeinsamen Pseudonym und lässt fremde Einträge unverändert', async () => {
    const at = new Date('2026-06-01T00:00:00.000Z');
    const db = makeDb({
      users: [{ id: 'u1', clubId: 'club-1', athleteId: null, name: 'Mara Vogel', email: 'mara@example.org' }],
      deletionRequests: [{ id: 'req1', userId: 'u1', purgeAfter: PAST }],
      auditLogEntries: [
        { id: 'a1', clubId: 'club-1', actorId: 'u1', actorLabel: 'Mara Vogel <mara@example.org>', action: 'user.passwordChanged', targetId: 'u1', targetLabel: 'Mara Vogel <mara@example.org>', metadata: {}, createdAt: at },
        { id: 'a2', clubId: 'club-1', actorId: 'admin-1', actorLabel: 'Admina <admin@a.de>', action: 'invitation.created', targetId: 'inv-1', targetLabel: 'mara@example.org', metadata: { role: 'trainer', email: 'mara@example.org' }, createdAt: at },
        { id: 'a3', clubId: 'club-1', actorId: 'admin-1', actorLabel: 'Admina <admin@a.de>', action: 'invitation.created', targetId: 'inv-2', targetLabel: 'jonas@example.org', metadata: { role: 'athlete', email: 'jonas@example.org' }, createdAt: at },
      ],
    });
    const gateway = new InMemoryErasureJobGateway(db);
    await purgeExpiredDeletions(gateway, NOW);

    const [own, invitation, other] = db.auditLogEntries!;
    expect(own).toMatchObject({ actorId: null, targetId: null, action: 'user.passwordChanged' });
    expect(own!.actorLabel).toMatch(/^__deleted_account__#[0-9a-f]{8}$/);
    expect(own!.targetLabel).toBe(own!.actorLabel);
    expect(invitation).toMatchObject({ actorId: 'admin-1', targetId: 'inv-1', targetLabel: own!.actorLabel, metadata: { role: 'trainer' } });
    expect(other).toMatchObject({ targetLabel: 'jonas@example.org', metadata: { role: 'athlete', email: 'jonas@example.org' } });
    expect(JSON.stringify(db.auditLogEntries)).not.toContain('mara@example.org');
    expect(JSON.stringify(db.auditLogEntries)).not.toContain('Mara Vogel');
  });
});
