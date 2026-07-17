// packages/shared-types/test/user.test.ts
import { describe, it, expect } from 'vitest';
import { UserSchema, RoleSchema } from '../src/user.js';

describe('UserSchema', () => {
  const validUser = {
    id: '11111111-1111-1111-1111-111111111111',
    clubId: '22222222-2222-2222-2222-222222222222',
    name: 'Sabine Reuter',
    email: 'sabine.reuter@example.org',
    role: 'trainer',
    athleteId: null,
    locale: 'de-DE',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  it('akzeptiert einen gültigen Nutzer', () => {
    expect(UserSchema.safeParse(validUser).success).toBe(true);
  });

  it('lehnt eine ungültige E-Mail-Adresse ab', () => {
    expect(UserSchema.safeParse({ ...validUser, email: 'keine-email' }).success).toBe(false);
  });

  it('lehnt eine unbekannte Rolle ab', () => {
    expect(UserSchema.safeParse({ ...validUser, role: 'moderator' }).success).toBe(false);
  });

  it('lehnt eine nicht unterstützte Sprache ab', () => {
    expect(UserSchema.safeParse({ ...validUser, locale: 'fr-FR' }).success).toBe(false);
  });

  it('akzeptiert athleteId: null (Trainer:innen sind nicht mit einem Athletenprofil verknüpft)', () => {
    const parsed = UserSchema.safeParse(validUser);
    expect(parsed.success && parsed.data.athleteId).toBeNull();
  });

  it('akzeptiert clubId: null (Rolle superadmin gehört zu keinem Verein)', () => {
    expect(UserSchema.safeParse({ ...validUser, role: 'superadmin', clubId: null }).success).toBe(true);
  });
});

describe('RoleSchema', () => {
  it.each(['trainer', 'admin', 'athlete'])('akzeptiert die Rolle "%s"', (role) => {
    expect(RoleSchema.safeParse(role).success).toBe(true);
  });

  it('lehnt eine leere Rolle ab', () => {
    expect(RoleSchema.safeParse('').success).toBe(false);
  });
});
