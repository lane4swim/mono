// apps/api/test/invitations/invitations.service.test.ts
import { describe, it, expect } from 'vitest';
import { InMemoryMailSender } from '../../src/mail/mailer.memory.js';
import {
  createInvitationsService,
  ForbiddenError,
  ClubNotFoundError,
  AthleteNotFoundError,
  AthleteClubMismatchError,
  InvitationNotFoundError,
  InvitationExpiredError,
  InvitationAlreadyUsedError,
  InvitationRevokedError,
} from '../../src/modules/invitations/invitations.service.js';
import { InMemoryClubRepository, InMemoryInvitationRepository, InMemoryAthleteRepository } from '../../src/modules/invitations/invitations.repository.memory.js';

const SUPERADMIN = { id: 'super-1', role: 'superadmin', clubId: null };
const ADMIN_OF_CLUB_A = { id: 'admin-a', role: 'admin', clubId: 'club-a' };
const ADMIN_OF_CLUB_B = { id: 'admin-b', role: 'admin', clubId: 'club-b' };
const TRAINER = { id: 'trainer-1', role: 'trainer', clubId: 'club-a' };
const ATHLETE = { id: 'athlete-1', role: 'athlete', clubId: 'club-a' };

function makeService() {
  const clubs = new InMemoryClubRepository();
  const invitations = new InMemoryInvitationRepository();
  const athletes = new InMemoryAthleteRepository();
  const mailer = new InMemoryMailSender();
  const service = createInvitationsService({
    clubs, invitations, athletes, mailer, frontendBaseUrl: 'https://app.example.org',
    clubInvitationTtlDays: 14, memberInvitationTtlDays: 7,
  });
  return { service, clubs, invitations, athletes, mailer };
}

describe('invitationsService.createClub', () => {
  it('superadmin kann einen Verein anlegen und erhält direkt eine Admin-Einladung', async () => {
    const { service } = makeService();
    const result = await service.createClub(
      { name: 'SV Wasserfreunde', adminEmail: 'admin@sv.de', adminName: 'Petra Klein' },
      SUPERADMIN,
    );
    expect(result.club.name).toBe('SV Wasserfreunde');
    expect(result.invitation.role).toBe('admin');
    expect(result.invitation.clubId).toBe(result.club.id);
    expect(result.invitation.token).toBeTruthy();
  });

  it('admin darf KEINEN Verein anlegen (403)', async () => {
    const { service } = makeService();
    await expect(
      service.createClub({ name: 'X', adminEmail: 'a@b.de', adminName: 'Y' }, ADMIN_OF_CLUB_A),
    ).rejects.toThrow(ForbiddenError);
  });

  it('trainer/athlete dürfen keinen Verein anlegen (403)', async () => {
    const { service } = makeService();
    await expect(service.createClub({ name: 'X', adminEmail: 'a@b.de', adminName: 'Y' }, TRAINER)).rejects.toThrow(ForbiddenError);
    await expect(service.createClub({ name: 'X', adminEmail: 'a@b.de', adminName: 'Y' }, ATHLETE)).rejects.toThrow(ForbiddenError);
  });
});

