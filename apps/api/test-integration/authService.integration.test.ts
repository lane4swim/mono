// apps/api/test-integration/authService.integration.test.ts
//
// Prüft createAuthService() end-to-end mit den ECHTEN Prisma-
// Repositories gegen eine echte Datenbank (siehe vitest.integration.
// config.ts) — insbesondere zwei P2002-Zweige in acceptInvitation(), die
// sich NUR gegen echte Unique-Constraints auslösen lassen (die
// In-Memory-Doubles kennen keine DB-Constraints, siehe auth.repository.
// memory.ts: create() dort validiert nichts):
//   - Befund 6: eine bereits soft-gelöschte Person wird erneut
//     eingeladen -> findByEmail() liefert für sie fälschlich `null`
//     (siehe deren Kommentar), der echte email-Unique-Constraint greift
//     aber trotzdem -> muss als EmailAlreadyRegisteredError (409), nicht
//     als ungefangener 500, ankommen.
//   - Befund 11: zwei Einladungen referenzieren dieselbe athleteId (die
//     Einladungsausstellung selbst prüft das nicht) -> der neue
//     athleteId-Unique-Constraint (schema.prisma) greift beim zweiten
//     Annehmen -> muss als AthleteAlreadyLinkedError (409) ankommen.
import { describe, it, expect, afterEach, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createAuthService, EmailAlreadyRegisteredError, AthleteAlreadyLinkedError } from '../src/modules/auth/auth.service.js';
import { PrismaUserRepository, PrismaRefreshTokenRepository } from '../src/modules/auth/auth.repository.js';
import { createInvitationsService } from '../src/modules/invitations/invitations.service.js';
import { PrismaClubRepository, PrismaInvitationRepository, PrismaAthleteRepository } from '../src/modules/invitations/invitations.repository.js';
import { PrismaProfileDataGateway } from '../src/modules/profile/profile.repository.js';
import { InMemoryMailSender } from '../src/mail/mailer.memory.js';
import { generateFreshKeyPair } from '../src/auth/keys.js';
import { getTestPrisma, closeTestPrisma, truncateAll, createTestClub } from './helpers.js';

const prisma = getTestPrisma();

function makeServices() {
  const clubs = new PrismaClubRepository(prisma);
  const invitationsService = createInvitationsService({
    clubs,
    invitations: new PrismaInvitationRepository(prisma),
    athletes: new PrismaAthleteRepository(prisma),
    users: new PrismaUserRepository(prisma),
    mailer: new InMemoryMailSender(),
    frontendBaseUrl: 'https://app.example.org',
    clubInvitationTtlDays: 14,
    memberInvitationTtlDays: 7,
  });
  const authService = createAuthService({
    users: new PrismaUserRepository(prisma),
    refreshTokens: new PrismaRefreshTokenRepository(prisma),
    invitations: invitationsService,
    profileGateway: new PrismaProfileDataGateway(prisma),
    clubs,
    dataErasureRetentionDays: 30,
    keyPair: generateFreshKeyPair(),
    accessTtlSeconds: 900,
    refreshTtlDays: 30,
  });
  return { authService, invitationsService };
}

afterEach(async () => {
  await truncateAll();
});
afterAll(async () => {
  await closeTestPrisma();
});

// Invitation.invitedById trägt eine echte Fremdschlüssel-Beziehung zu
// users.id (siehe schema.prisma) — anders als bei einem In-Memory-Double
// braucht der "requester" hier ein tatsächlich existierendes Konto.
async function createTestSuperadmin(): Promise<{ id: string; role: 'superadmin'; clubId: null }> {
  const user = await prisma.user.create({
    data: { clubId: null, name: 'Super', email: `super-${randomUUID()}@example.org`, passwordHash: 'hash', role: 'superadmin' },
  });
  return { id: user.id, role: 'superadmin', clubId: null };
}

describe('authService.acceptInvitation() — P2002-Regressionen (Code-Review)', () => {
  it('lehnt die Annahme einer Einladung für eine bereits soft-gelöschte, gleichnamige E-Mail-Adresse mit EmailAlreadyRegisteredError ab (Befund 6)', async () => {
    const club = await createTestClub();
    const { authService, invitationsService } = makeServices();
    const requester = await createTestSuperadmin();

    const firstInvitation = await invitationsService.createInvitation(
      { email: 'mara.vogel@example.org', role: 'trainer', clubId: club.id },
      requester,
    );
    await authService.acceptInvitation({ token: firstInvitation.token, name: 'Mara Vogel', password: 'ein-sicheres-passwort', consent: true });

    // Konto soft-löschen (Recht auf Löschung, Art. 17 DSGVO) — die E-Mail
    // ist in der Datenbank weiterhin @unique belegt, findByEmail() liefert
    // für ein soft-gelöschtes Konto aber bewusst `null` (siehe
    // auth.repository.ts).
    await prisma.user.updateMany({ where: { email: 'mara.vogel@example.org' }, data: { deletedAt: new Date() } });

    const secondInvitation = await invitationsService.createInvitation(
      { email: 'mara.vogel@example.org', role: 'trainer', clubId: club.id },
      requester,
    );

    await expect(
      authService.acceptInvitation({ token: secondInvitation.token, name: 'Mara Vogel (neu)', password: 'ein-anderes-passwort', consent: true }),
    ).rejects.toBeInstanceOf(EmailAlreadyRegisteredError);
  });

  it('lehnt die Annahme einer zweiten Einladung für ein bereits verknüpftes Athletenprofil mit AthleteAlreadyLinkedError ab (Befund 11)', async () => {
    const club = await createTestClub();
    const athlete = await prisma.athlete.create({ data: { clubId: club.id, firstName: 'Mara', lastName: 'Vogel' } });
    const { authService, invitationsService } = makeServices();
    const requester = await createTestSuperadmin();

    const firstInvitation = await invitationsService.createInvitation(
      { email: 'erste@example.org', role: 'athlete', clubId: club.id, athleteId: athlete.id },
      requester,
    );
    await authService.acceptInvitation({ token: firstInvitation.token, name: 'Erste Person', password: 'ein-sicheres-passwort', consent: true });

    // Die Einladungsausstellung selbst prüft nicht, ob athleteId bereits
    // vergeben ist (siehe invitations.service.ts) — eine zweite Einladung
    // für dieselbe athleteId lässt sich also ausstellen; erst beim
    // tatsächlichen Annehmen greift der neue Unique-Constraint.
    const secondInvitation = await invitationsService.createInvitation(
      { email: 'zweite@example.org', role: 'athlete', clubId: club.id, athleteId: athlete.id },
      requester,
    );

    await expect(
      authService.acceptInvitation({ token: secondInvitation.token, name: 'Zweite Person', password: 'ein-anderes-passwort', consent: true }),
    ).rejects.toBeInstanceOf(AthleteAlreadyLinkedError);
  });
});
