// Issue #97: die atomaren, bedingten Updates der Zwei-Faktor-Anmeldung gegen
// eine echte Datenbank — genau die Garantien, die kein In-Memory-Double
// belegen kann.
import { describe, it, expect, afterEach, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { PrismaUserRepository, PrismaMfaRecoveryCodeRepository } from '../src/modules/auth/auth.repository.js';
import { PrismaClubRepository } from '../src/modules/invitations/invitations.repository.js';
import { PrismaProfileDataGateway } from '../src/modules/profile/profile.repository.js';
import { getTestPrisma, closeTestPrisma, truncateAll, createTestClub } from './helpers.js';

const prisma = getTestPrisma();
const users = new PrismaUserRepository(prisma);
const recoveryCodes = new PrismaMfaRecoveryCodeRepository(prisma);

afterEach(async () => {
  await truncateAll();
});
afterAll(async () => {
  await closeTestPrisma();
});

async function seedUser(clubId: string) {
  return prisma.user.create({
    data: { clubId, name: 'Mara', email: `mara-${randomUUID()}@example.org`, passwordHash: 'h', role: 'admin', roles: ['admin'] },
  });
}

describe('PrismaUserRepository — TOTP', () => {
  it('aktiviert nur ein unbestätigtes Secret und ersetzt ein aktives nicht', async () => {
    const club = await createTestClub();
    const user = await seedUser(club.id);
    expect(await users.enableTotp(user.id, 1)).toBe(false); // noch kein Secret
    expect(await users.setPendingTotpSecret(user.id, 'enc-1')).toBe(true);
    expect(await users.enableTotp(user.id, 100)).toBe(true);
    expect(await users.setPendingTotpSecret(user.id, 'enc-2')).toBe(false);
    expect(await users.findById(user.id)).toMatchObject({ totpSecretEnc: 'enc-1', totpLastUsedStep: 100 });
  });

  it('nimmt denselben Zeitschritt bei gleichzeitigen Anfragen genau einmal an', async () => {
    const club = await createTestClub();
    const user = await seedUser(club.id);
    await users.setPendingTotpSecret(user.id, 'enc');
    await users.enableTotp(user.id, 100);
    const results = await Promise.all(Array.from({ length: 5 }, () => users.recordTotpStep(user.id, 101)));
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await users.recordTotpStep(user.id, 100)).toBe(false);
  });

  it('clearTotp() entfernt alles', async () => {
    const club = await createTestClub();
    const user = await seedUser(club.id);
    await users.setPendingTotpSecret(user.id, 'enc');
    await users.enableTotp(user.id, 100);
    await users.clearTotp(user.id);
    expect(await users.findById(user.id)).toMatchObject({ totpSecretEnc: null, totpEnabledAt: null, totpLastUsedStep: null });
  });
});

describe('PrismaMfaRecoveryCodeRepository', () => {
  it('verbraucht einen Code bei gleichzeitigen Anfragen genau einmal; replaceAll ersetzt alle', async () => {
    const club = await createTestClub();
    const user = await seedUser(club.id);
    await recoveryCodes.replaceAll(user.id, ['h1', 'h2', 'h3']);
    const results = await Promise.all(Array.from({ length: 5 }, () => recoveryCodes.consume(user.id, 'h1')));
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await recoveryCodes.countUnused(user.id)).toBe(2);
    await recoveryCodes.replaceAll(user.id, ['h4']);
    expect(await recoveryCodes.consume(user.id, 'h2')).toBe(false);
    expect(await recoveryCodes.countUnused(user.id)).toBe(1);
  });

  it('die Codes verschwinden mit dem Konto (onDelete: Cascade)', async () => {
    const club = await createTestClub();
    const user = await seedUser(club.id);
    await recoveryCodes.replaceAll(user.id, ['h1']);
    await prisma.user.delete({ where: { id: user.id } });
    expect(await prisma.mfaRecoveryCode.count()).toBe(0);
  });
});

describe('Vereinseinstellung und Datenexport', () => {
  it('setMfaRequiredForAdmins() speichert die Einstellung', async () => {
    const club = await createTestClub();
    const updated = await new PrismaClubRepository(prisma).setMfaRequiredForAdmins(club.id, true);
    expect(updated.mfaRequiredForAdmins).toBe(true);
  });

  it('der Datenexport enthält kein (verschlüsseltes) Secret', async () => {
    const club = await createTestClub();
    const user = await seedUser(club.id);
    await users.setPendingTotpSecret(user.id, 'v1:geheim');
    await users.enableTotp(user.id, 100);
    const exported = await new PrismaProfileDataGateway(prisma).exportUserData(user.id);
    expect(JSON.stringify(exported)).not.toContain('v1:geheim');
    expect(exported.user).not.toHaveProperty('totpLastUsedStep');
    expect(exported.user.totpEnabledAt).toBeTruthy();
  });
});
