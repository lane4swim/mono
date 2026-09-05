// packages/shared-types/test/user.test.ts
import { describe, it, expect } from 'vitest';
import { UserSchema, RoleSchema, UserRolesSchema, ClubMembersResponseSchema } from '../src/user.js';

describe('ClubMembersResponseSchema', () => {
  const validUser = {
    id: '11111111-1111-1111-1111-111111111111',
    clubId: '22222222-2222-2222-2222-222222222222',
    name: 'Sabine Reuter',
    email: 'sabine.reuter@example.org',
    roles: ['trainer'],
    athleteId: null,
    locale: 'de-DE',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  it('akzeptiert eine Liste gültiger Nutzer:innen', () => {
    expect(ClubMembersResponseSchema.safeParse({ users: [validUser] }).success).toBe(true);
  });
  it('akzeptiert eine leere Liste', () => {
    expect(ClubMembersResponseSchema.safeParse({ users: [] }).success).toBe(true);
  });
  it('lehnt eine Liste mit ungültigem Eintrag ab', () => {
    expect(ClubMembersResponseSchema.safeParse({ users: [{ ...validUser, email: 'keine-email' }] }).success).toBe(false);
  });
});

describe('UserSchema', () => {
  const validUser = {
    id: '11111111-1111-1111-1111-111111111111',
    clubId: '22222222-2222-2222-2222-222222222222',
    name: 'Sabine Reuter',
    email: 'sabine.reuter@example.org',
    roles: ['trainer'],
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
    expect(UserSchema.safeParse({ ...validUser, roles: ['moderator'] }).success).toBe(false);
  });

  it('akzeptiert mehrere gleichzeitige Rollen (docs/kampfrichter-modul-plan.md, Abschnitt 1)', () => {
    expect(UserSchema.safeParse({ ...validUser, roles: ['trainer', 'athlete'] }).success).toBe(true);
  });

  it('lehnt eine nicht unterstützte Sprache ab', () => {
    expect(UserSchema.safeParse({ ...validUser, locale: 'fr-FR' }).success).toBe(false);
  });

  it('akzeptiert athleteId: null (Trainer:innen sind nicht mit einem Athletenprofil verknüpft)', () => {
    const parsed = UserSchema.safeParse(validUser);
    expect(parsed.success && parsed.data.athleteId).toBeNull();
  });

  it('akzeptiert clubId: null (Rolle superadmin gehört zu keinem Verein)', () => {
    expect(UserSchema.safeParse({ ...validUser, roles: ['superadmin'], clubId: null }).success).toBe(true);
  });
});

describe('RoleSchema', () => {
  it.each(['trainer', 'admin', 'athlete', 'referee'])('akzeptiert die Rolle "%s"', (role) => {
    expect(RoleSchema.safeParse(role).success).toBe(true);
  });

  it('lehnt eine leere Rolle ab', () => {
    expect(RoleSchema.safeParse('').success).toBe(false);
  });
});

describe('UserRolesSchema', () => {
  it('akzeptiert eine einzelne Rolle', () => {
    expect(UserRolesSchema.safeParse(['trainer']).success).toBe(true);
  });

  it('akzeptiert mehrere unterschiedliche Rollen gleichzeitig', () => {
    expect(UserRolesSchema.safeParse(['trainer', 'athlete']).success).toBe(true);
  });

  it('lehnt eine leere Rollenliste ab', () => {
    expect(UserRolesSchema.safeParse([]).success).toBe(false);
  });

  it('lehnt doppelt vorkommende Rollen ab', () => {
    expect(UserRolesSchema.safeParse(['trainer', 'trainer']).success).toBe(false);
  });

  it('akzeptiert "superadmin" allein', () => {
    expect(UserRolesSchema.safeParse(['superadmin']).success).toBe(true);
  });

  it('lehnt "superadmin" in Kombination mit einer anderen Rolle ab', () => {
    expect(UserRolesSchema.safeParse(['superadmin', 'admin']).success).toBe(false);
  });
});
