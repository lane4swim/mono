// packages/shared-types/test/auth.test.ts
import { describe, it, expect } from 'vitest';
import {
  LoginRequestSchema,
  UpdateMeRequestSchema,
  AccessTokenClaimsSchema,
  ForgotPasswordRequestSchema,
  ResetPasswordRequestSchema,
  ChangePasswordRequestSchema,
} from '../src/auth.js';

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

  // Regressionstest für Befund R4 (Code-Review): das nachgestellte
  // .refine() auf consentField konnte NIE fehlschlagen (z.literal(true)
  // lässt bereits nur `true` durch) — die deutsche Meldung erschien daher
  // nie, stattdessen Zods generische "Invalid literal value"-Meldung.
  it('liefert die deutsche Einwilligungs-Meldung, wenn consent fehlt', () => {
    const result = LoginRequestSchema.safeParse({ email: 'a@b.de', password: 'x' });
    expect(result.success).toBe(false);
    if (!result.success) {
      const consentIssue = result.error.issues.find((i) => i.path.join('.') === 'consent');
      expect(consentIssue?.message).toBe('Die Einwilligung zur Datenverarbeitung ist erforderlich.');
    }
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

// Sicherheitsreview 2026-08, Befund M5 ("Passwort vergessen" +
// Passwortwechsel).
describe('ForgotPasswordRequestSchema', () => {
  it('akzeptiert eine gültige E-Mail-Adresse', () => {
    expect(ForgotPasswordRequestSchema.safeParse({ email: 'a@b.de' }).success).toBe(true);
  });
  it('lehnt eine ungültige E-Mail ab', () => {
    expect(ForgotPasswordRequestSchema.safeParse({ email: 'keine-email' }).success).toBe(false);
  });
});

describe('ResetPasswordRequestSchema', () => {
  it('akzeptiert Token + ein ausreichend langes neues Passwort', () => {
    expect(ResetPasswordRequestSchema.safeParse({ token: 'abc123', newPassword: 'ein-sicheres-passwort' }).success).toBe(true);
  });
  it('lehnt ein zu kurzes neues Passwort ab (< 8 Zeichen)', () => {
    expect(ResetPasswordRequestSchema.safeParse({ token: 'abc123', newPassword: 'kurz' }).success).toBe(false);
  });
  it('lehnt ein leeres Token ab', () => {
    expect(ResetPasswordRequestSchema.safeParse({ token: '', newPassword: 'ein-sicheres-passwort' }).success).toBe(false);
  });
});

describe('ChangePasswordRequestSchema', () => {
  it('akzeptiert aktuelles + ein ausreichend langes neues Passwort', () => {
    expect(ChangePasswordRequestSchema.safeParse({ currentPassword: 'alt', newPassword: 'ein-sicheres-passwort' }).success).toBe(true);
  });
  it('lehnt ein zu kurzes neues Passwort ab (< 8 Zeichen)', () => {
    expect(ChangePasswordRequestSchema.safeParse({ currentPassword: 'alt', newPassword: 'kurz' }).success).toBe(false);
  });
  it('lehnt ein leeres aktuelles Passwort ab', () => {
    expect(ChangePasswordRequestSchema.safeParse({ currentPassword: '', newPassword: 'ein-sicheres-passwort' }).success).toBe(false);
  });
});
