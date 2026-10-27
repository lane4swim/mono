import { describe, it, expect, beforeEach } from 'vitest';
import {
  createRefereesService,
  RefereeAssignmentForbiddenError,
  RefereeAssignmentNotFoundError,
  ForeignCompetitionError,
  type RefereesService,
} from '../../src/modules/referees/referees.service.js';
import { InMemoryRefereeAssignmentRepository, InMemoryCompetitionRepository } from '../../src/modules/referees/referees.repository.memory.js';
import { InMemoryUserRepository } from '../../src/modules/auth/auth.repository.memory.js';
import { UserNotFoundError } from '../../src/modules/auth/auth.service.js';
import { createAuditLogService } from '../../src/modules/auditLog/auditLog.service.js';
import { InMemoryAuditLogRepository } from '../../src/modules/auditLog/auditLog.repository.memory.js';
import { createRefereeNotifier } from '../../src/modules/referees/referees.notify.js';
import { InMemoryPushSender } from '../../src/push/pusher.memory.js';
import { InMemoryPushSubscriptionRepository } from '../../src/modules/push/push.repository.memory.js';

const CLUB_A = '11111111-1111-1111-1111-111111111111';
const CLUB_B = '22222222-2222-2222-2222-222222222222';
const COMPETITION_IN_CLUB_A = '33333333-3333-3333-3333-333333333333';
const COMPETITION_IN_CLUB_B = '44444444-4444-4444-4444-444444444444';

function baseInput(overrides: Partial<{ competitionName: string; competitionPlace: string; competitionId: string | null; date: Date; function: string; note: string }> = {}) {
  return {
    competitionName: 'Kreismeisterschaft',
    competitionPlace: 'Musterstadt',
    competitionId: null,
    date: new Date('2026-03-01'),
    function: 'zeitnehmer',
    note: '',
    ...overrides,
  };
}

async function buildFixture() {
  const users = new InMemoryUserRepository();
  const admin = await users.create({ clubId: CLUB_A, name: 'Admina Musterfrau', email: 'admin@a.de', passwordHash: 'x', roles: ['admin'], consentGivenAt: new Date(), consentVersion: 'v1' });
  const referee = await users.create({ clubId: CLUB_A, name: 'Ronja Kampfrichter', email: 'referee@a.de', passwordHash: 'x', roles: ['referee'], consentGivenAt: new Date(), consentVersion: 'v1' });
  const otherClubReferee = await users.create({ clubId: CLUB_B, name: 'Ben Zwei', email: 'referee@b.de', passwordHash: 'x', roles: ['referee'], consentGivenAt: new Date(), consentVersion: 'v1' });

  const assignments = new InMemoryRefereeAssignmentRepository();
  const competitions = new InMemoryCompetitionRepository([
    { id: COMPETITION_IN_CLUB_A, clubId: CLUB_A },
    { id: COMPETITION_IN_CLUB_B, clubId: CLUB_B },
  ]);
  const auditLogEntries = new InMemoryAuditLogRepository();
  const service = createRefereesService({ assignments, users, competitions, auditLog: createAuditLogService({ entries: auditLogEntries, users }) });
  return { service, users, assignments, admin, referee, otherClubReferee, auditLogEntries };
}

let fixture: Awaited<ReturnType<typeof buildFixture>>;
let service: RefereesService;

beforeEach(async () => {
  fixture = await buildFixture();
  service = fixture.service;
});

describe('createOwn()', () => {
  it('legt einen Einsatz für die eigene Person an, createdByAdminId bleibt null', async () => {
    const { referee } = fixture;
    const created = await service.createOwn(baseInput(), { id: referee.id, roles: ['referee'], clubId: referee.clubId });
    expect(created.userId).toBe(referee.id);
    expect(created.createdByAdminId).toBeNull();
    // deletedAt ist nicht Teil der öffentlichen Antwort (Datenminimierung).
    expect('deletedAt' in created).toBe(false);
  });

  it('lehnt ein competitionId ab, das zu einem fremden Verein gehört', async () => {
    const { referee } = fixture;
    await expect(
      service.createOwn(baseInput({ competitionId: COMPETITION_IN_CLUB_B }), { id: referee.id, roles: ['referee'], clubId: referee.clubId }),
    ).rejects.toBeInstanceOf(ForeignCompetitionError);
  });

  it('akzeptiert ein competitionId aus dem eigenen Verein', async () => {
    const { referee } = fixture;
    const created = await service.createOwn(baseInput({ competitionId: COMPETITION_IN_CLUB_A }), { id: referee.id, roles: ['referee'], clubId: referee.clubId });
    expect(created.competitionId).toBe(COMPETITION_IN_CLUB_A);
  });
});

