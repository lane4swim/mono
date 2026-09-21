import { describe, it, expect, beforeEach } from 'vitest';
import { createClubLegalInfoService, type ClubLegalInfoService } from '../../src/modules/clubLegalInfo/clubLegalInfo.service.js';
import { InMemoryClubLegalInfoRepository } from '../../src/modules/clubLegalInfo/clubLegalInfo.repository.memory.js';
import { ForbiddenError, ClubNotFoundError } from '../../src/modules/invitations/invitations.service.js';

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
  const service = createClubLegalInfoService({ legalInfo });
  return { service, legalInfo };
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
      const result = await service.get(CLUB_A, { roles: [role], clubId: CLUB_A });
      expect(result.clubId).toBe(CLUB_A);
    }
  });

  it('lehnt den Abruf eines FREMDEN Vereins ab (403)', async () => {
    await expect(service.get(CLUB_B, { roles: ['admin'], clubId: CLUB_A })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('superadmin darf jeden Verein abrufen', async () => {
    const result = await service.get(CLUB_B, { roles: ['superadmin'], clubId: null });
    expect(result.clubId).toBe(CLUB_B);
  });

  it('wirft ClubNotFoundError für eine unbekannte clubId', async () => {
    await expect(service.get('99999999-9999-9999-9999-999999999999', { roles: ['superadmin'], clubId: null })).rejects.toBeInstanceOf(ClubNotFoundError);
  });
});

describe('update()', () => {
  it('admin kann die Angaben des eigenen Vereins setzen', async () => {
    const result = await service.update(CLUB_A, UPDATE_INPUT, { roles: ['admin'], clubId: CLUB_A });
    expect(result).toMatchObject(UPDATE_INPUT);

    const persisted = await fixture.legalInfo.findByClubId(CLUB_A);
    expect(persisted).toMatchObject(UPDATE_INPUT);
  });

  it('admin darf NICHT die Angaben eines fremden Vereins ändern', async () => {
    await expect(service.update(CLUB_B, UPDATE_INPUT, { roles: ['admin'], clubId: CLUB_A })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('superadmin kann die Angaben jedes Vereins ändern', async () => {
    const result = await service.update(CLUB_B, UPDATE_INPUT, { roles: ['superadmin'], clubId: null });
    expect(result).toMatchObject(UPDATE_INPUT);
  });

  it('wirft ClubNotFoundError für eine unbekannte clubId', async () => {
    await expect(
      service.update('99999999-9999-9999-9999-999999999999', UPDATE_INPUT, { roles: ['superadmin'], clubId: null }),
    ).rejects.toBeInstanceOf(ClubNotFoundError);
  });
});
