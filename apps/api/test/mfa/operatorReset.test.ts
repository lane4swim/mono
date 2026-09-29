// Issue #97, Plan PR 3: Notweg `npm run reset-mfa` für ausgesperrte Konten.
import { describe, it, expect } from 'vitest';
import { resetMfaAsOperator } from '../../src/modules/mfa/operatorReset.js';
import { createAuditLogService } from '../../src/modules/auditLog/auditLog.service.js';
import { makeFixture } from './fixture.js';

async function setup() {
  const f = await makeFixture();
  const deps = {
    users: f.users,
    recoveryCodes: f.recoveryCodes,
    refreshTokens: f.refreshTokens,
    auditLog: createAuditLogService({ entries: f.auditLogEntries, users: f.users }),
    mailer: f.mailer,
  };
  return { f, deps };
}

describe('resetMfaAsOperator()', () => {
  it('setzt TOTP eines Superadmins zurück, beendet Sitzungen und protokolliert als System', async () => {
    const { f, deps } = await setup();
    await f.enableTotp(f.superadmin.id);
    const session = await f.authService.issueSessionFor(f.superadmin.id);

    const result = await resetMfaAsOperator(deps, 'super@lane1.de');
    expect(result).toMatchObject({ status: 'reset', userId: f.superadmin.id });

    const user = await f.users.findById(f.superadmin.id);
    expect(user?.totpEnabledAt).toBeNull();
    expect(user?.totpSecretEnc).toBeNull();
    expect(await f.recoveryCodes.countUnused(f.superadmin.id)).toBe(0);
    await expect(f.authService.refresh(session.refreshToken)).rejects.toThrow();

    const entry = (await f.auditLogEntries.list({ limit: 100 })).find((e) => e.action === 'mfa.reset');
    expect(entry).toMatchObject({ actorId: null, actorLabel: '__system__', targetId: f.superadmin.id, metadata: { via: 'cli' } });
    expect(f.mailer.sentAccountSecurityChangeEmails.at(-1)).toMatchObject({ to: 'super@lane1.de', changeType: 'mfa' });

    // Danach führt die Anmeldung in die erzwungene Einrichtung.
    expect(await f.login('super@lane1.de')).toEqual({ mfaSetupRequired: true, setupToken: expect.any(String) });
  });

  it('meldet unbekannte Adressen und Konten ohne TOTP, ohne etwas zu ändern', async () => {
    const { f, deps } = await setup();
    expect(await resetMfaAsOperator(deps, 'niemand@example.org')).toEqual({ status: 'not_found' });
    expect(await resetMfaAsOperator(deps, 'trainer@a.de')).toMatchObject({ status: 'not_enabled' });
    expect((await f.auditLogEntries.list({ limit: 100 })).some((e) => e.action === 'mfa.reset')).toBe(false);
  });
});
