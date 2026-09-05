// apps/api/test/qualifications/qualifications.service.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createQualificationsService, QualificationForbiddenError, QualificationNotFoundError, QualificationInvalidDateRangeError, type QualificationsService } from '../../src/modules/qualifications/qualifications.service.js';
import { InMemoryUserQualificationRepository, InMemoryQualificationReminderSettingRepository } from '../../src/modules/qualifications/qualifications.repository.memory.js';
import { InMemoryUserRepository } from '../../src/modules/auth/auth.repository.memory.js';
import { UserNotFoundError } from '../../src/modules/auth/auth.service.js';

const CLUB_A = '11111111-1111-1111-1111-111111111111';
const CLUB_B = '22222222-2222-2222-2222-222222222222';

async function buildFixture() {
  const users = new InMemoryUserRepository();
  const admin = await users.create({ clubId: CLUB_A, name: 'Admina Musterfrau', email: 'admin@a.de', passwordHash: 'x', roles: ['admin'], consentGivenAt: new Date(), consentVersion: 'v1' });
  const trainer = await users.create({ clubId: CLUB_A, name: 'Trainer Eins', email: 'trainer@a.de', passwordHash: 'x', roles: ['trainer'], consentGivenAt: new Date(), consentVersion: 'v1' });
  const otherClubTrainer = await users.create({ clubId: CLUB_B, name: 'Trainer Zwei', email: 'trainer@b.de', passwordHash: 'x', roles: ['trainer'], consentGivenAt: new Date(), consentVersion: 'v1' });

  const qualifications = new InMemoryUserQualificationRepository();
  const reminderSettings = new InMemoryQualificationReminderSettingRepository();
  const service = createQualificationsService({ qualifications, reminderSettings, users });
  return { service, users, qualifications, reminderSettings, admin, trainer, otherClubTrainer };
}

let fixture: Awaited<ReturnType<typeof buildFixture>>;
let service: QualificationsService;

beforeEach(async () => {
  fixture = await buildFixture();
  service = fixture.service;
});

describe('create()', () => {
  it('admin kann eine Qualifikation für ein Mitglied des eigenen Vereins anlegen', async () => {
    const { admin, trainer } = fixture;
    const created = await service.create(trainer.id, { type: 'erste_hilfe', note: '', acquiredOn: new Date('2024-01-01'), expiresOn: null, renewalCourseOrganizedOn: null }, { id: admin.id, roles: ['admin'], clubId: admin.clubId });
    expect(created.type).toBe('erste_hilfe');
    expect(created.userId).toBe(trainer.id);
    // deletedAt ist nicht Teil der öffentlichen Antwort (Datenminimierung).
    expect('deletedAt' in created).toBe(false);
  });

  it('trainer darf keine Qualifikation anlegen (auch nicht die eigene)', async () => {
    const { trainer } = fixture;
    await expect(
      service.create(trainer.id, { type: 'erste_hilfe', note: '', acquiredOn: new Date(), expiresOn: null, renewalCourseOrganizedOn: null }, { id: trainer.id, roles: ['trainer'], clubId: trainer.clubId }),
    ).rejects.toBeInstanceOf(QualificationForbiddenError);
  });

  it('admin darf keine Qualifikation für ein Mitglied eines FREMDEN Vereins anlegen', async () => {
    const { admin, otherClubTrainer } = fixture;
    await expect(
      service.create(otherClubTrainer.id, { type: 'erste_hilfe', note: '', acquiredOn: new Date(), expiresOn: null, renewalCourseOrganizedOn: null }, { id: admin.id, roles: ['admin'], clubId: admin.clubId }),
    ).rejects.toBeInstanceOf(QualificationForbiddenError);
  });

  it('wirft UserNotFoundError für eine nicht existierende Zielperson', async () => {
    const { admin } = fixture;
    await expect(
      service.create('99999999-9999-9999-9999-999999999999', { type: 'erste_hilfe', note: '', acquiredOn: new Date(), expiresOn: null, renewalCourseOrganizedOn: null }, { id: admin.id, roles: ['admin'], clubId: admin.clubId }),
    ).rejects.toBeInstanceOf(UserNotFoundError);
  });

  it('lehnt expiresOn vor acquiredOn ab', async () => {
    const { admin, trainer } = fixture;
    await expect(
      service.create(trainer.id, { type: 'erste_hilfe', note: '', acquiredOn: new Date('2027-01-01'), expiresOn: new Date('2024-01-01'), renewalCourseOrganizedOn: null }, { id: admin.id, roles: ['admin'], clubId: admin.clubId }),
    ).rejects.toBeInstanceOf(QualificationInvalidDateRangeError);
  });
});

describe('listOwn() / listForMember()', () => {
  it('listOwn() liefert nur die eigenen Qualifikationen, unabhängig von der Rolle', async () => {
    const { admin, trainer } = fixture;
    await service.create(trainer.id, { type: 'erste_hilfe', note: '', acquiredOn: new Date(), expiresOn: null, renewalCourseOrganizedOn: null }, { id: admin.id, roles: ['admin'], clubId: admin.clubId });
    const own = await service.listOwn({ id: trainer.id, roles: ['trainer'], clubId: trainer.clubId });
    expect(own).toHaveLength(1);
    const adminOwn = await service.listOwn({ id: admin.id, roles: ['admin'], clubId: admin.clubId });
    expect(adminOwn).toHaveLength(0);
  });

  it('listForMember() ist admin-only', async () => {
    const { trainer } = fixture;
    await expect(service.listForMember(trainer.id, { id: trainer.id, roles: ['trainer'], clubId: trainer.clubId })).rejects.toBeInstanceOf(QualificationForbiddenError);
  });
});