describe('listOwn() / listForMember()', () => {
  it('listOwn() liefert nur die eigenen Einsätze', async () => {
    const { admin, referee } = fixture;
    await service.createOwn(baseInput(), { id: referee.id, roles: ['referee'], clubId: referee.clubId });
    const own = await service.listOwn({ id: referee.id, roles: ['referee'], clubId: referee.clubId });
    expect(own).toHaveLength(1);
    const adminOwn = await service.listOwn({ id: admin.id, roles: ['admin'], clubId: admin.clubId });
    expect(adminOwn).toHaveLength(0);
  });

  it('listForMember() ist admin-only', async () => {
    const { referee } = fixture;
    await expect(
      service.listForMember(referee.id, { id: referee.id, roles: ['referee'], clubId: referee.clubId }),
    ).rejects.toBeInstanceOf(RefereeAssignmentForbiddenError);
  });

  it('admin darf keine Einsätze eines Mitglieds eines FREMDEN Vereins einsehen', async () => {
    const { admin, otherClubReferee } = fixture;
    await expect(
      service.listForMember(otherClubReferee.id, { id: admin.id, roles: ['admin'], clubId: admin.clubId }),
    ).rejects.toBeInstanceOf(RefereeAssignmentForbiddenError);
  });
});

describe('updateOwn()', () => {
  it('erlaubt der Kampfrichter:in, den eigenen Einsatz zu bearbeiten', async () => {
    const { referee } = fixture;
    const created = await service.createOwn(baseInput(), { id: referee.id, roles: ['referee'], clubId: referee.clubId });
    const updated = await service.updateOwn(created.id, { note: 'War ein toller Wettkampf' }, { id: referee.id, roles: ['referee'], clubId: referee.clubId });
    expect(updated.note).toBe('War ein toller Wettkampf');
  });

  it('lässt createdByAdminId bei Selbstbearbeitung unverändert stehen', async () => {
    const { admin, referee } = fixture;
    const createdByAdmin = await service.createForMember(referee.id, baseInput(), { id: admin.id, roles: ['admin'], clubId: admin.clubId });
    expect(createdByAdmin.createdByAdminId).toBe(admin.id);

    const updated = await service.updateOwn(createdByAdmin.id, { note: 'Selbst ergänzt' }, { id: referee.id, roles: ['referee'], clubId: referee.clubId });
    expect(updated.createdByAdminId).toBe(admin.id);
  });

  it('wirft RefereeAssignmentNotFoundError für den Einsatz einer anderen Person', async () => {
    const { referee, otherClubReferee } = fixture;
    const created = await service.createOwn(baseInput(), { id: otherClubReferee.id, roles: ['referee'], clubId: otherClubReferee.clubId });
    await expect(
      service.updateOwn(created.id, { note: 'x' }, { id: referee.id, roles: ['referee'], clubId: referee.clubId }),
    ).rejects.toBeInstanceOf(RefereeAssignmentNotFoundError);
  });
});

