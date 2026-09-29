// Issue #97, Plan PR 3: Pflicht zur Zwei-Faktor-Anmeldung — erzwungene
// Einrichtung bei der Anmeldung, keine verlängerte Sitzung ohne TOTP, kein
// Abschalten bei Pflicht.
import { describe, it, expect } from 'vitest';
import { totpAt, totpStep } from '../../src/auth/totp.js';
import { verifyAccessToken, verifyMfaToken, verifyMfaSetupToken, InvalidMfaSetupTokenError, hashRefreshToken } from '../../src/auth/tokens.js';
import { MfaNotConfiguredError } from '../../src/modules/mfa/mfa.core.js';
import { InvalidMfaCodeError, MfaAlreadyEnabledError, MfaRequiredCannotDisableError, MfaSetupRequiredError } from '../../src/modules/mfa/mfaErrors.js';
import { makeFixture, PASSWORD } from './fixture.js';

type LoginResult = Awaited<ReturnType<Awaited<ReturnType<typeof makeFixture>>['login']>>;

function setupTokenOf(result: LoginResult): string {
  expect(result).toEqual({ mfaSetupRequired: true, setupToken: expect.any(String) });
  return (result as { setupToken: string }).setupToken;
}

function isSession(result: LoginResult): boolean {
  return 'accessToken' in result;
}

describe('Pflicht nach Rolle, Verein und MFA_ENFORCE', () => {
  it('Superadmin ohne TOTP erhält bei aktiver Pflicht ein setupToken statt einer Sitzung', async () => {
    const f = await makeFixture();
    // Genau diese Felder — kein Access oder Refresh Token.
    setupTokenOf(await f.login('super@lane1.de'));
  });

  it('MFA_ENFORCE=false hebt jede Pflicht auf, auch die des Vereins', async () => {
    const f = await makeFixture({ enforce: false });
    await f.clubs.setMfaRequiredForAdmins(f.clubA.id, true);
    expect(isSession(await f.login('super@lane1.de'))).toBe(true);
    expect(isSession(await f.login('admin@a.de'))).toBe(true);
  });

  it('Admins nur in Vereinen mit Pflicht, andere Rollen nie', async () => {
    const f = await makeFixture();
    expect(isSession(await f.login('admin@a.de'))).toBe(true);
    await f.clubs.setMfaRequiredForAdmins(f.clubA.id, true);
    setupTokenOf(await f.login('admin@a.de'));
    expect(isSession(await f.login('trainer@a.de'))).toBe(true);
  });

  it('mit eingerichtetem TOTP folgt wie gewohnt der Code-Schritt', async () => {
    const f = await makeFixture();
    await f.enableTotp(f.superadmin.id);
    expect(await f.login('super@lane1.de')).toEqual({ mfaRequired: true, mfaToken: expect.any(String) });
  });

  it('ohne TOTP_ENCRYPTION_KEY lässt sich die Pflicht nicht erfüllen: klare Fehlermeldung statt setupToken', async () => {
    const f = await makeFixture({ encryptionKey: null });
    await expect(f.login('super@lane1.de')).rejects.toBeInstanceOf(MfaNotConfiguredError);
  });

  it('auch ein Passwort-Reset führt in die erzwungene Einrichtung', async () => {
    const f = await makeFixture();
    await f.authService.requestPasswordReset('super@lane1.de');
    const token = f.mailer.sentPasswordResetEmails.at(-1)!.resetUrl.split('/reset-password/')[1]!;
    setupTokenOf(await f.authService.resetPassword(token, 'ein-ganz-neues-passwort-fuer-super'));
  });
});