describe('invitationsService.createInvitation — Autorisierungsmatrix', () => {
  it('superadmin kann eine admin-Einladung für einen bestehenden Verein ausstellen', async () => {
    const { service, clubs } = makeService();
    const club = await clubs.create({ name: 'Verein X' });
    const invitation = await service.createInvitation({ email: 'admin@x.de', role: 'admin', clubId: club.id }, SUPERADMIN);
    expect(invitation.role).toBe('admin');
    expect(invitation.clubId).toBe(club.id);
  });

  it('superadmin OHNE clubId für eine admin-Einladung wird abgelehnt', async () => {
    const { service } = makeService();
    await expect(service.createInvitation({ email: 'admin@x.de', role: 'admin' }, SUPERADMIN)).rejects.toThrow(ForbiddenError);
  });

  it('admin darf KEINE admin-Einladung ausstellen (403)', async () => {
    const { service, clubs } = makeService();
    const club = await clubs.create({ name: 'Club A' });
    await expect(
      service.createInvitation({ email: 'x@y.de', role: 'admin', clubId: club.id }, { ...ADMIN_OF_CLUB_A, clubId: club.id }),
    ).rejects.toThrow(ForbiddenError);
  });

  it('admin kann trainer/athlete für den EIGENEN Verein einladen', async () => {
    const { service, clubs } = makeService();
    const club = await clubs.create({ name: 'Club A' });
    const requester = { ...ADMIN_OF_CLUB_A, clubId: club.id };
    const trainerInvite = await service.createInvitation({ email: 'trainer@a.de', role: 'trainer' }, requester);
    expect(trainerInvite.clubId).toBe(club.id);
    const athleteInvite = await service.createInvitation({ email: 'athlete@a.de', role: 'athlete' }, requester);
    expect(athleteInvite.clubId).toBe(club.id);
  });

  it('eine von einem Admin mitgeschickte abweichende clubId wird ignoriert — es gilt immer der eigene Verein', async () => {
    const { service, clubs } = makeService();
    const clubA = await clubs.create({ name: 'Club A' });
    const clubB = await clubs.create({ name: 'Club B' });
    const requester = { ...ADMIN_OF_CLUB_A, clubId: clubA.id };
    const invitation = await service.createInvitation({ email: 'x@y.de', role: 'trainer', clubId: clubB.id }, requester);
    expect(invitation.clubId).toBe(clubA.id); // NICHT clubB
  });

  it('trainer/athlete dürfen niemanden einladen (403)', async () => {
    const { service } = makeService();
    await expect(service.createInvitation({ email: 'x@y.de', role: 'trainer' }, TRAINER)).rejects.toThrow(ForbiddenError);
    await expect(service.createInvitation({ email: 'x@y.de', role: 'athlete' }, ATHLETE)).rejects.toThrow(ForbiddenError);
  });

  it('superadmin kann trainer/athlete für einen beliebigen Verein einladen (muss clubId angeben)', async () => {
    const { service, clubs } = makeService();
    const club = await clubs.create({ name: 'Club A' });
    const invitation = await service.createInvitation({ email: 'trainer@a.de', role: 'trainer', clubId: club.id }, SUPERADMIN);
    expect(invitation.clubId).toBe(club.id);
  });

  it('superadmin OHNE clubId für trainer/athlete wird abgelehnt', async () => {
    const { service } = makeService();
    await expect(service.createInvitation({ email: 'x@y.de', role: 'trainer' }, SUPERADMIN)).rejects.toThrow(ForbiddenError);
  });

  it('lehnt eine Einladung für einen nicht existierenden Verein ab (404)', async () => {
    const { service } = makeService();
    await expect(
      service.createInvitation({ email: 'x@y.de', role: 'admin', clubId: '00000000-0000-0000-0000-000000000000' }, SUPERADMIN),
    ).rejects.toThrow(ClubNotFoundError);
  });
});

