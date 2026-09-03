// packages/shared-types/test/qualification.test.ts
import { describe, it, expect } from 'vitest';
import {
  QualificationTypeSchema,
  UserQualificationSchema,
  CreateUserQualificationRequestSchema,
  UpdateUserQualificationRequestSchema,
  QualificationReminderSettingSchema,
  UpdateQualificationReminderSettingRequestSchema,
  DEFAULT_QUALIFICATION_REMINDER_THRESHOLDS_DAYS,
} from '../src/qualification.js';

const validQualification = {
  id: '11111111-1111-1111-1111-111111111111',
  userId: '22222222-2222-2222-2222-222222222222',
  type: 'trainer_c',
  note: '',
  acquiredOn: '2024-01-01T00:00:00.000Z',
  expiresOn: '2027-01-01T00:00:00.000Z',
  renewalCourseOrganizedOn: null,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
};

describe('QualificationTypeSchema', () => {
  it('akzeptiert alle acht dokumentierten Qualifikationsarten', () => {
    const types = ['trainer_c', 'trainer_b', 'trainer_a', 'rettungsschwimmer_silber', 'rettungsschwimmer_gold', 'erste_hilfe', 'kinderschutz', 'sonstige'];
    for (const type of types) expect(QualificationTypeSchema.safeParse(type).success).toBe(true);
  });
  it('lehnt einen unbekannten Wert ab', () => {
    expect(QualificationTypeSchema.safeParse('irgendwas').success).toBe(false);
  });
});

describe('UserQualificationSchema', () => {
  it('akzeptiert eine gültige Qualifikation', () => {
    expect(UserQualificationSchema.safeParse(validQualification).success).toBe(true);
  });
  it('akzeptiert eine Qualifikation ohne Ablaufdatum ("unbefristet")', () => {
    expect(UserQualificationSchema.safeParse({ ...validQualification, expiresOn: null }).success).toBe(true);
  });
  it('lehnt ein expiresOn vor acquiredOn ab', () => {
    const result = UserQualificationSchema.safeParse({ ...validQualification, acquiredOn: '2027-01-01T00:00:00.000Z', expiresOn: '2024-01-01T00:00:00.000Z' });
    expect(result.success).toBe(false);
  });
  it('akzeptiert expiresOn === acquiredOn (Grenzfall)', () => {
    const result = UserQualificationSchema.safeParse({ ...validQualification, acquiredOn: validQualification.expiresOn, expiresOn: validQualification.expiresOn });
    expect(result.success).toBe(true);
  });
  it('lehnt unbekannte Zusatzfelder ab (.strict())', () => {
    expect(UserQualificationSchema.safeParse({ ...validQualification, unknownField: 'x' }).success).toBe(false);
  });
});

describe('CreateUserQualificationRequestSchema', () => {
  it('akzeptiert eine minimale Anfrage (nur Pflichtfelder)', () => {
    const req = { type: 'erste_hilfe', acquiredOn: '2024-01-01T00:00:00.000Z' };
    const parsed = CreateUserQualificationRequestSchema.safeParse(req);
    expect(parsed.success).toBe(true);
    // note trägt einen Default ('') — auch bei einer minimalen Anfrage im
    // Ergebnis ein regulärer String, kein `undefined` (Regressionsschutz
    // für die parseInput()-Inferenz in apps/api/src/plugins/parseInput.ts).
    if (parsed.success) expect(parsed.data.note).toBe('');
  });
  it('lehnt ein expiresOn vor acquiredOn ab', () => {
    const req = { type: 'erste_hilfe', acquiredOn: '2027-01-01T00:00:00.000Z', expiresOn: '2024-01-01T00:00:00.000Z' };
    expect(CreateUserQualificationRequestSchema.safeParse(req).success).toBe(false);
  });
  it('lehnt eine Anfrage ohne acquiredOn ab', () => {
    expect(CreateUserQualificationRequestSchema.safeParse({ type: 'erste_hilfe' }).success).toBe(false);
  });
});

describe('UpdateUserQualificationRequestSchema', () => {
  it('akzeptiert ein leeres Patch (keine Felder geändert)', () => {
    expect(UpdateUserQualificationRequestSchema.safeParse({}).success).toBe(true);
  });
  it('akzeptiert ein Patch, das nur renewalCourseOrganizedOn setzt', () => {
    expect(UpdateUserQualificationRequestSchema.safeParse({ renewalCourseOrganizedOn: '2026-06-01T00:00:00.000Z' }).success).toBe(true);
  });
  it('akzeptiert explizites null für expiresOn (Ablauf entfernen)', () => {
    expect(UpdateUserQualificationRequestSchema.safeParse({ expiresOn: null }).success).toBe(true);
  });
});

describe('QualificationReminderSettingSchema', () => {
  it('akzeptiert eine gültige Schwellen-Konfiguration', () => {
    expect(QualificationReminderSettingSchema.safeParse({ type: 'trainer_a', thresholdsDays: [60, 14] }).success).toBe(true);
  });
  it('lehnt eine leere Schwellenliste ab', () => {
    expect(QualificationReminderSettingSchema.safeParse({ type: 'trainer_a', thresholdsDays: [] }).success).toBe(false);
  });
  it('lehnt einen negativen Schwellenwert ab', () => {
    expect(QualificationReminderSettingSchema.safeParse({ type: 'trainer_a', thresholdsDays: [-5] }).success).toBe(false);
  });
});

describe('UpdateQualificationReminderSettingRequestSchema', () => {
  it('akzeptiert eine gültige Schwellenliste', () => {
    expect(UpdateQualificationReminderSettingRequestSchema.safeParse({ thresholdsDays: [30] }).success).toBe(true);
  });
});

describe('DEFAULT_QUALIFICATION_REMINDER_THRESHOLDS_DAYS', () => {
  it('ist eine nicht-leere Liste positiver Ganzzahlen', () => {
    expect(DEFAULT_QUALIFICATION_REMINDER_THRESHOLDS_DAYS.length).toBeGreaterThan(0);
    for (const d of DEFAULT_QUALIFICATION_REMINDER_THRESHOLDS_DAYS) expect(Number.isInteger(d) && d > 0).toBe(true);
  });
});