describe('update()', () => {
  it('erlaubt ein Patch, das nur renewalCourseOrganizedOn setzt, ohne acquiredOn erneut mitzuschicken', async () => {
    const { admin, trainer } = fixture;
    const created = await service.create(trainer.id, { type: 'trainer_c', note: '', acquiredOn: new Date('2024-01-01'), expiresOn: new Date('2026-01-01'), renewalCourseOrganizedOn: null }, { id: admin.id, roles: ['admin'], clubId: admin.clubId });
    const updated = await service.update(trainer.id, created.id, { renewalCourseOrganizedOn: new Date('2025-11-01') }, { id: admin.id, roles: ['admin'], clubId: admin.clubId });
    expect(updated.renewalCourseOrganizedOn?.toISOString().slice(0, 10)).toBe('2025-11-01');
    expect(updated.acquiredOn.toISOString().slice(0, 10)).toBe('2024-01-01');
  });

  it('lehnt ein Patch ab, das expiresOn vor das bestehende acquiredOn setzt', async () => {
    const { admin, trainer } = fixture;
    const created = await service.create(trainer.id, { type: 'trainer_c', note: '', acquiredOn: new Date('2024-06-01'), expiresOn: null, renewalCourseOrganizedOn: null }, { id: admin.id, roles: ['admin'], clubId: admin.clubId });
    await expect(
      service.update(trainer.id, created.id, { expiresOn: new Date('2024-01-01') }, { id: admin.id, roles: ['admin'], clubId: admin.clubId }),
    ).rejects.toBeInstanceOf(QualificationInvalidDateRangeError);
  });

  it('wirft QualificationNotFoundError für eine fremde/nicht existierende id', async () => {
    const { admin, trainer } = fixture;
    await expect(
      service.update(trainer.id, 'does-not-exist', { note: 'x' }, { id: admin.id, roles: ['admin'], clubId: admin.clubId }),
    ).rejects.toBeInstanceOf(QualificationNotFoundError);
  });
});

describe('remove()', () => {
  it('entfernt eine Qualifikation per Soft-Delete (taucht danach nicht mehr in listForMember() auf)', async () => {
    const { admin, trainer } = fixture;
    const created = await service.create(trainer.id, { type: 'erste_hilfe', note: '', acquiredOn: new Date(), expiresOn: null, renewalCourseOrganizedOn: null }, { id: admin.id, roles: ['admin'], clubId: admin.clubId });
    await service.remove(trainer.id, created.id, { id: admin.id, roles: ['admin'], clubId: admin.clubId });
    const remaining = await service.listForMember(trainer.id, { id: admin.id, roles: ['admin'], clubId: admin.clubId });
    expect(remaining).toHaveLength(0);
  });
});

describe('Erinnerungs-Schwellen (Abschnitt 2.4 des Plans)', () => {
  it('setReminderSetting() ist admin-only, listReminderSettings() ist für jede Rolle lesbar (für den eigenen Status-Badge)', async () => {
    const { admin, trainer } = fixture;
    await expect(service.setReminderSetting('trainer_a', [60, 14], { id: trainer.id, roles: ['trainer'], clubId: trainer.clubId })).rejects.toBeInstanceOf(QualificationForbiddenError);

    const saved = await service.setReminderSetting('trainer_a', [90, 30], { id: admin.id, roles: ['admin'], clubId: admin.clubId });
    expect(saved).toEqual({ type: 'trainer_a', thresholdsDays: [90, 30] });

    const listedByAdmin = await service.listReminderSettings({ id: admin.id, roles: ['admin'], clubId: admin.clubId });
    expect(listedByAdmin).toEqual([{ type: 'trainer_a', thresholdsDays: [90, 30] }]);
    // trainer/athlete brauchen dieselben Werte, um den Status-Badge der
    // eigenen Qualifikationen korrekt zu berechnen (siehe
    // qualifications.route.ts: GET /api/qualification-settings läuft über
    // selfGuard, nicht adminGuard).
    const listedByTrainer = await service.listReminderSettings({ id: trainer.id, roles: ['trainer'], clubId: trainer.clubId });
    expect(listedByTrainer).toEqual([{ type: 'trainer_a', thresholdsDays: [90, 30] }]);
  });

  it('erneutes setReminderSetting() für denselben Typ überschreibt statt zu duplizieren', async () => {
    const { admin } = fixture;
    await service.setReminderSetting('trainer_a', [90], { id: admin.id, roles: ['admin'], clubId: admin.clubId });
    await service.setReminderSetting('trainer_a', [30], { id: admin.id, roles: ['admin'], clubId: admin.clubId });
    const listed = await service.listReminderSettings({ id: admin.id, roles: ['admin'], clubId: admin.clubId });
    expect(listed).toEqual([{ type: 'trainer_a', thresholdsDays: [30] }]);
  });
});
