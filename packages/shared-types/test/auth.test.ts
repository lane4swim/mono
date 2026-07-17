// packages/shared-types/test/auth.test.ts
import { describe, it, expect } from 'vitest';
import { LoginRequestSchema, UpdateMeRequestSchema, AccessTokenClaimsSchema } from '../src/auth.js';

describe('LoginRequestSchema', () => {
  it('akzeptiert gültige Zugangsdaten inkl. Einwilligung', () => {
    expect(LoginRequestSchema.safeParse({ email: 'a@b.de', password: 'x', consent: true }).success).toBe(true);
  });
  it('lehnt Login ohne Einwilligung ab (DSGVO)', () => {
    expect(LoginRequestSchema.safeParse({ email: 'a@b.de', password: 'x' }).success).toBe(false);
  });
  it('lehnt Login mit consent: false ab', () => {
    expect(LoginRequestSchema.safeParse({ email: 'a@b.de', password: 'x', consent: false }).success).toBe(false);
  });
  it('lehnt eine leere E-Mail ab', () => {
    expect(LoginRequestSchema.safeParse({ email: '', password: 'x', consent: true }).success).toBe(false);
  });
});

describe('UpdateMeRequestSchema', () => {
  it('lehnt ein komplett leeres Objekt ab (mindestens ein Feld nötig)', () => {
    expect(UpdateMeRequestSchema.safeParse({}).success).toBe(false);
  });
  it('akzeptiert eine reine Namensänderung', () => {
    expect(UpdateMeRequestSchema.safeParse({ name: 'Neuer Name' }).success).toBe(true);
  });
  it('lehnt eine ungültige E-Mail ab', () => {
    expect(UpdateMeRequestSchema.safeParse({ email: 'keine-email' }).success).toBe(false);
  });
});

describe('AccessTokenClaimsSchema', () => {
  it('akzeptiert vollständige Claims inkl. athleteId: null', () => {
    const claims = {
      sub: '11111111-1111-1111-1111-111111111111',
      role: 'athlete',
      clubId: '22222222-2222-2222-2222-222222222222',
      athleteId: null,
    };
    expect(AccessTokenClaimsSchema.safeParse(claims).success).toBe(true);
  });

  it('akzeptiert clubId: null (Rolle superadmin)', () => {
    const claims = {
      sub: '11111111-1111-1111-1111-111111111111',
      role: 'superadmin',
      clubId: null,
      athleteId: null,
    };
    expect(AccessTokenClaimsSchema.safeParse(claims).success).toBe(true);
  });

  it('akzeptiert die neue Rolle "superadmin"', () => {
    const claims = {
      sub: '11111111-1111-1111-1111-111111111111',
      role: 'superadmin',
      clubId: null,
      athleteId: null,
    };
    expect(AccessTokenClaimsSchema.safeParse(claims).success).toBe(true);
  });
});