describe('createForMember() / updateForMember() / removeForMember()', () => {
  it('admin kann im Namen einer Kampfrichter:in einen Einsatz anlegen — createdByAdminId zeigt auf die admin-Person', async () => {
    const { admin, referee } = fixture;
    const created = await service.createForMember(referee.id, baseInput(), { id: admin.id, roles: ['admin'], clubId: admin.clubId });
    expect(created.userId).toBe(referee.id);
    expect(created.createdByAdminId).toBe(admin.id);
  });

  it('admin darf keinen Einsatz für ein Mitglied eines FREMDEN Vereins anlegen', async () => {
    const { admin, otherClubReferee } = fixture;
    await expect(
      service.createForMember(otherClubReferee.id, baseInput(), { id: admin.id, roles: ['admin'], clubId: admin.clubId }),
    ).rejects.toBeInstanceOf(RefereeAssignmentForbiddenError);
  });

  it('referee (ohne admin-Rolle) darf keinen Einsatz im Namen einer anderen Person anlegen', async () => {
    const { referee, otherClubReferee } = fixture;
    await expect(
      service.createForMember(otherClubReferee.id, baseInput(), { id: referee.id, roles: ['referee'], clubId: referee.clubId }),
    ).rejects.toBeInstanceOf(RefereeAssignmentForbiddenError);
  });

  it('updateForMember() setzt createdByAdminId auf die zuletzt bearbeitende admin-Person, auch bei einem ursprünglich selbst angelegten Eintrag', async () => {
    const { admin, referee } = fixture;
    const created = await service.createOwn(baseInput(), { id: referee.id, roles: ['referee'], clubId: referee.clubId });
    expect(created.createdByAdminId).toBeNull();

    const updated = await service.updateForMember(referee.id, created.id, { note: 'von admin nachgetragen' }, { id: admin.id, roles: ['admin'], clubId: admin.clubId });
    expect(updated.createdByAdminId).toBe(admin.id);
    expect(updated.note).toBe('von admin nachgetragen');
  });

  it('removeForMember() entfernt einen Einsatz per Soft-Delete', async () => {
    const { admin, referee } = fixture;
    const created = await service.createForMember(referee.id, baseInput(), { id: admin.id, roles: ['admin'], clubId: admin.clubId });
    await service.removeForMember(referee.id, created.id, { id: admin.id, roles: ['admin'], clubId: admin.clubId });
    const remaining = await service.listForMember(referee.id, { id: admin.id, roles: ['admin'], clubId: admin.clubId });
    expect(remaining).toHaveLength(0);
  });

  it('wirft UserNotFoundError für eine nicht existierende Zielperson', async () => {
    const { admin } = fixture;
    await expect(
      service.createForMember('99999999-9999-9999-9999-999999999999', baseInput(), { id: admin.id, roles: ['admin'], clubId: admin.clubId }),
    ).rejects.toBeInstanceOf(UserNotFoundError);
  });
});

// Issue #96: Einsätze, die ein Admin "im Namen von" verwaltet, landen im
// Audit-Log — die Selbsterfassung nicht.
describe('Audit-Log (Issue #96)', () => {
  it('protokolliert Anlegen, Ändern und Löschen im Namen eines Mitglieds', async () => {
    const { admin, referee, auditLogEntries } = fixture;
    const requester = { id: admin.id, roles: ['admin'], clubId: admin.clubId };
    const created = await service.createForMember(referee.id, baseInput(), requester);
    await service.updateForMember(referee.id, created.id, { note: 'nachgetragen' }, requester);
    await service.removeForMember(referee.id, created.id, requester);

    const entries = await auditLogEntries.list({ limit: 10 });
    expect(entries.map((e) => e.action).sort()).toEqual(['refereeAssignment.created', 'refereeAssignment.deleted', 'refereeAssignment.updated']);
    expect(entries[0]).toMatchObject({ actorId: admin.id, targetId: referee.id, targetLabel: `${referee.name} <${referee.email}>` });
    expect(entries[0]!.metadata).toMatchObject({ assignmentId: created.id, competitionName: created.competitionName });
  });

  it('protokolliert die Selbsterfassung eigener Einsätze nicht', async () => {
    const { referee, auditLogEntries } = fixture;
    await service.createOwn(baseInput(), { id: referee.id, roles: ['referee'], clubId: referee.clubId });
    expect(await auditLogEntries.list({ limit: 10 })).toEqual([]);
  });
});

