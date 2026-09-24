import { describe, it, expect, beforeEach } from 'vitest';
import { createClubLegalInfoService, type ClubLegalInfoService } from '../../src/modules/clubLegalInfo/clubLegalInfo.service.js';
import { InMemoryClubLegalInfoRepository } from '../../src/modules/clubLegalInfo/clubLegalInfo.repository.memory.js';
import { ForbiddenError, ClubNotFoundError } from '../../src/modules/invitations/invitations.service.js';
import { createAuditLogService } from '../../src/modules/auditLog/auditLog.service.js';
import { InMemoryAuditLogRepository } from '../../src/modules/auditLog/auditLog.repository.memory.js';

const CLUB_A = '11111111-1111-1111-1111-111111111111';
const CLUB_B = '22222222-2222-2222-2222-222222222222';

const UPDATE_INPUT = {
  addressLine1: 'Schwimmbadstraße 1',
  postalCode: '12345',
  city: 'Musterstadt',
  representativeName: 'Erika Musterfrau',
  contactEmail: 'vorstand@verein-a.de',
  contactPhone: '+49 30 1234567',
  registerNumber: 'VR 1234',
  registerCourt: 'Amtsgericht Musterstadt',
  vatId: null,
  privacyContactEmail: 'datenschutz@verein-a.de',
  supervisoryAuthority: 'Landesbeauftragte für Datenschutz, Musterland',
  dpoRequired: true,
  dpoName: 'Max Mustermann',
  dpoContact: 'dpo@verein-a.de',
};

function buildFixture() {
  const legalInfo = new InMemoryClubLegalInfoRepository();
  legalInfo.seedClub(CLUB_A);
  legalInfo.seedClub(CLUB_B);
  const auditLogEntries = new InMemoryAuditLogRepository();
  const service = createClubLegalInfoService({ legalInfo, auditLog: createAuditLogService({ entries: auditLogEntries }) });
  return { service, legalInfo, auditLogEntries };
}

let fixture: ReturnType<typeof buildFixture>;
let service: ClubLegalInfoService;

beforeEach(() => {
  fixture = buildFixture();
  service = fixture.service;
});

describe('get()', () => {
  it('liefert die (leeren) Angaben für den eigenen Verein an jede Rolle', async () => {
    for (const role of ['admin', 'trainer', 'athlete', 'referee', 'parent']) {
      const result = await service.get(CLUB_A, { id: 'user-1', roles: [role], clubId: CLUB_A });
      expect(result.clubId).toBe(CLUB_A);
    }
  });

  it('lehnt den Abruf eines FREMDEN Vereins ab (403)', async () => {
    await expect(service.get(CLUB_B, { id: 'user-1', roles: ['admin'], clubId: CLUB_A })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('superadmin darf jeden Verein abrufen', async () => {
    const result = await service.get(CLUB_B, { id: 'user-1', roles: ['superadmin'], clubId: null });
    expect(result.clubId).toBe(CLUB_B);
  });

  it('wirft ClubNotFoundError für eine unbekannte clubId', async () => {
    await expect(service.get('99999999-9999-9999-9999-999999999999', { id: 'user-1', roles: ['superadmin'], clubId: null })).rejects.toBeInstanceOf(ClubNotFoundError);
  });
});

describe('update()', () => {
  it('admin kann die Angaben des eigenen Vereins setzen', async () => {
    const result = await service.update(CLUB_A, UPDATE_INPUT, { id: 'user-1', roles: ['admin'], clubId: CLUB_A });
    expect(result).toMatchObject(UPDATE_INPUT);

    const persisted = await fixture.legalInfo.findByClubId(CLUB_A);
    expect(persisted).toMatchObject(UPDATE_INPUT);
  });

  it('admin darf NICHT die Angaben eines fremden Vereins ändern', async () => {
    await expect(service.update(CLUB_B, UPDATE_INPUT, { id: 'user-1', roles: ['admin'], clubId: CLUB_A })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('superadmin kann die Angaben jedes Vereins ändern', async () => {
    const result = await service.update(CLUB_B, UPDATE_INPUT, { id: 'user-1', roles: ['superadmin'], clubId: null });
    expect(result).toMatchObject(UPDATE_INPUT);
  });

  it('wirft ClubNotFoundError für eine unbekannte clubId', async () => {
    await expect(
      service.update('99999999-9999-9999-9999-999999999999', UPDATE_INPUT, { id: 'user-1', roles: ['superadmin'], clubId: null }),
    ).rejects.toBeInstanceOf(ClubNotFoundError);
  });
});

// Issue #96: Änderungen an Impressum/Datenschutzhinweis werden protokolliert
// (nur die Feldnamen, nicht die Inhalte).
describe('update() — Audit-Log (Issue #96)', () => {
  it('protokolliert nur die tatsächlich geänderten Felder', async () => {
    const admin = { id: 'admin-a', roles: ['admin'], clubId: CLUB_A };
    await service.update(CLUB_A, UPDATE_INPUT, admin);
    await service.update(CLUB_A, { ...UPDATE_INPUT, contactEmail: 'neu@verein-a.de' }, admin);

    const entries = await fixture.auditLogEntries.list({ limit: 10 });
    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.metadata)).toContainEqual({ fields: ['contactEmail'] });
    expect(entries[0]).toMatchObject({ clubId: CLUB_A, actorId: 'admin-a', action: 'club.legalInfoChanged' });
  });

  it('protokolliert nichts, wenn sich kein Feld ändert', async () => {
    const admin = { id: 'admin-a', roles: ['admin'], clubId: CLUB_A };
    await service.update(CLUB_A, UPDATE_INPUT, admin);
    await service.update(CLUB_A, UPDATE_INPUT, admin);
    expect(await fixture.auditLogEntries.list({ limit: 10 })).toHaveLength(1);
  });
});
