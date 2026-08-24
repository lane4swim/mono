// apps/api/test-integration/profileErasure.integration.test.ts
//
// Prüft PrismaProfileDataGateway und PrismaErasureJobGateway (den
// zweiteiligen DSGVO-Löschprozess, Art. 15/17) gegen eine echte Datenbank
// (siehe vitest.integration.config.ts). Deckt insbesondere zwei zuvor per
// Code-Review behobene Regressionen ab, die sich nur gegen eine echte
// Transaktions-/Abfrage-Semantik verlässlich prüfen lassen:
//   - Befund 5: requestErasure() legt den DataDeletionRequest in
//     DERSELBEN Transaktion wie den Soft-Delete an.
//   - Befund 11: ein `clubId ?? undefined`-Fallback hätte in Prisma "kein
//     Filter" bedeutet — hier absichtlich mit einem invariantenwidrigen
//     Nutzer (athleteId gesetzt, clubId null) geprüft, dass die
//     Trainingseinheiten ANDERER Vereine dadurch weder gelesen noch
//     verändert werden.
import { describe, it, expect, afterEach, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { PrismaProfileDataGateway, ErasureAlreadyRequestedError } from '../src/modules/profile/profile.repository.js';
import { PrismaErasureJobGateway } from '../src/jobs/erasure.repository.js';
import { getTestPrisma, closeTestPrisma, truncateAll, createTestClub } from './helpers.js';

const prisma = getTestPrisma();
const profileGateway = new PrismaProfileDataGateway(prisma);
const erasureGateway = new PrismaErasureJobGateway(prisma);

afterEach(async () => {
  await truncateAll();
});
afterAll(async () => {
  await closeTestPrisma();
});

async function seedAthleteUser(clubId: string | null) {
  const athlete = clubId
    ? await prisma.athlete.create({ data: { clubId, firstName: 'Mara', lastName: 'Vogel' } })
    : null;
  const user = await prisma.user.create({
    data: {
      clubId,
      name: 'Mara Vogel',
      email: `mara-${randomUUID()}@example.org`,
      passwordHash: 'hash',
      role: 'athlete',
      athleteId: athlete?.id ?? null,
    },
  });
  return { user, athlete };
}

describe('PrismaProfileDataGateway.requestErasure()', () => {
  it('legt Soft-Delete UND DataDeletionRequest atomar in einer Transaktion an', async () => {
    const club = await createTestClub();
    const { user, athlete } = await seedAthleteUser(club.id);
    await prisma.result.create({ data: { clubId: club.id, athleteId: athlete!.id, event: '100m Freistil', time: 60, date: new Date() } });

    const result = await profileGateway.requestErasure(user.id, 30);
    expect(result.status).toBe('pending');

    const updatedUser = await prisma.user.findUnique({ where: { id: user.id } });
    expect(updatedUser?.deletedAt).not.toBeNull();
    const updatedAthlete = await prisma.athlete.findUnique({ where: { id: athlete!.id } });
    expect(updatedAthlete?.deletedAt).not.toBeNull();
    const deletionRequest = await prisma.dataDeletionRequest.findUnique({ where: { userId: user.id } });
    expect(deletionRequest).not.toBeNull();
    expect(deletionRequest?.status).toBe('pending');
  });

  it('lehnt eine zweite Löschanfrage für dasselbe Konto ab', async () => {
    const club = await createTestClub();
    const { user } = await seedAthleteUser(club.id);
    await profileGateway.requestErasure(user.id, 30);

    await expect(profileGateway.requestErasure(user.id, 30)).rejects.toBeInstanceOf(ErasureAlreadyRequestedError);
  });
});

describe('PrismaProfileDataGateway.exportUserData() — Befund-11-Regression', () => {
  it('liefert leere Anwesenheitsdaten, statt Trainingseinheiten fremder Vereine zu lesen, wenn clubId fehlt', async () => {
    const clubA = await createTestClub(prisma, 'Verein A');
    // Invariantenwidriger Zustand (sollte im Betrieb nie vorkommen, siehe
    // Kommentar bei profile.repository.ts: exportUserData()): athleteId
    // gesetzt, aber clubId null.
    const { user } = await seedAthleteUser(null);
    await prisma.trainingSession.create({
      data: { clubId: clubA.id, date: new Date(), attendance: [{ athleteId: 'irgendjemand', present: true }] },
    });

    const exportResult = await profileGateway.exportUserData(user.id);
    // Vor der Korrektur hätte `clubId: undefined` in Prisma "kein Filter"
    // bedeutet — die obige, fremde Trainingseinheit wäre geladen worden.
    expect(exportResult.attendance).toEqual([]);
  });
});

describe('PrismaErasureJobGateway.purgeUserAndDependents()', () => {
  it('löscht unwiderruflich RefreshTokens/Athlet:innen-Profil samt abhängiger Daten und legt Tombstones an', async () => {
    const club = await createTestClub();
    const { user, athlete } = await seedAthleteUser(club.id);
    await prisma.refreshToken.create({ data: { userId: user.id, tokenHash: randomUUID(), expiresAt: new Date(Date.now() + 1000) } });
    const result = await prisma.result.create({ data: { clubId: club.id, athleteId: athlete!.id, event: '100m Freistil', time: 60, date: new Date() } });
    const session = await prisma.trainingSession.create({
      data: { clubId: club.id, date: new Date(), attendance: [{ athleteId: athlete!.id, present: true }, { athleteId: 'andere-person', present: false }] },
    });

    await erasureGateway.purgeUserAndDependents(user.id);

    expect(await prisma.user.findUnique({ where: { id: user.id } })).toBeNull();
    expect(await prisma.athlete.findUnique({ where: { id: athlete!.id } })).toBeNull();
    expect(await prisma.result.findUnique({ where: { id: result.id } })).toBeNull();
    expect(await prisma.refreshToken.findMany({ where: { userId: user.id } })).toEqual([]);

    // Die Anwesenheit der gelöschten Person wurde aus der Einheit entfernt,
    // die der anderen Person bleibt erhalten.
    const updatedSession = await prisma.trainingSession.findUnique({ where: { id: session.id } });
    expect(updatedSession?.attendance).toEqual([{ athleteId: 'andere-person', present: false }]);

    // Tombstone für den gelöschten Athleten UND das gelöschte Ergebnis.
    const tombstones = await prisma.syncTombstone.findMany({ where: { clubId: club.id } });
    expect(tombstones.map((t) => `${t.store}:${t.entityId}`).sort()).toEqual(
      [`athletes:${athlete!.id}`, `results:${result.id}`].sort(),
    );
  });

  it('ist idempotent — ein bereits gelöschtes Konto führt zu keinem Fehler', async () => {
    const club = await createTestClub();
    const { user } = await seedAthleteUser(club.id);
    await erasureGateway.purgeUserAndDependents(user.id);
    await expect(erasureGateway.purgeUserAndDependents(user.id)).resolves.toBeUndefined();
  });
});

describe('PrismaErasureJobGateway.findDuePendingRequests()', () => {
  it('liefert nur "pending"-Anfragen, deren purgeAfter bereits erreicht ist', async () => {
    const club = await createTestClub();
    const { user: dueUser } = await seedAthleteUser(club.id);
    const { user: notYetDueUser } = await seedAthleteUser(club.id);
    const { user: alreadyPurgedUser } = await seedAthleteUser(club.id);

    const now = new Date();
    await prisma.dataDeletionRequest.create({ data: { userId: dueUser.id, purgeAfter: new Date(now.getTime() - 1000), status: 'pending' } });
    await prisma.dataDeletionRequest.create({ data: { userId: notYetDueUser.id, purgeAfter: new Date(now.getTime() + 100_000), status: 'pending' } });
    await prisma.dataDeletionRequest.create({ data: { userId: alreadyPurgedUser.id, purgeAfter: new Date(now.getTime() - 1000), status: 'purged' } });

    const due = await erasureGateway.findDuePendingRequests(now);
    expect(due.map((d) => d.userId)).toEqual([dueUser.id]);
  });
});
