// apps/api/test-integration/invitationsRepository.integration.test.ts
//
// Prüft PrismaClubRepository.createWithAdminInvitation() gegen eine echte
// Datenbank (siehe vitest.integration.config.ts) — insbesondere die
// tatsächliche Transaktions-Atomarität (Code-Review): schlägt die
// Einladung fehl, darf der Verein NICHT bestehen bleiben. Das lässt sich
// nur gegen eine echte Datenbank beweisen — ein In-Memory-Double kann eine
// echte Transaktions-/Rollback-Garantie nicht sinnvoll simulieren (siehe
// invitations.repository.memory.ts).
import { describe, it, expect, afterEach, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { PrismaClubRepository } from '../src/modules/invitations/invitations.repository.js';
import { getTestPrisma, closeTestPrisma, truncateAll } from './helpers.js';

const prisma = getTestPrisma();
const repo = new PrismaClubRepository(prisma);

afterEach(async () => {
  await truncateAll();
});
afterAll(async () => {
  await closeTestPrisma();
});

describe('PrismaClubRepository.createWithAdminInvitation()', () => {
  it('legt Verein UND Admin-Einladung gemeinsam an', async () => {
    // invitedById ist beim Anlegen PFLICHT (nur der GESPEICHERTE Datensatz
    // wird später nullable, siehe schema.prisma: onDelete: SetNull) —
    // braucht daher ein tatsächlich existierendes User-Konto.
    const superadmin = await prisma.user.create({
      data: { clubId: null, name: 'Super', email: `super-${randomUUID()}@example.org`, passwordHash: 'hash', role: 'superadmin' },
    });

    const { club, invitation } = await repo.createWithAdminInvitation(
      { name: 'SV Wasserfreunde' },
      (createdClub) => ({
        tokenHash: randomUUID(),
        email: 'admin@sv-wasserfreunde.de',
        role: 'admin',
        clubId: createdClub.id,
        athleteId: null,
        invitedById: superadmin.id,
        expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 14),
      }),
    );

    expect(club.name).toBe('SV Wasserfreunde');
    expect(invitation.clubId).toBe(club.id);
    expect(await prisma.club.findUnique({ where: { id: club.id } })).not.toBeNull();
    expect(await prisma.invitation.findUnique({ where: { id: invitation.id } })).not.toBeNull();
  });

  // Der eigentliche Beweis der Atomarität: invitedById verweist auf eine
  // NICHT existierende User-id -> Prismas Fremdschlüssel-Constraint lehnt
  // den invitation.create()-Aufruf INNERHALB der Transaktion ab (P2003).
  // Vor der Korrektur (zwei unabhängige Aufrufe statt einer Transaktion)
  // hätte der Verein trotzdem bestehen bleiben — für niemanden erreichbar,
  // nicht über die API reparierbar.
  it('lässt KEINEN verwaisten Verein zurück, wenn die Einladung fehlschlägt (Transaktions-Rollback)', async () => {
    const nonExistentUserId = randomUUID();

    await expect(
      repo.createWithAdminInvitation(
        { name: 'SV Sollte Nicht Bestehen Bleiben' },
        (createdClub) => ({
          tokenHash: randomUUID(),
          email: 'admin@sv-sollte-nicht.de',
          role: 'admin',
          clubId: createdClub.id,
          athleteId: null,
          invitedById: nonExistentUserId, // erzwingt P2003 innerhalb der Transaktion
          expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 14),
        }),
      ),
    ).rejects.toMatchObject({ code: 'P2003' });

    // Der Verein wurde NICHT persistiert — die Transaktion hat ihn
    // zurückgerollt, obwohl der club.create()-Teilschritt für sich
    // genommen erfolgreich gewesen wäre.
    const orphanedClub = await prisma.club.findFirst({ where: { name: 'SV Sollte Nicht Bestehen Bleiben' } });
    expect(orphanedClub).toBeNull();
  });
});
