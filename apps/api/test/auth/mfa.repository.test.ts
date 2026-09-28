// Issue #97: Repository-Bausteine der Zwei-Faktor-Anmeldung (In-Memory-
// Double; das Prisma-Pendant prüft test-integration/mfa.integration.test.ts).
import { describe, it, expect } from 'vitest';
import { InMemoryUserRepository, InMemoryMfaRecoveryCodeRepository } from '../../src/modules/auth/auth.repository.memory.js';
import { toPublicUser } from '../../src/modules/auth/auth.service.js';

async function makeUser() {
  const users = new InMemoryUserRepository();
  const user = await users.create({
    clubId: 'club-1', name: 'Mara', email: 'mara@example.org', passwordHash: 'h',
    roles: ['admin'], consentGivenAt: new Date(), consentVersion: 'v1',
  });
  return { users, user };
}

describe('InMemoryUserRepository — TOTP', () => {
  it('setzt ein unbestätigtes Secret, aktiviert es und ersetzt es danach nicht mehr', async () => {
    const { users, user } = await makeUser();
    expect(await users.setPendingTotpSecret(user.id, 'enc-1')).toBe(true);
    expect(await users.setPendingTotpSecret(user.id, 'enc-2')).toBe(true); // noch unbestätigt: ersetzbar
    expect(await users.enableTotp(user.id, 100)).toBe(true);
    expect(await users.enableTotp(user.id, 101)).toBe(false);
    expect(await users.setPendingTotpSecret(user.id, 'enc-3')).toBe(false);
    expect(await users.findById(user.id)).toMatchObject({ totpSecretEnc: 'enc-2', totpLastUsedStep: 100 });
  });

  it('nimmt einen Zeitschritt nur an, wenn er nach dem zuletzt angenommenen liegt', async () => {
    const { users, user } = await makeUser();
    await users.setPendingTotpSecret(user.id, 'enc');
    await users.enableTotp(user.id, 100);
    expect(await users.recordTotpStep(user.id, 100)).toBe(false);
    expect(await users.recordTotpStep(user.id, 101)).toBe(true);
    expect(await users.recordTotpStep(user.id, 101)).toBe(false);
  });

  it('clearTotp() entfernt Secret und Status', async () => {
    const { users, user } = await makeUser();
    await users.setPendingTotpSecret(user.id, 'enc');
    await users.enableTotp(user.id, 100);
    await users.clearTotp(user.id);
    expect(await users.findById(user.id)).toMatchObject({ totpSecretEnc: null, totpEnabledAt: null, totpLastUsedStep: null });
  });
});

describe('InMemoryMfaRecoveryCodeRepository', () => {
  it('verbraucht jeden Code genau einmal und ersetzt alle beim Neuerzeugen', async () => {
    const codes = new InMemoryMfaRecoveryCodeRepository();
    await codes.replaceAll('u1', ['h1', 'h2']);
    expect(await codes.consume('u1', 'h1')).toBe(true);
    expect(await codes.consume('u1', 'h1')).toBe(false);
    expect(await codes.consume('u2', 'h2')).toBe(false);
    expect(await codes.countUnused('u1')).toBe(1);
    await codes.replaceAll('u1', ['h3']);
    expect(await codes.consume('u1', 'h2')).toBe(false);
    expect(await codes.countUnused('u1')).toBe(1);
  });
});

describe('toPublicUser()', () => {
  it('gibt nur mfaEnabled heraus, nie Secret oder Zeitschritt', async () => {
    const { users, user } = await makeUser();
    await users.setPendingTotpSecret(user.id, 'enc');
    await users.enableTotp(user.id, 100);
    const pub = toPublicUser((await users.findById(user.id))!);
    expect(pub.mfaEnabled).toBe(true);
    expect(pub).not.toHaveProperty('totpSecretEnc');
    expect(pub).not.toHaveProperty('totpLastUsedStep');
    expect(pub).not.toHaveProperty('totpEnabledAt');
    expect(pub).not.toHaveProperty('passwordHash');
  });
});
