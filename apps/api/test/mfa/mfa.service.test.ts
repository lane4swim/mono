// Issue #97: Zwei-Faktor-Anmeldung per TOTP — Einrichtung, zweiter
// Anmeldeschritt, Wiederherstellungscodes, Zurücksetzen und Vereinspflicht.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InvalidCurrentPasswordError, InvalidRefreshTokenError } from '../../src/modules/auth/auth.service.js';
import { InMemoryAuditLogRepository } from '../../src/modules/auditLog/auditLog.repository.memory.js';
import { ForbiddenError } from '../../src/modules/shared/errors.js';
import { InvalidMfaTokenError } from '../../src/auth/tokens.js';
import { totpAt, totpStep } from '../../src/auth/totp.js';
import { MfaNotConfiguredError } from '../../src/modules/mfa/mfa.core.js';
import {
  InvalidMfaCodeError,
  MfaAlreadyEnabledError,
  MfaSetupNotStartedError,
  MfaCodeRequiredError,
  MfaRequiredForActionError,
  MfaLockedError,
} from '../../src/modules/mfa/mfaErrors.js';
import { MFA_LOCK_THRESHOLD, MFA_LOCK_BASE_MS } from '../../src/modules/mfa/mfaLockout.js';
import { makeFixture, PASSWORD } from './fixture.js';

const actions = async (entries: InMemoryAuditLogRepository) => (await entries.list({ limit: 100 })).map((e) => e.action);