describe('Erzwungene Einrichtung mit setupToken', () => {
  it('richtet TOTP ein, liefert Wiederherstellungscodes und eine Sitzung', async () => {
    const f = await makeFixture();
    const setupToken = setupTokenOf(await f.login('super@lane1.de'));
    const { secret, qrSvg } = await f.mfaService.beginForcedSetup(setupToken);
    expect(qrSvg).toMatch(/^<svg/);

    await expect(f.mfaService.confirmForcedSetup(setupToken, '000000')).rejects.toBeInstanceOf(InvalidMfaCodeError);
    const { recoveryCodes, session } = await f.mfaService.confirmForcedSetup(setupToken, totpAt(secret, totpStep()));
    expect(recoveryCodes).toHaveLength(10);
    expect(session).toMatchObject({ accessToken: expect.any(String), user: { mfaEnabled: true } });
    expect((await f.auditLogEntries.list({ limit: 100 })).map((e) => e.action)).toContain('mfa.enabled');

    // Danach gilt der normale zweistufige Ablauf; das setupToken ist wertlos.
    expect(await f.login('super@lane1.de')).toEqual({ mfaRequired: true, mfaToken: expect.any(String) });
    await expect(f.mfaService.beginForcedSetup(setupToken)).rejects.toBeInstanceOf(MfaAlreadyEnabledError);
  });

  it('ein setupToken ist weder Access Token noch mfaToken — und umgekehrt', async () => {
    const f = await makeFixture();
    const setupToken = setupTokenOf(await f.login('super@lane1.de'));
    await expect(verifyAccessToken(setupToken, f.keyPair)).rejects.toThrow();
    await expect(verifyMfaToken(setupToken, f.keyPair)).rejects.toThrow();

    await f.enableTotp(f.trainer.id);
    const { mfaToken } = (await f.login('trainer@a.de')) as { mfaToken: string };
    await expect(verifyMfaSetupToken(mfaToken, f.keyPair)).rejects.toBeInstanceOf(InvalidMfaSetupTokenError);
    await expect(f.mfaService.beginForcedSetup(mfaToken)).rejects.toBeInstanceOf(InvalidMfaSetupTokenError);
  });
});

describe('Bestehende Sitzungen', () => {
  it('eine Sitzung aus der Zeit vor der Vereinspflicht wird nicht verlängert', async () => {
    const f = await makeFixture();
    const session = await f.authService.issueSessionFor(f.admin.id);
    await f.clubs.setMfaRequiredForAdmins(f.clubA.id, true);
    await expect(f.authService.refresh(session.refreshToken)).rejects.toBeInstanceOf(MfaSetupRequiredError);
    // Das Token ist eingelöst, nicht bloß abgelehnt.
    expect((await f.refreshTokens.findByHash(hashRefreshToken(session.refreshToken)))?.revokedAt).toBeInstanceOf(Date);
  });

  it('andere Rollen und Personen mit TOTP verlängern ihre Sitzung wie gewohnt', async () => {
    const f = await makeFixture();
    await f.clubs.setMfaRequiredForAdmins(f.clubA.id, true);
    const trainer = await f.authService.issueSessionFor(f.trainer.id);
    await expect(f.authService.refresh(trainer.refreshToken)).resolves.toHaveProperty('accessToken');

    await f.enableTotp(f.otherAdmin.id);
    const admin = await f.authService.issueSessionFor(f.otherAdmin.id);
    await expect(f.authService.refresh(admin.refreshToken)).resolves.toHaveProperty('accessToken');
  });
});

describe('Abschalten bei Pflicht', () => {
  it('wird verweigert, solange TOTP Pflicht ist', async () => {
    const f = await makeFixture();
    const { secret } = await f.enableTotp(f.superadmin.id);
    await expect(f.mfaService.disable(f.superadmin.id, PASSWORD, { code: f.nextCode(secret) })).rejects.toBeInstanceOf(MfaRequiredCannotDisableError);
  });

  it('ist ohne Pflicht möglich (MFA_ENFORCE=false)', async () => {
    const f = await makeFixture({ enforce: false });
    const { secret } = await f.enableTotp(f.superadmin.id);
    await expect(f.mfaService.disable(f.superadmin.id, PASSWORD, { code: f.nextCode(secret) })).resolves.toHaveProperty('session');
  });
});