describe('invitationsService.createInvitation — athleteId muss zum Zielverein gehören (Sicherheitsregression)', () => {
  it('lehnt eine athlete-Einladung ab, deren athleteId zu einem FREMDEN Verein gehört', async () => {
    const { service, clubs, athletes } = makeService();
    const clubA = await clubs.create({ name: 'Club A' });
    const clubB = await clubs.create({ name: 'Club B' });
    // Athletenprofil gehört zu Verein B ...
    athletes.seed({ id: 'athlete-in-club-b', clubId: clubB.id });
    const requester = { ...ADMIN_OF_CLUB_A, clubId: clubA.id };

    // ... aber der Admin von Verein A versucht, ein Konto dafür einzuladen.
    await expect(
      service.createInvitation({ email: 'x@y.de', role: 'athlete', athleteId: 'athlete-in-club-b' }, requester),
    ).rejects.toThrow(AthleteClubMismatchError);
  });

  it('lehnt eine athlete-Einladung mit einer nicht existierenden athleteId ab', async () => {
    const { service, clubs } = makeService();
    const club = await clubs.create({ name: 'Club A' });
    const requester = { ...ADMIN_OF_CLUB_A, clubId: club.id };

    await expect(
      service.createInvitation({ email: 'x@y.de', role: 'athlete', athleteId: '00000000-0000-0000-0000-000000000000' }, requester),
    ).rejects.toThrow(AthleteNotFoundError);
  });

  it('akzeptiert eine athlete-Einladung, deren athleteId zum EIGENEN Verein gehört', async () => {
    const { service, clubs, athletes } = makeService();
    const club = await clubs.create({ name: 'Club A' });
    athletes.seed({ id: 'athlete-in-club-a', clubId: club.id });
    const requester = { ...ADMIN_OF_CLUB_A, clubId: club.id };

    const invitation = await service.createInvitation(
      { email: 'x@y.de', role: 'athlete', athleteId: 'athlete-in-club-a' },
      requester,
    );
    expect(invitation.clubId).toBe(club.id);
  });

  it('superadmin: die athleteId muss zum explizit angegebenen Zielverein gehören, nicht irgendeinem', async () => {
    const { service, clubs, athletes } = makeService();
    const clubA = await clubs.create({ name: 'Club A' });
    const clubB = await clubs.create({ name: 'Club B' });
    athletes.seed({ id: 'athlete-in-club-a', clubId: clubA.id });

    await expect(
      service.createInvitation({ email: 'x@y.de', role: 'athlete', athleteId: 'athlete-in-club-a', clubId: clubB.id }, SUPERADMIN),
    ).rejects.toThrow(AthleteClubMismatchError);
  });

  it('ohne athleteId findet keine Athleten-Prüfung statt (trainer-Einladungen bleiben unberührt)', async () => {
    const { service, clubs } = makeService();
    const club = await clubs.create({ name: 'Club A' });
    const requester = { ...ADMIN_OF_CLUB_A, clubId: club.id };
    const invitation = await service.createInvitation({ email: 'trainer@a.de', role: 'trainer' }, requester);
    expect(invitation.clubId).toBe(club.id);
  });
});

describe('invitationsService.findValidByToken / preview', () => {
  it('liefert die Vorschau mit Vereinsnamen für eine gültige Einladung', async () => {
    const { service, clubs } = makeService();
    const club = await clubs.create({ name: 'SV Wasserfreunde' });
    const invitation = await service.createInvitation({ email: 'trainer@sv.de', role: 'trainer', clubId: club.id }, SUPERADMIN);
    const preview = await service.preview(invitation.token);
    expect(preview.email).toBe('trainer@sv.de');
    expect(preview.role).toBe('trainer');
    expect(preview.clubName).toBe('SV Wasserfreunde');
  });

  it('wirft bei unbekanntem Token', async () => {
    const { service } = makeService();
    await expect(service.preview('kein-echtes-token')).rejects.toThrow(InvitationNotFoundError);
  });

  it('wirft bei abgelaufenem Token', async () => {
    const { service, invitations } = makeService();
    const { hashInvitationToken } = await import('../../src/auth/tokens.js');
    const plainToken = 'expired-token-123';
    await invitations.create({
      tokenHash: hashInvitationToken(plainToken),
      email: 'x@y.de', role: 'trainer', clubId: null, athleteId: null,
      invitedById: 'someone', expiresAt: new Date(Date.now() - 1000),
    });
    await expect(service.preview(plainToken)).rejects.toThrow(InvitationExpiredError);
  });

  it('wirft bei bereits verwendetem Token', async () => {
    const { service, clubs } = makeService();
    const club = await clubs.create({ name: 'X' });
    const invitation = await service.createInvitation({ email: 'a@b.de', role: 'trainer', clubId: club.id }, SUPERADMIN);
    await service.markUsed(invitation.id);
    await expect(service.preview(invitation.token)).rejects.toThrow(InvitationAlreadyUsedError);
  });

  it('wirft bei widerrufenem Token', async () => {
    const { service, clubs } = makeService();
    const club = await clubs.create({ name: 'X' });
    const invitation = await service.createInvitation({ email: 'a@b.de', role: 'trainer', clubId: club.id }, SUPERADMIN);
    await service.revoke(invitation.id, SUPERADMIN);
    await expect(service.preview(invitation.token)).rejects.toThrow(InvitationRevokedError);
  });
});