describe('Rückmeldung (Zu-/Absage) und Benachrichtigungen', () => {
  async function withNotify() {
    const { users, assignments, admin, referee } = fixture;
    const pusher = new InMemoryPushSender();
    const pushSubscriptions = new InMemoryPushSubscriptionRepository();
    await pushSubscriptions.upsert(referee.id, 'https://push.example/referee', { p256dh: 'k', auth: 'a' });
    await pushSubscriptions.upsert(admin.id, 'https://push.example/admin', { p256dh: 'k', auth: 'a' });
    const svc = createRefereesService({
      assignments, users, competitions: new InMemoryCompetitionRepository([]),
      auditLog: createAuditLogService({ entries: new InMemoryAuditLogRepository(), users }),
      notify: createRefereeNotifier({ pusher, pushSubscriptions }),
    });
    const adminCtx = { id: admin.id, roles: ['admin'], clubId: admin.clubId };
    const refereeCtx = { id: referee.id, roles: ['referee'], clubId: referee.clubId };
    return { svc, pusher, adminCtx, refereeCtx };
  }

  it('Selbsterfassung ist sofort bestätigt, admin-Anfrage startet als "requested" und benachrichtigt', async () => {
    const { svc, pusher, adminCtx, refereeCtx } = await withNotify();
    expect((await svc.createOwn(baseInput(), refereeCtx)).status).toBe('confirmed');
    expect(pusher.sent).toHaveLength(0);
    const requested = await svc.createForMember(fixture.referee.id, baseInput(), adminCtx);
    expect(requested).toMatchObject({ status: 'requested', respondedAt: null });
    expect(pusher.sent).toHaveLength(1);
    expect(pusher.sent[0]!.subscriptions[0]!.endpoint).toBe('https://push.example/referee');
    expect(pusher.sent[0]!.payload.url).toBe('#/calendar/week/2026-03-01');
  });

  it('Zu-/Absage setzt Status, Kommentar und Zeitpunkt und benachrichtigt die anfragende admin-Person', async () => {
    const { svc, pusher, adminCtx, refereeCtx } = await withNotify();
    const requested = await svc.createForMember(fixture.referee.id, baseInput(), adminCtx);
    const declined = await svc.respondOwn(requested.id, { status: 'declined', responseNote: 'Urlaub' }, refereeCtx);
    expect(declined).toMatchObject({ status: 'declined', responseNote: 'Urlaub' });
    expect(declined.respondedAt).toBeInstanceOf(Date);
    const toAdmin = pusher.sent.at(-1)!;
    expect(toAdmin.subscriptions[0]!.endpoint).toBe('https://push.example/admin');
    expect(toAdmin.payload.title).toContain('abgesagt');
    expect(toAdmin.payload.body).toContain('Ronja Kampfrichter');
    // Antwort ändern ist erlaubt; dieselbe Antwort erneut löst nichts aus.
    await svc.respondOwn(requested.id, { status: 'confirmed', responseNote: '' }, refereeCtx);
    const count = pusher.sent.length;
    await svc.respondOwn(requested.id, { status: 'confirmed', responseNote: '' }, refereeCtx);
    expect(pusher.sent).toHaveLength(count);
  });

  it('nur eigene Einsätze lassen sich beantworten', async () => {
    const { svc, adminCtx } = await withNotify();
    const requested = await svc.createForMember(fixture.referee.id, baseInput(), adminCtx);
    const other = { id: fixture.otherClubReferee.id, roles: ['referee'], clubId: fixture.otherClubReferee.clubId };
    await expect(svc.respondOwn(requested.id, { status: 'confirmed', responseNote: '' }, other)).rejects.toThrow(RefereeAssignmentNotFoundError);
  });

  it('ändert ein admin Eckdaten, wird erneut angefragt — eine reine Notiz-Änderung nicht', async () => {
    const { svc, pusher, adminCtx, refereeCtx } = await withNotify();
    const requested = await svc.createForMember(fixture.referee.id, baseInput(), adminCtx);
    await svc.respondOwn(requested.id, { status: 'confirmed', responseNote: 'gern' }, refereeCtx);
    const noteOnly = await svc.updateForMember(fixture.referee.id, requested.id, { note: 'Treffpunkt 8 Uhr' }, adminCtx);
    expect(noteOnly.status).toBe('confirmed');
    const sameDate = await svc.updateForMember(fixture.referee.id, requested.id, { date: new Date('2026-03-01') }, adminCtx);
    expect(sameDate.status).toBe('confirmed');
    const before = pusher.sent.length;
    const moved = await svc.updateForMember(fixture.referee.id, requested.id, { date: new Date('2026-03-08') }, adminCtx);
    expect(moved).toMatchObject({ status: 'requested', responseNote: '', respondedAt: null });
    expect(pusher.sent).toHaveLength(before + 1);
  });

  it('ein Versandfehler lässt die Anfrage nicht scheitern', async () => {
    const { users, assignments, admin, referee } = fixture;
    const errors: unknown[] = [];
    const svc = createRefereesService({
      assignments, users, competitions: new InMemoryCompetitionRepository([]),
      auditLog: createAuditLogService({ entries: new InMemoryAuditLogRepository(), users }),
      notify: { assignmentRequested: async () => { throw new Error('push down'); }, assignmentAnswered: async () => {} },
      onNotifyError: (e) => errors.push(e),
    });
    const created = await svc.createForMember(referee.id, baseInput(), { id: admin.id, roles: ['admin'], clubId: admin.clubId });
    expect(created.status).toBe('requested');
    expect(errors).toHaveLength(1);
  });
});