describe('Einrichtung', () => {
  let f: Awaited<ReturnType<typeof makeFixture>>;
  beforeEach(async () => { f = await makeFixture(); });

  it('liefert Secret, otpauth-URI und QR-Code als SVG; aktiv erst nach Bestätigung', async () => {
    const setup = await f.mfaService.beginSetup(f.trainer.id);
    expect(setup.secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(setup.otpauthUri).toContain(`secret=${setup.secret}`);
    expect(setup.qrSvg.startsWith('<svg')).toBe(true);
    expect((await f.mfaService.status(f.trainer.id)).enabled).toBe(false);
    // Secret liegt nur verschlüsselt vor.
    expect((await f.users.findById(f.trainer.id))?.totpSecretEnc).not.toContain(setup.secret);
  });

  it('bestätigt mit einem gültigen Code: 10 Wiederherstellungscodes, andere Sitzungen beendet, Audit und E-Mail', async () => {
    const before = await f.authService.issueSessionFor(f.trainer.id);
    const { secret } = await f.mfaService.beginSetup(f.trainer.id);
    await expect(f.mfaService.confirmSetup(f.trainer.id, '000000' === totpAt(secret, totpStep()) ? '111111' : '000000', PASSWORD)).rejects.toThrow(InvalidMfaCodeError);
    // Ohne richtiges Passwort keine Aktivierung, auch mit gültigem Code.
    await expect(f.mfaService.confirmSetup(f.trainer.id, totpAt(secret, totpStep()), 'falsch')).rejects.toThrow(InvalidCurrentPasswordError);
    expect((await f.mfaService.status(f.trainer.id)).enabled).toBe(false);

    const result = await f.mfaService.confirmSetup(f.trainer.id, totpAt(secret, totpStep()), PASSWORD);
    expect(result.recoveryCodes).toHaveLength(10);
    expect(new Set(result.recoveryCodes).size).toBe(10);
    expect(result.recoveryCodes[0]).toMatch(/^[a-z2-9]{5}-[a-z2-9]{5}$/);
    expect(await f.mfaService.status(f.trainer.id)).toMatchObject({ enabled: true, recoveryCodesRemaining: 10 });
    await expect(f.authService.refresh(before.refreshToken)).rejects.toThrow(InvalidRefreshTokenError);
    expect(await actions(f.auditLogEntries)).toContain('mfa.enabled');
    expect(f.mailer.sentAccountSecurityChangeEmails.at(-1)).toMatchObject({ to: 'trainer@a.de', changeType: 'mfa' });
  });

  it('lehnt eine zweite Einrichtung und eine Bestätigung ohne Start ab', async () => {
    await expect(f.mfaService.confirmSetup(f.trainer.id, '123456', PASSWORD)).rejects.toThrow(MfaSetupNotStartedError);
    await f.enableTotp(f.trainer.id);
    await expect(f.mfaService.beginSetup(f.trainer.id)).rejects.toThrow(MfaAlreadyEnabledError);
  });

  it('ist ohne TOTP_ENCRYPTION_KEY nicht verfügbar', async () => {
    const g = await makeFixture({ encryptionKey: null });
    await expect(g.mfaService.beginSetup(g.trainer.id)).rejects.toThrow(MfaNotConfiguredError);
    expect((await g.mfaService.status(g.trainer.id)).available).toBe(false);
  });
});

describe('Zweiter Anmeldeschritt', () => {
  let f: Awaited<ReturnType<typeof makeFixture>>;
  beforeEach(async () => { f = await makeFixture(); });

  it('ohne TOTP: Anmeldung wie bisher', async () => {
    const result = await f.login('trainer@a.de');
    expect(result).toHaveProperty('accessToken');
    expect(result).not.toHaveProperty('mfaRequired');
  });

  it('mit TOTP: erst mfaToken, dann Sitzung per Code; derselbe Code gilt nur einmal', async () => {
    const { secret } = await f.enableTotp(f.trainer.id);
    const step1 = await f.login('trainer@a.de');
    expect(step1).toEqual({ mfaRequired: true, mfaToken: expect.any(String) });
    expect(step1).not.toHaveProperty('accessToken');

    const code = f.nextCode(secret);
    const session = await f.authService.loginWithSecondFactor({ mfaToken: (step1 as { mfaToken: string }).mfaToken, code });
    expect(session.user.email).toBe('trainer@a.de');
    expect(session.user.mfaEnabled).toBe(true);

    const again = (await f.login('trainer@a.de')) as { mfaToken: string };
    await expect(f.authService.loginWithSecondFactor({ mfaToken: again.mfaToken, code })).rejects.toThrow(InvalidMfaCodeError);
  });

  it('ein eingelöstes mfaToken ist verbraucht', async () => {
    const { secret } = await f.enableTotp(f.trainer.id);
    const { mfaToken } = (await f.login('trainer@a.de')) as { mfaToken: string };
    await f.authService.loginWithSecondFactor({ mfaToken, code: f.nextCode(secret) });
    await expect(f.authService.loginWithSecondFactor({ mfaToken, code: totpAt(secret, totpStep() - 1) })).rejects.toThrow();
  });

  it('nach 5 falschen Codes ist das mfaToken gesperrt — auch für den richtigen Code', async () => {
    const { secret } = await f.enableTotp(f.trainer.id);
    const { mfaToken } = (await f.login('trainer@a.de')) as { mfaToken: string };
    const wrong = totpAt(secret, totpStep() + 5);
    for (let i = 0; i < 4; i++) {
      await expect(f.authService.loginWithSecondFactor({ mfaToken, code: wrong })).rejects.toThrow(InvalidMfaCodeError);
    }
    await expect(f.authService.loginWithSecondFactor({ mfaToken, code: wrong })).rejects.toThrow(InvalidMfaTokenError);
    await expect(f.authService.loginWithSecondFactor({ mfaToken, code: f.nextCode(secret) })).rejects.toThrow(InvalidMfaTokenError);
    await new Promise((r) => setTimeout(r, 0));
    expect((await actions(f.auditLogEntries)).filter((a) => a === 'auth.mfaFailed')).toHaveLength(5);
  });

  it('ein Wiederherstellungscode funktioniert genau einmal und wird protokolliert', async () => {
    const { recoveryCodes } = await f.enableTotp(f.trainer.id);
    const first = (await f.login('trainer@a.de')) as { mfaToken: string };
    await expect(f.authService.loginWithSecondFactor({ mfaToken: first.mfaToken, recoveryCode: recoveryCodes[0]!.toUpperCase() })).resolves.toHaveProperty('accessToken');
    const second = (await f.login('trainer@a.de')) as { mfaToken: string };
    await expect(f.authService.loginWithSecondFactor({ mfaToken: second.mfaToken, recoveryCode: recoveryCodes[0]! })).rejects.toThrow(InvalidMfaCodeError);
    expect(await actions(f.auditLogEntries)).toContain('auth.recoveryCodeUsed');
    await new Promise((r) => setTimeout(r, 0));
    expect(f.mailer.sentAccountSecurityChangeEmails.at(-1)).toMatchObject({ to: 'trainer@a.de', changeType: 'recoveryCodeUsed' });
    expect((await f.mfaService.status(f.trainer.id)).recoveryCodesRemaining).toBe(9);
  });

});

// Issue #109: kontoweite Grenze über alle mfaTokens hinweg.
describe('Kontosperre nach zu vielen falschen Codes', () => {
  let f: Awaited<ReturnType<typeof makeFixture>>;
  beforeEach(async () => { f = await makeFixture(); });

  // Meldet sich jeweils neu an (je mfaToken höchstens 5 Versuche) und gibt
  // `count` falsche Codes ein. Liefert den Fehler des letzten Versuchs.
  async function failCodes(secret: string, count: number): Promise<unknown> {
    const wrong = totpAt(secret, totpStep() + 5);
    let last: unknown;
    let mfaToken = '';
    for (let i = 0; i < count; i++) {
      if (i % 4 === 0) mfaToken = ((await f.login('trainer@a.de')) as { mfaToken: string }).mfaToken;
      last = await f.authService.loginWithSecondFactor({ mfaToken, code: wrong }).catch((err: unknown) => err);
    }
    return last;
  }

  it(`sperrt nach ${MFA_LOCK_THRESHOLD} Fehlversuchen über mehrere mfaTokens hinweg`, async () => {
    const { secret } = await f.enableTotp(f.trainer.id);
    expect(await failCodes(secret, MFA_LOCK_THRESHOLD - 1)).toBeInstanceOf(InvalidMfaCodeError);
    expect(await failCodes(secret, 1)).toBeInstanceOf(MfaLockedError);

    // Kein neues mfaToken mehr, auch mit richtigem Passwort.
    await expect(f.login('trainer@a.de')).rejects.toThrow(MfaLockedError);
    await new Promise((r) => setTimeout(r, 0));
    expect(await actions(f.auditLogEntries)).toContain('auth.mfaLocked');
    expect(f.mailer.sentAccountSecurityChangeEmails.filter((m) => m.changeType === 'mfaLocked')).toHaveLength(1);
  });

  it('prüft während der Sperre auch einen richtigen Code nicht', async () => {
    const { secret } = await f.enableTotp(f.trainer.id);
    const { mfaToken } = (await f.login('trainer@a.de')) as { mfaToken: string };
    for (let i = 0; i < MFA_LOCK_THRESHOLD; i++) await f.users.recordMfaFailure(f.trainer.id, new Date());
    await expect(f.authService.loginWithSecondFactor({ mfaToken, code: f.nextCode(secret) })).rejects.toThrow(MfaLockedError);
  });

  it('ein erfolgreicher zweiter Faktor setzt den Zähler zurück', async () => {
    const { secret } = await f.enableTotp(f.trainer.id);
    await failCodes(secret, MFA_LOCK_THRESHOLD - 1);
    const { mfaToken } = (await f.login('trainer@a.de')) as { mfaToken: string };
    await f.authService.loginWithSecondFactor({ mfaToken, code: f.nextCode(secret) });
    expect(await failCodes(secret, MFA_LOCK_THRESHOLD - 1)).toBeInstanceOf(InvalidMfaCodeError);
  });

  it('endet nach Ablauf der Sperrzeit', async () => {
    await f.enableTotp(f.trainer.id);
    const past = new Date(Date.now() - MFA_LOCK_BASE_MS - 1000);
    for (let i = 0; i < MFA_LOCK_THRESHOLD; i++) await f.users.recordMfaFailure(f.trainer.id, past);
    await expect(f.login('trainer@a.de')).resolves.toHaveProperty('mfaRequired', true);
  });

  it('das Zurücksetzen durch einen Admin hebt die Sperre auf', async () => {
    await f.enableTotp(f.trainer.id);
    for (let i = 0; i < MFA_LOCK_THRESHOLD; i++) await f.users.recordMfaFailure(f.trainer.id, new Date());
    await expect(f.login('trainer@a.de')).rejects.toThrow(MfaLockedError);

    await f.mfaService.resetForUser(f.trainer.id, { id: f.admin.id, roles: f.admin.roles, clubId: f.admin.clubId }, PASSWORD, {});

    expect(await f.login('trainer@a.de')).toHaveProperty('accessToken');
    expect(await f.users.findById(f.trainer.id)).toMatchObject({ mfaFailedCount: 0, mfaLockedUntil: null, mfaLockoutCount: 0 });
  });

  it('gibt die Sperrfelder nie nach außen', async () => {
    const { secret } = await f.enableTotp(f.trainer.id);
    await failCodes(secret, 1);
    const { mfaToken } = (await f.login('trainer@a.de')) as { mfaToken: string };
    const session = await f.authService.loginWithSecondFactor({ mfaToken, code: f.nextCode(secret) });
    expect(Object.keys(session.user).filter((k) => k.startsWith('mfaF') || k.startsWith('mfaL'))).toEqual([]);
  });
});

// Issue #110: mit aktivem TOTP ändert der Reset-Link das Passwort erst nach
// einem gültigen zweiten Faktor.
describe('Passwort-Reset mit aktivem TOTP', () => {
  let f: Awaited<ReturnType<typeof makeFixture>>;
  beforeEach(async () => { f = await makeFixture(); });
  const NEW_PASSWORD = 'ein-ganz-neues-passwort';

  async function resetToken(): Promise<string> {
    await f.authService.requestPasswordReset('trainer@a.de');
    await new Promise((r) => setTimeout(r, 0));
    return f.mailer.sentPasswordResetEmails.at(-1)!.resetUrl.split('/reset-password/')[1]!;
  }
  async function passwordUnchanged() {
    expect(await f.login('trainer@a.de')).toHaveProperty('mfaRequired', true);
  }

  it('ohne Code: Passwort, Sitzungen und Link bleiben unangetastet', async () => {
    const { secret } = await f.enableTotp(f.trainer.id);
    const session = await f.authService.issueSessionFor(f.trainer.id);
    const token = await resetToken();

    await expect(f.authService.resetPassword(token, NEW_PASSWORD)).rejects.toThrow(MfaCodeRequiredError);

    await passwordUnchanged();
    await expect(f.authService.refresh(session.refreshToken)).resolves.toHaveProperty('accessToken');
    // Der Link ist noch gültig.
    await expect(f.authService.resetPassword(token, NEW_PASSWORD, { code: f.nextCode(secret) })).resolves.toHaveProperty('accessToken');
  });

  it('falscher Code: nichts ändert sich, der Versuch zählt und löst einen Sicherheitshinweis aus', async () => {
    const { secret } = await f.enableTotp(f.trainer.id);
    const session = await f.authService.issueSessionFor(f.trainer.id);
    const token = await resetToken();

    await expect(f.authService.resetPassword(token, NEW_PASSWORD, { code: totpAt(secret, totpStep() + 5) })).rejects.toThrow(InvalidMfaCodeError);

    await passwordUnchanged();
    await expect(f.authService.refresh(session.refreshToken)).resolves.toHaveProperty('accessToken');
    expect((await f.users.findById(f.trainer.id))!.mfaFailedCount).toBe(1);
    await new Promise((r) => setTimeout(r, 0));
    expect(f.mailer.sentAccountSecurityChangeEmails.at(-1)).toMatchObject({ to: 'trainer@a.de', changeType: 'passwordResetMfaFailed' });
    const failed = (await f.auditLogEntries.list({ limit: 100 })).find((e) => e.action === 'auth.mfaFailed');
    expect(failed?.metadata).toMatchObject({ context: 'passwordReset' });
  });

  it('richtiger Code: Passwort geändert, alte Sitzungen beendet, direkt angemeldet', async () => {
    const { secret } = await f.enableTotp(f.trainer.id);
    const session = await f.authService.issueSessionFor(f.trainer.id);
    const token = await resetToken();

    const result = await f.authService.resetPassword(token, NEW_PASSWORD, { code: f.nextCode(secret) });

    expect(result).toHaveProperty('accessToken');
    await expect(f.authService.refresh(session.refreshToken)).rejects.toThrow(InvalidRefreshTokenError);
    await expect(f.authService.resetPassword(token, NEW_PASSWORD, { code: f.nextCode(secret) })).rejects.toThrow();
  });

  it('Wiederherstellungscode: funktioniert und wird protokolliert', async () => {
    const { recoveryCodes } = await f.enableTotp(f.trainer.id);
    const token = await resetToken();

    await expect(f.authService.resetPassword(token, NEW_PASSWORD, { recoveryCode: recoveryCodes[0]! })).resolves.toHaveProperty('accessToken');
    expect(await actions(f.auditLogEntries)).toContain('auth.recoveryCodeUsed');
  });

  it('teilt sich die Kontosperre mit der Anmeldung', async () => {
    const { secret } = await f.enableTotp(f.trainer.id);
    const token = await resetToken();
    const wrong = totpAt(secret, totpStep() + 5);
    for (let i = 0; i < MFA_LOCK_THRESHOLD - 1; i++) {
      await expect(f.authService.resetPassword(token, NEW_PASSWORD, { code: wrong })).rejects.toThrow(InvalidMfaCodeError);
    }
    await expect(f.authService.resetPassword(token, NEW_PASSWORD, { code: wrong })).rejects.toThrow(MfaLockedError);
    await expect(f.authService.resetPassword(token, NEW_PASSWORD, { code: f.nextCode(secret) })).rejects.toThrow(MfaLockedError);
    await expect(f.login('trainer@a.de')).rejects.toThrow(MfaLockedError);
  });

  it('ohne TOTP: Reset wie bisher, ein Code wird nicht verlangt', async () => {
    const token = await resetToken();
    await expect(f.authService.resetPassword(token, NEW_PASSWORD)).resolves.toHaveProperty('accessToken');
  });
});

describe('Abschalten und neue Wiederherstellungscodes', () => {
  let f: Awaited<ReturnType<typeof makeFixture>>;
  beforeEach(async () => { f = await makeFixture(); });

  it('Abschalten verlangt Passwort und einen zweiten Faktor', async () => {
    const { secret } = await f.enableTotp(f.trainer.id);
    await expect(f.mfaService.disable(f.trainer.id, 'falsch', { code: f.nextCode(secret) })).rejects.toThrow(InvalidCurrentPasswordError);
    await expect(f.mfaService.disable(f.trainer.id, PASSWORD, {})).rejects.toThrow(MfaCodeRequiredError);
    await f.mfaService.disable(f.trainer.id, PASSWORD, { code: f.nextCode(secret) });
    expect(await f.mfaService.status(f.trainer.id)).toMatchObject({ enabled: false, recoveryCodesRemaining: 0 });
    expect(await actions(f.auditLogEntries)).toContain('mfa.disabled');
    expect(await f.login('trainer@a.de')).toHaveProperty('accessToken');
  });

  it('neue Wiederherstellungscodes entwerten die alten', async () => {
    const { secret, recoveryCodes } = await f.enableTotp(f.trainer.id);
    const { recoveryCodes: fresh } = await f.mfaService.regenerateRecoveryCodes(f.trainer.id, { code: f.nextCode(secret) });
    expect(f.mailer.sentAccountSecurityChangeEmails.at(-1)).toMatchObject({ changeType: 'recoveryCodesRegenerated' });
    const { mfaToken } = (await f.login('trainer@a.de')) as { mfaToken: string };
    await expect(f.authService.loginWithSecondFactor({ mfaToken, recoveryCode: recoveryCodes[0]! })).rejects.toThrow(InvalidMfaCodeError);
    await expect(f.authService.loginWithSecondFactor({ mfaToken, recoveryCode: fresh[0]! })).resolves.toHaveProperty('accessToken');
  });
});

describe('Zurücksetzen durch Admin/Superadmin', () => {
  let f: Awaited<ReturnType<typeof makeFixture>>;
  beforeEach(async () => { f = await makeFixture(); });
  const asRequester = (u: { id: string; roles: string[]; clubId: string | null }) => ({ id: u.id, roles: u.roles, clubId: u.clubId });

  it('ein Admin setzt TOTP einer Person des eigenen Vereins zurück — Sitzungen enden, Audit und E-Mail', async () => {
    await f.enableTotp(f.trainer.id);
    const session = await f.authService.issueSessionFor(f.trainer.id);
    await f.mfaService.resetForUser(f.trainer.id, asRequester(f.admin), PASSWORD, {});
    expect((await f.mfaService.status(f.trainer.id)).enabled).toBe(false);
    await expect(f.authService.refresh(session.refreshToken)).rejects.toThrow(InvalidRefreshTokenError);
    const entry = (await f.auditLogEntries.list({ limit: 100 })).find((e) => e.action === 'mfa.reset');
    expect(entry).toMatchObject({ actorId: f.admin.id, targetId: f.trainer.id });
    expect(f.mailer.sentAccountSecurityChangeEmails.at(-1)).toMatchObject({ to: 'trainer@a.de', changeType: 'mfa' });
  });

  it('ein Admin darf auch andere Admins des eigenen Vereins zurücksetzen', async () => {
    await f.enableTotp(f.otherAdmin.id);
    await f.mfaService.resetForUser(f.otherAdmin.id, asRequester(f.admin), PASSWORD, {});
    expect((await f.mfaService.status(f.otherAdmin.id)).enabled).toBe(false);
  });

  it('verweigert fremde Vereine, Superadmins, das eigene Konto und Nicht-Admins', async () => {
    await f.enableTotp(f.foreignTrainer.id);
    await f.enableTotp(f.superadmin.id);
    await expect(f.mfaService.resetForUser(f.foreignTrainer.id, asRequester(f.admin), PASSWORD, {})).rejects.toThrow(ForbiddenError);
    await expect(f.mfaService.resetForUser(f.superadmin.id, asRequester(f.admin), PASSWORD, {})).rejects.toThrow(ForbiddenError);
    await expect(f.mfaService.resetForUser(f.admin.id, asRequester(f.admin), PASSWORD, {})).rejects.toThrow(ForbiddenError);
    await expect(f.mfaService.resetForUser(f.admin.id, asRequester(f.trainer), PASSWORD, {})).rejects.toThrow(ForbiddenError);
  });

  it('der Superadmin darf jede Person zurücksetzen, braucht dabei aber den eigenen Code', async () => {
    const { secret } = await f.enableTotp(f.superadmin.id);
    await f.enableTotp(f.foreignTrainer.id);
    await expect(f.mfaService.resetForUser(f.foreignTrainer.id, asRequester(f.superadmin), PASSWORD, {})).rejects.toThrow(MfaCodeRequiredError);
    await f.mfaService.resetForUser(f.foreignTrainer.id, asRequester(f.superadmin), PASSWORD, { code: f.nextCode(secret) });
    expect((await f.mfaService.status(f.foreignTrainer.id)).enabled).toBe(false);
  });

  it('verlangt das Passwort der handelnden Person', async () => {
    await f.enableTotp(f.trainer.id);
    await expect(f.mfaService.resetForUser(f.trainer.id, asRequester(f.admin), 'falsch', {})).rejects.toThrow(InvalidCurrentPasswordError);
    expect((await f.mfaService.status(f.trainer.id)).enabled).toBe(true);
  });
});

describe('Vereinspflicht für Admins und Pflicht-Status', () => {
  const asRequester = (u: { id: string; roles: string[]; clubId: string | null }) => ({ id: u.id, roles: u.roles, clubId: u.clubId });

  it('nur ein Admin mit eigenem TOTP kann die Pflicht einschalten; der Status spiegelt sie', async () => {
    const f = await makeFixture();
    await expect(f.mfaService.setClubAdminRequirement(f.clubA.id, true, asRequester(f.admin), PASSWORD, {})).rejects.toThrow(MfaRequiredForActionError);
    expect((await f.mfaService.status(f.otherAdmin.id)).required).toBe(false);

    const { secret } = await f.enableTotp(f.admin.id);
    await expect(f.mfaService.setClubAdminRequirement(f.clubA.id, true, asRequester(f.admin), PASSWORD, { code: f.nextCode(secret) })).resolves.toEqual({ mfaRequiredForAdmins: true });
    expect((await f.mfaService.status(f.otherAdmin.id)).required).toBe(true);
    expect((await f.mfaService.status(f.trainer.id)).clubRequiresAdminMfa).toBe(true);
    expect((await f.mfaService.status(f.superadmin.id)).clubRequiresAdminMfa).toBeNull();
    expect((await f.mfaService.status(f.trainer.id)).required).toBe(false);
    expect(await actions(f.auditLogEntries)).toContain('club.mfaPolicyChanged');
  });

  it('ein Admin darf die Einstellung eines fremden Vereins nicht ändern', async () => {
    const f = await makeFixture();
    await expect(f.mfaService.setClubAdminRequirement(f.clubB.id, false, asRequester(f.admin), PASSWORD, {})).rejects.toThrow(ForbiddenError);
  });

  it('MFA_ENFORCE=false hebt jede Pflicht auf — TOTP bleibt nutzbar', async () => {
    const on = await makeFixture({ enforce: true });
    expect((await on.mfaService.status(on.superadmin.id)).required).toBe(true);
    const off = await makeFixture({ enforce: false });
    expect(await off.mfaService.status(off.superadmin.id)).toMatchObject({ required: false, enforced: false, available: true });
    await off.enableTotp(off.superadmin.id);
    expect(await off.login('super@lane1.de')).toHaveProperty('mfaRequired', true);
  });
});

// Die Grenze von 5 Versuchen je
// mfaToken muss auch bei parallelen Anfragen halten — sonst prüfen beliebig
// viele gleichzeitige Anfragen Codes, bevor der erste Fehlversuch zählt.
describe('Fehlversuchs-Grenze bei parallelen Anfragen', () => {
  it('lässt keinen richtigen Code mehr durch, wenn er als 20. von 20 gleichzeitigen Anfragen kommt', async () => {
    const f = await makeFixture();
    const { secret } = await f.enableTotp(f.trainer.id);
    const { mfaToken } = (await f.login('trainer@a.de')) as { mfaToken: string };
    const wrong = totpAt(secret, totpStep() + 5);
    // Wie ein echter Datenbank-Roundtrip: die Anfragen überlappen sich.
    const findById = f.users.findById.bind(f.users);
    vi.spyOn(f.users, 'findById').mockImplementation(async (id) => {
      await new Promise((r) => setTimeout(r, 50));
      return findById(id);
    });
    const codes = [...Array.from({ length: 19 }, () => wrong), f.nextCode(secret)];
    const results = await Promise.allSettled(codes.map((code) => f.authService.loginWithSecondFactor({ mfaToken, code })));
    expect(results.every((r) => r.status === 'rejected')).toBe(true);
  });
});

describe('Wiederherstellungscodes — Speicherung', () => {
  it('speichert nur einen mit dem Server-Schlüssel und der Konto-ID verknüpften HMAC, keinen reinen Hash', async () => {
    const { createHash } = await import('node:crypto');
    const f = await makeFixture();
    const { recoveryCodes } = await f.enableTotp(f.trainer.id);
    const consume = vi.spyOn(f.recoveryCodes, 'consume');
    const plainHash = createHash('sha256').update(recoveryCodes[0]!.replace('-', '')).digest('hex');
    // Ein Angreifer mit Datenbank-Abzug, der den ungesalzenen Hash kennt,
    // kommt damit nicht weiter: consume() bekommt einen anderen Wert.
    const { mfaToken } = (await f.login('trainer@a.de')) as { mfaToken: string };
    await f.authService.loginWithSecondFactor({ mfaToken, recoveryCode: recoveryCodes[0]! });
    expect(consume).toHaveBeenCalledTimes(1);
    expect(consume.mock.calls[0]![1]).not.toBe(plainHash);
    expect(consume.mock.calls[0]![1]).toMatch(/^[0-9a-f]{64}$/);
  });
});