describe('invitationsService.list / revoke', () => {
  it('admin sieht nur Einladungen des eigenen Vereins', async () => {
    const { service, clubs } = makeService();
    const clubA = await clubs.create({ name: 'Club A' });
    const clubB = await clubs.create({ name: 'Club B' });
    const requesterA = { ...ADMIN_OF_CLUB_A, clubId: clubA.id };
    const requesterB = { ...ADMIN_OF_CLUB_B, clubId: clubB.id };
    await service.createInvitation({ email: 'a@a.de', role: 'trainer' }, requesterA);
    await service.createInvitation({ email: 'b@b.de', role: 'trainer' }, requesterB);

    const listA = await service.list(requesterA);
    expect(listA).toHaveLength(1);
    expect(listA[0]!.email).toBe('a@a.de');
  });

  it('liefert kein tokenHash-Feld in der Antwort (Sicherheitsregression, Datenminimierung)', async () => {
    const { service, clubs } = makeService();
    const club = await clubs.create({ name: 'Club A' });
    const requester = { ...ADMIN_OF_CLUB_A, clubId: club.id };
    await service.createInvitation({ email: 'a@a.de', role: 'trainer' }, requester);

    const list = await service.list(requester);
    expect(list).toHaveLength(1);
    expect(list[0]).not.toHaveProperty('tokenHash');
    // Zur Kontrolle: die übrigen, unbedenklichen Felder bleiben erhalten.
    expect(list[0]).toMatchObject({ email: 'a@a.de', role: 'trainer', clubId: club.id });
  });

  it('superadmin sieht alle Einladungen aller Vereine', async () => {
    const { service, clubs } = makeService();
    const clubA = await clubs.create({ name: 'Club A' });
    const clubB = await clubs.create({ name: 'Club B' });
    await service.createInvitation({ email: 'a@a.de', role: 'trainer', clubId: clubA.id }, SUPERADMIN);
    await service.createInvitation({ email: 'b@b.de', role: 'trainer', clubId: clubB.id }, SUPERADMIN);
    const all = await service.list(SUPERADMIN);
    expect(all).toHaveLength(2);
  });

  it('admin kann eine Einladung des eigenen Vereins widerrufen', async () => {
    const { service, clubs } = makeService();
    const club = await clubs.create({ name: 'Club A' });
    const requester = { ...ADMIN_OF_CLUB_A, clubId: club.id };
    const invitation = await service.createInvitation({ email: 'a@a.de', role: 'trainer' }, requester);
    await expect(service.revoke(invitation.id, requester)).resolves.not.toThrow();
  });

  it('admin kann KEINE Einladung eines fremden Vereins widerrufen (403)', async () => {
    const { service, clubs } = makeService();
    const clubA = await clubs.create({ name: 'Club A' });
    const clubB = await clubs.create({ name: 'Club B' });
    const requesterA = { ...ADMIN_OF_CLUB_A, clubId: clubA.id };
    const requesterB = { ...ADMIN_OF_CLUB_B, clubId: clubB.id };
    const invitation = await service.createInvitation({ email: 'a@a.de', role: 'trainer' }, requesterA);
    await expect(service.revoke(invitation.id, requesterB)).rejects.toThrow(ForbiddenError);
  });
});

