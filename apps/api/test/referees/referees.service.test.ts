// apps/api/test/referees/referees.service.test.ts
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
  const service = createRefereesService({ assignments, users, competitions });
  return { service, users, assignments, admin, referee, otherClubReferee };
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