describe('listUpcomingForClub()', () => {
  it('liefert nur kommende Einsätze des eigenen Vereins, aufsteigend; nur für admin', async () => {
    const { admin, referee, otherClubReferee } = fixture;
    const adminCtx = { id: admin.id, roles: ['admin'], clubId: admin.clubId };
    await service.createForMember(referee.id, baseInput({ date: new Date('2026-05-10'), competitionName: 'Später' }), adminCtx);
    await service.createForMember(referee.id, baseInput({ date: new Date('2026-04-01'), competitionName: 'Früher' }), adminCtx);
    await service.createForMember(referee.id, baseInput({ date: new Date('2026-01-01'), competitionName: 'Vorbei' }), adminCtx);
    await service.createOwn(baseInput({ date: new Date('2026-05-01') }), { id: otherClubReferee.id, roles: ['referee'], clubId: otherClubReferee.clubId });
    const list = await service.listUpcomingForClub(adminCtx, new Date('2026-03-15T10:00:00Z'));
    expect(list.map((a) => a.competitionName)).toEqual(['Früher', 'Später']);
    await expect(service.listUpcomingForClub({ id: referee.id, roles: ['referee'], clubId: referee.clubId })).rejects.toThrow(RefereeAssignmentForbiddenError);
  });
});

describe('listForCompetition()', () => {
  it('liefert die aktiven Einsätze zu einem eigenen Wettkampf; nur für admin', async () => {
    const { admin, referee } = fixture;
    const adminCtx = { id: admin.id, roles: ['admin'], clubId: admin.clubId };
    const linked = await service.createForMember(referee.id, baseInput({ competitionId: COMPETITION_IN_CLUB_A }), adminCtx);
    const removed = await service.createForMember(referee.id, baseInput({ competitionId: COMPETITION_IN_CLUB_A, function: 'startrichter' }), adminCtx);
    await service.createForMember(referee.id, baseInput(), adminCtx);
    await service.removeForMember(referee.id, removed.id, adminCtx);
    const list = await service.listForCompetition(COMPETITION_IN_CLUB_A, adminCtx);
    expect(list.map((a) => a.id)).toEqual([linked.id]);
    expect('deletedAt' in list[0]!).toBe(false);
    await expect(service.listForCompetition(COMPETITION_IN_CLUB_A, { id: referee.id, roles: ['referee'], clubId: referee.clubId })).rejects.toThrow(RefereeAssignmentForbiddenError);
  });

  it('lehnt einen Wettkampf eines fremden Vereins oder einen unbekannten Wettkampf ab', async () => {
    const { admin } = fixture;
    const adminCtx = { id: admin.id, roles: ['admin'], clubId: admin.clubId };
    await expect(service.listForCompetition(COMPETITION_IN_CLUB_B, adminCtx)).rejects.toBeInstanceOf(ForeignCompetitionError);
    await expect(service.listForCompetition('99999999-9999-9999-9999-999999999999', adminCtx)).rejects.toBeInstanceOf(ForeignCompetitionError);
  });
});