describe('invitationsService — Einladungs-E-Mail-Versand', () => {
  it('createClub() versendet eine Einladungs-E-Mail an die angegebene Admin-Adresse', async () => {
    const { service, mailer } = makeService();
    await service.createClub({ name: 'SV Wasserfreunde', adminEmail: 'admin@sv.de', adminName: 'Petra Klein' }, SUPERADMIN);
    expect(mailer.sentEmails).toHaveLength(1);
    expect(mailer.sentEmails[0]).toMatchObject({ to: 'admin@sv.de', role: 'admin', clubName: 'SV Wasserfreunde' });
    expect(mailer.sentEmails[0]!.inviteUrl).toContain('https://app.example.org/#/accept-invite/');
  });

  it('createInvitation() versendet eine Einladungs-E-Mail an die eingeladene Person', async () => {
    const { service, mailer, clubs } = makeService();
    const club = await clubs.create({ name: 'Club A' });
    const requester = { ...ADMIN_OF_CLUB_A, clubId: club.id };
    await service.createInvitation({ email: 'trainer@a.de', role: 'trainer' }, requester);
    expect(mailer.sentEmails).toHaveLength(1);
    expect(mailer.sentEmails[0]).toMatchObject({ to: 'trainer@a.de', role: 'trainer', clubName: 'Club A' });
  });

  it('der Einladungslink enthält das tatsächlich ausgestellte Token', async () => {
    const { service, mailer, clubs } = makeService();
    const club = await clubs.create({ name: 'Club A' });
    const invitation = await service.createInvitation({ email: 'trainer@a.de', role: 'trainer' }, { ...ADMIN_OF_CLUB_A, clubId: club.id });
    expect(mailer.sentEmails[0]!.inviteUrl).toBe(`https://app.example.org/#/accept-invite/${invitation.token}`);
  });
});

describe('invitationsService.listClubs — Mitgliederzahlen', () => {
  it('liefert für jeden Verein die Anzahl aktiver Admins/Trainer:innen/Athlet:innen', async () => {
    let users: Array<{ clubId: string | null; role: string; deletedAt?: Date | null }> = [];
    const clubs = new InMemoryClubRepository(() => users);
    const invitations = new InMemoryInvitationRepository();
    const mailer = new InMemoryMailSender();
    const service = createInvitationsService({ clubs, invitations, athletes: new InMemoryAthleteRepository(), mailer, frontendBaseUrl: 'https://app.example.org', clubInvitationTtlDays: 14, memberInvitationTtlDays: 7 });

    const club = await clubs.create({ name: 'Club A' });
    users = [
      { clubId: club.id, role: 'admin' },
      { clubId: club.id, role: 'trainer' },
      { clubId: club.id, role: 'trainer' },
      { clubId: club.id, role: 'athlete' },
    ];

    const result = await service.listClubs(SUPERADMIN);
    expect(result).toHaveLength(1);
    expect(result[0]!.memberCounts).toEqual({ admin: 1, trainer: 2, athlete: 1 });
  });

  it('zählt nur nicht-gelöschte Nutzer:innen', async () => {
    const clubId = 'the-club-id';
    const clubs = new InMemoryClubRepository(() => [
      { clubId, role: 'trainer', deletedAt: null },
      { clubId, role: 'trainer', deletedAt: new Date() }, // gelöscht -> zählt nicht
    ]);
    const counts = await clubs.countMembersForClubs([clubId]);
    expect(counts.get(clubId)).toEqual({ admin: 0, trainer: 1, athlete: 0 });
  });

  it('liefert 0/0/0 für einen Verein ohne Mitglieder', async () => {
    const clubs = new InMemoryClubRepository();
    const counts = await clubs.countMembersForClubs(['irgendeine-id']);
    expect(counts.get('irgendeine-id')).toEqual({ admin: 0, trainer: 0, athlete: 0 });
  });
});
