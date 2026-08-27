// packages/shared-types/test/auth.test.ts
import { describe, it, expect } from 'vitest';
import {
  LoginRequestSchema,
  UpdateMeRequestSchema,
  AccessTokenClaimsSchema,
  AuthTokensResponseSchema,
  MeResponseSchema,
  ForgotPasswordRequestSchema,
  ResetPasswordRequestSchema,
  ChangePasswordRequestSchema,
  ChangeEmailRequestSchema,
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
  // Sicherheitsreview 2026-08, Befund N7: argon2id verarbeitet beliebig
  // lange Eingaben — verifyPassword() hasht das übermittelte Passwort bei
  // JEDEM Login-Versuch, ein unbegrenztes Feld wäre ein DoS-Verstärker.
  it('lehnt ein zu langes Passwort ab (> 200 Zeichen)', () => {
    expect(LoginRequestSchema.safeParse({ email: 'a@b.de', password: 'x'.repeat(201), consent: true }).success).toBe(false);
  });
});

describe('UpdateMeRequestSchema', () => {
  it('lehnt ein komplett leeres Objekt ab (mindestens ein Feld nötig)', () => {
    expect(UpdateMeRequestSchema.safeParse({}).success).toBe(false);
  });
  it('akzeptiert eine reine Namensänderung', () => {
    expect(UpdateMeRequestSchema.safeParse({ name: 'Neuer Name' }).success).toBe(true);
  });
  // Sicherheitsreview 2026-08, Befund N2.
  it('lehnt einen zu langen Namen ab (> 200 Zeichen)', () => {
    expect(UpdateMeRequestSchema.safeParse({ name: 'X'.repeat(201) }).success).toBe(false);
  });
  // Regressionstest für Sicherheitsreview 2026-08-27, Befund H2: `email`
  // ist bewusst KEIN Feld dieses Schemas mehr (siehe ChangeEmailRequestSchema
  // unten) — ein mitgeschicktes `email`-Feld darf NICHT stillschweigend
  // durchgereicht werden (Zods Default-Verhalten ohne `.strict()` wäre
  // "unbekannte Schlüssel entfernen", was hier korrekt ist, aber explizit
  // geprüft werden soll, statt sich implizit darauf zu verlassen).
  it('entfernt ein mitgeschicktes "email"-Feld stillschweigend (kein Bestandteil mehr, wird nicht validiert)', () => {
    const result = UpdateMeRequestSchema.safeParse({ name: 'X', email: 'keine-email' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).not.toHaveProperty('email');
  });
});

describe('ChangeEmailRequestSchema (Sicherheitsreview 2026-08-27, Befund H2)', () => {
  it('akzeptiert aktuelles Passwort + eine gültige neue E-Mail-Adresse', () => {
    expect(ChangeEmailRequestSchema.safeParse({ currentPassword: 'alt', newEmail: 'neu@example.org' }).success).toBe(true);
  });
  it('lehnt eine ungültige neue E-Mail-Adresse ab', () => {
    expect(ChangeEmailRequestSchema.safeParse({ currentPassword: 'alt', newEmail: 'keine-email' }).success).toBe(false);
  });
  it('lehnt ein leeres aktuelles Passwort ab', () => {
    expect(ChangeEmailRequestSchema.safeParse({ currentPassword: '', newEmail: 'neu@example.org' }).success).toBe(false);
  });
  it('lehnt ein zu langes aktuelles Passwort ab (> 200 Zeichen)', () => {
    expect(ChangeEmailRequestSchema.safeParse({ currentPassword: 'x'.repeat(201), newEmail: 'neu@example.org' }).success).toBe(false);
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

describe('AuthTokensResponseSchema (enabledModules)', () => {
  const baseUser = {
    id: '11111111-1111-1111-1111-111111111111',
    clubId: '22222222-2222-2222-2222-222222222222',
    name: 'Sabine Reuter',
    email: 'sabine@example.org',
    role: 'trainer',
    athleteId: null,
    locale: 'de-DE',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  it('akzeptiert eine gültige Modul-Liste', () => {
    const response = {
      accessToken: 'a', refreshToken: 'b', expiresIn: 900,
      user: baseUser, enabledModules: ['athletes', 'competitions'],
    };
    expect(AuthTokensResponseSchema.safeParse(response).success).toBe(true);
  });

  it('akzeptiert ein leeres Array (z. B. superadmin ohne eigenen Verein)', () => {
    const response = {
      accessToken: 'a', refreshToken: 'b', expiresIn: 900,
      user: { ...baseUser, clubId: null, role: 'superadmin' }, enabledModules: [],
    };
    expect(AuthTokensResponseSchema.safeParse(response).success).toBe(true);
  });

  it('lehnt einen unbekannten Modul-Key ab', () => {
    const response = {
      accessToken: 'a', refreshToken: 'b', expiresIn: 900,
      user: baseUser, enabledModules: ['nicht-existierendes-modul'],
    };
    expect(AuthTokensResponseSchema.safeParse(response).success).toBe(false);
  });

  it('lehnt eine fehlende enabledModules ab', () => {
    const response = { accessToken: 'a', refreshToken: 'b', expiresIn: 900, user: baseUser };
    expect(AuthTokensResponseSchema.safeParse(response).success).toBe(false);
  });

  it('MeResponseSchema akzeptiert den Nutzer flach erweitert um enabledModules', () => {
    expect(MeResponseSchema.safeParse({ ...baseUser, enabledModules: ['times'] }).success).toBe(true);
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
  // Sicherheitsreview 2026-08, Befund N7.
  it('lehnt ein zu langes neues Passwort ab (> 200 Zeichen)', () => {
    expect(ResetPasswordRequestSchema.safeParse({ token: 'abc123', newPassword: 'x'.repeat(201) }).success).toBe(false);
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
  // Sicherheitsreview 2026-08, Befund N7.
  it('lehnt ein zu langes neues Passwort ab (> 200 Zeichen)', () => {
    expect(ChangePasswordRequestSchema.safeParse({ currentPassword: 'alt', newPassword: 'x'.repeat(201) }).success).toBe(false);
  });
  it('lehnt ein zu langes aktuelles Passwort ab (> 200 Zeichen)', () => {
    expect(ChangePasswordRequestSchema.safeParse({ currentPassword: 'x'.repeat(201), newPassword: 'ein-sicheres-passwort' }).success).toBe(false);
  });
});
