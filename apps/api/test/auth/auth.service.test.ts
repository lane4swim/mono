// apps/api/test/auth/auth.service.test.ts
import { describe, it, expect, vi } from 'vitest';
import {
  createAuthService,
  EmailAlreadyRegisteredError,
  InvalidCredentialsError,
  InvalidRefreshTokenError,
  InvalidInvitationError,
  InvalidCurrentPasswordError,
  InvalidOrExpiredResetTokenError,
} from '../../src/modules/auth/auth.service.js';
import { InMemoryUserRepository, InMemoryRefreshTokenRepository, InMemoryPasswordResetTokenRepository } from '../../src/modules/auth/auth.repository.memory.js';
import type { PasswordResetTokenRecord } from '../../src/modules/auth/auth.repository.js';
import { createInvitationsService } from '../../src/modules/invitations/invitations.service.js';
import { InMemoryClubRepository, InMemoryInvitationRepository, InMemoryAthleteRepository } from '../../src/modules/invitations/invitations.repository.memory.js';
import { InMemoryMailSender } from '../../src/mail/mailer.memory.js';
import { InMemoryProfileDataGateway } from '../../src/modules/profile/profile.repository.memory.js';
import { generateFreshKeyPair } from '../../src/auth/keys.js';
import { verifyAccessToken } from '../../src/auth/tokens.js';
import { generateInvitationToken } from '../../src/auth/tokens.js';
import { CURRENT_CONSENT_VERSION, LoginRequestSchema } from '@lane1/shared-types';

const CLUB_ID = '11111111-1111-1111-1111-111111111111';
const INVITER_ID = '99999999-9999-9999-9999-999999999999';

function makeService() {
  const users = new InMemoryUserRepository();
  const refreshTokens = new InMemoryRefreshTokenRepository();
  const invitations = new InMemoryInvitationRepository();
  // acceptInvitation() nutzt dieselbe Gültigkeitsprüfung wie
  // invitations.service.ts (siehe deren findValidByToken() sowie den
  // AuthServiceDeps.invitations-Kommentar in auth.service.ts) — daher hier
  // eine echte InvitationsService-Instanz statt eines Handrolls der
  // Validierungslogik. clubs/athletes/mailer erreicht acceptInvitation()
  // selbst nicht (nur findValidByToken()/markUsed()), bekommen aber der
  // Vollständigkeit halber echte In-Memory-Implementierungen.
  const clubs = new InMemoryClubRepository();
  const invitationsService = createInvitationsService({
    clubs,
    invitations,
    athletes: new InMemoryAthleteRepository(),
    users,
    mailer: new InMemoryMailSender(),
    frontendBaseUrl: 'https://app.example.org',
    clubInvitationTtlDays: 14,
    memberInvitationTtlDays: 7,
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const profileDb: any = { users: [], athletes: [], results: [], entries: [], actionItems: [], sessions: [] };
  const profileGateway = new InMemoryProfileDataGateway(profileDb);
  const keyPair = generateFreshKeyPair();
  // Sicherheitsreview 2026-08, Befund M5 — eigene, aus makeService()
  // herausgereichte Instanzen (statt inline wie beim invitationsService
  // oben), damit die Tests zu requestPasswordReset()/resetPassword()
  // unten direkt gegen sie prüfen können (mailer.sentPasswordResetEmails,
  // passwordResetTokens.findByHash()).
  const passwordResetTokens = new InMemoryPasswordResetTokenRepository();
  const mailer = new InMemoryMailSender();
  const service = createAuthService({
    users, refreshTokens, invitations: invitationsService, profileGateway, clubs, dataErasureRetentionDays: 30,
    passwordResetTokens, mailer, frontendBaseUrl: 'https://app.example.org', passwordResetTtlMinutes: 60,
    keyPair, accessTtlSeconds: 900, refreshTtlDays: 30,
  });
  return { service, users, refreshTokens, invitations, clubs, keyPair, profileDb, passwordResetTokens, mailer };
}

// Erzeugt eine gültige Trainer-Einladung und liefert das Klartext-Token,
// das anschließend an service.acceptInvitation() übergeben werden kann —
// steht stellvertretend für das, was invitations.service.ts in der Praxis
// ausstellt (siehe invitations.service.test.ts für dessen eigene Tests).
async function seedInvitation(
  invitations: InMemoryInvitationRepository,
  overrides: Partial<{ email: string; role: string; clubId: string | null; expiresAt: Date; usedAt: Date | null; revokedAt: Date | null }> = {},
) {
  const { plainToken, tokenHash, expiresAt } = generateInvitationToken(7);
  const clubId = 'clubId' in overrides ? overrides.clubId! : CLUB_ID;
  await invitations.create({
    tokenHash,
    email: overrides.email ?? 'sabine.reuter@example.org',
    role: overrides.role ?? 'trainer',
    clubId,
    athleteId: null,
    invitedById: INVITER_ID,
    expiresAt: overrides.expiresAt ?? expiresAt,
  });
  return plainToken;
}

describe('authService.acceptInvitation', () => {
  it('legt bei gültiger Einladung einen neuen Nutzer mit deren Rolle/Verein an', async () => {
    const { service, invitations, keyPair } = makeService();
    const token = await seedInvitation(invitations, { role: 'trainer', clubId: CLUB_ID });

    const result = await service.acceptInvitation({ token, name: 'Sabine Reuter', password: 'ein-sicheres-passwort', consent: true });

    expect(result.user.email).toBe('sabine.reuter@example.org');
    expect(result.user.roles).toEqual(['trainer']);
    expect(result.user.clubId).toBe(CLUB_ID);
    expect(result.user).not.toHaveProperty('passwordHash');

    const claims = await verifyAccessToken(result.accessToken, keyPair);
    expect(claims.roles).toEqual(['trainer']);
    expect(claims.clubId).toBe(CLUB_ID);
  });

  it('übernimmt E-Mail/Rolle/Verein IMMER aus der Einladung, niemals aus dem Client-Body', async () => {
    const { service, invitations } = makeService();
    const token = await seedInvitation(invitations, { role: 'admin', clubId: CLUB_ID });

    // Selbst wenn ein manipulierter Client versuchen würde, zusätzliche
    // Felder mitzuschicken, kennt AcceptInvitationRequest gar keine
    // role/clubId/email-Felder (siehe shared-types) — hier wird nur
    // geprüft, dass die tatsächlich vergebene Rolle aus der Einladung stammt.
    const result = await service.acceptInvitation({ token, name: 'Neue Admin', password: 'ein-sicheres-passwort', consent: true });
    expect(result.user.roles).toEqual(['admin']);
  });

  it('markiert die Einladung nach Verwendung als verbraucht (kein zweites Einlösen möglich)', async () => {
    const { service, invitations } = makeService();
    const token = await seedInvitation(invitations);
    await service.acceptInvitation({ token, name: 'X', password: 'ein-sicheres-passwort', consent: true });

    await expect(service.acceptInvitation({ token, name: 'Y', password: 'ein-anderes-passwort', consent: true })).rejects.toThrow(
      InvalidInvitationError,
    );
  });

  it('lehnt ein unbekanntes/erfundenes Einladungs-Token ab', async () => {
    const { service } = makeService();
    await expect(
      service.acceptInvitation({ token: 'kein-echtes-token', name: 'X', password: 'ein-sicheres-passwort', consent: true }),
    ).rejects.toThrow(InvalidInvitationError);
  });

  it('lehnt eine abgelaufene Einladung ab', async () => {
    const { service, invitations } = makeService();
    const token = await seedInvitation(invitations, { expiresAt: new Date(Date.now() - 1000) });
    await expect(service.acceptInvitation({ token, name: 'X', password: 'ein-sicheres-passwort', consent: true })).rejects.toThrow(
      InvalidInvitationError,
    );
  });

  it('lehnt eine widerrufene Einladung ab', async () => {
    const { service, invitations } = makeService();
    const { plainToken, tokenHash, expiresAt } = generateInvitationToken(7);
    const invitation = await invitations.create({
      tokenHash,
      email: 'x@y.de',
      role: 'trainer',
      clubId: CLUB_ID,
      athleteId: null,
      invitedById: INVITER_ID,
      expiresAt,
    });
    await invitations.revoke(invitation.id);
    await expect(
      service.acceptInvitation({ token: plainToken, name: 'X', password: 'ein-sicheres-passwort', consent: true }),
    ).rejects.toThrow(InvalidInvitationError);
  });

  it('lehnt ab, wenn die E-Mail der Einladung bereits ein Konto hat', async () => {
    const { service, invitations } = makeService();
    const tokenA = await seedInvitation(invitations, { email: 'doppel@example.org' });
    await service.acceptInvitation({ token: tokenA, name: 'Erste Person', password: 'ein-sicheres-passwort', consent: true });

    const tokenB = await seedInvitation(invitations, { email: 'doppel@example.org' });
    await expect(
      service.acceptInvitation({ token: tokenB, name: 'Zweite Person', password: 'ein-anderes-passwort', consent: true }),
    ).rejects.toThrow(EmailAlreadyRegisteredError);
  });

  it('speichert das Passwort niemals im Klartext', async () => {
    const { service, invitations, users } = makeService();
    const token = await seedInvitation(invitations);
    const result = await service.acceptInvitation({ token, name: 'X', password: 'ein-sicheres-passwort', consent: true });
    const stored = await users.findById(result.user.id);
    expect(stored?.passwordHash).not.toBe('ein-sicheres-passwort');
  });

  it('unterstützt clubId: null (z. B. bei einer — hier nur zu Testzwecken erzeugten — Einladung ohne Verein)', async () => {
    const { service, invitations } = makeService();
    const token = await seedInvitation(invitations, { role: 'trainer', clubId: null });
    const result = await service.acceptInvitation({ token, name: 'X', password: 'ein-sicheres-passwort', consent: true });
    expect(result.user.clubId).toBeNull();
  });
});

async function registerViaInvitation(
  service: ReturnType<typeof makeService>['service'],
  invitations: InMemoryInvitationRepository,
  overrides: Partial<{ email: string; role: string; clubId: string | null }> = {},
) {
  const token = await seedInvitation(invitations, overrides);
  return service.acceptInvitation({ token, name: 'Test Person', password: 'ein-sicheres-passwort', consent: true });
}

describe('authService.login', () => {
  it('meldet mit korrekten Zugangsdaten erfolgreich an', async () => {
    const { service, invitations } = makeService();
    await registerViaInvitation(service, invitations, { email: 'sabine.reuter@example.org' });
    const result = await service.login({ email: 'sabine.reuter@example.org', password: 'ein-sicheres-passwort', consent: true, consentVersion: CURRENT_CONSENT_VERSION });
    expect(result.user.email).toBe('sabine.reuter@example.org');
  });

  it('lehnt ein falsches Passwort ab', async () => {
    const { service, invitations } = makeService();
    await registerViaInvitation(service, invitations, { email: 'sabine.reuter@example.org' });
    await expect(
      service.login({ email: 'sabine.reuter@example.org', password: 'falsches-passwort', consent: true, consentVersion: CURRENT_CONSENT_VERSION }),
    ).rejects.toThrow(InvalidCredentialsError);
  });

  it('lehnt eine unbekannte E-Mail-Adresse ab, mit derselben Fehlermeldung wie ein falsches Passwort', async () => {
    const { service, invitations } = makeService();
    await registerViaInvitation(service, invitations, { email: 'sabine.reuter@example.org' });

    let unknownEmailMessage = '';
    let wrongPasswordMessage = '';
    try {
      await service.login({ email: 'unbekannt@example.org', password: 'irgendwas', consent: true, consentVersion: CURRENT_CONSENT_VERSION });
    } catch (err) {
      unknownEmailMessage = (err as Error).message;
    }
    try {
      await service.login({ email: 'sabine.reuter@example.org', password: 'falsch', consent: true, consentVersion: CURRENT_CONSENT_VERSION });
    } catch (err) {
      wrongPasswordMessage = (err as Error).message;
    }
    expect(unknownEmailMessage).toBe(wrongPasswordMessage);
    expect(unknownEmailMessage).not.toBe('');
  });

  // Sicherheitskorrektur (Code-Review): vormals kehrte login() bei einer
  // unbekannten E-Mail-Adresse SOFORT zurück, ohne den teuren
  // argon2id-Passwortvergleich zu durchlaufen — ein klar messbarer
  // Zeitunterschied zu einem bekannten Konto (falsches Passwort), der den
  // oben getesteten generischen Fehlertext per Timing-Seitenkanal
  // trotzdem aushebeln konnte (User-Enumeration).
  it('lässt bei einer unbekannten E-Mail-Adresse denselben teuren Passwort-Vergleich durchlaufen (Timing-Sicherheit)', async () => {
    const { service, invitations } = makeService();
    await registerViaInvitation(service, invitations, { email: 'sabine.reuter@example.org' });

    const start = Date.now();
    await service.login({ email: 'unbekannt@example.org', password: 'irgendwas', consent: true, consentVersion: CURRENT_CONSENT_VERSION }).catch(() => {});
    const elapsedMs = Date.now() - start;

    // argon2id mit den hier konfigurierten Kostenparametern (64 MiB
    // Speicher, 3 Iterationen, siehe auth/password.ts) braucht auf jeder
    // realistischen Maschine deutlich mehr als wenige Millisekunden — ein
    // sofortiges Zurückkehren (die vormalige, unsichere Implementierung)
    // läge weit darunter.
    expect(elapsedMs).toBeGreaterThan(15);
  });

  // Regressionstests für Review 30.08.2026, Befund S1: login() stempelte
  // bislang JEDEN Login bedingungslos auf CURRENT_CONSENT_VERSION — auch
  // wenn die Person diese Fassung nie gesehen hatte, und auch dann, wenn
  // sich gegenüber dem gespeicherten Stand gar nichts geändert hatte.
  describe('Einwilligungsnachweis (Befund S1)', () => {
    it('lehnt einen Login ab, der eine andere als die aktuelle Fassung bestätigt (LoginRequestSchema)', () => {
      // Die Ablehnung sitzt bereits im Schema (z.literal(CURRENT_CONSENT_VERSION),
      // siehe packages/shared-types/test/auth.test.ts) — service.login() selbst
      // bekommt eine falsche Version nie zu Gesicht. Dieser Test hält die
      // Prämisse des Service-Tests unten fest: input.consentVersion ist zum
      // Zeitpunkt, an dem login() sie liest, bereits garantiert aktuell.
      const parsed = LoginRequestSchema.safeParse({
        email: 'a@b.de',
        password: 'x',
        consent: true,
        consentVersion: '2020-01-01',
      });
      expect(parsed.success).toBe(false);
    });

    it('hebt eine veraltete gespeicherte consentVersion beim nächsten Login auf den aktuellen Stand', async () => {
      const { service, users, invitations } = makeService();
      const { user: registeredUser } = await registerViaInvitation(service, invitations, { email: 'alte-fassung@example.org' });
      // Simuliert ein Konto, dessen letzte Zustimmung einer älteren Fassung
      // der Datenschutzerklärung galt (z. B. vor einer Anhebung von
      // CURRENT_CONSENT_VERSION registriert).
      await users.update(registeredUser.id, { consentVersion: '2020-01-01' });

      const result = await service.login({
        email: 'alte-fassung@example.org',
        password: 'ein-sicheres-passwort',
        consent: true,
        consentVersion: CURRENT_CONSENT_VERSION,
      });

      expect(result.user.consentVersion).toBe(CURRENT_CONSENT_VERSION);
    });

    it('schreibt bei bereits aktueller consentVersion nichts erneut (kein Datenbankzugriff, consentGivenAt bleibt unverändert)', async () => {
      const { service, users, invitations } = makeService();
      const { user: registeredUser } = await registerViaInvitation(service, invitations, { email: 'aktuell@example.org' });

      const updateSpy = vi.spyOn(users, 'update');
      const result = await service.login({
        email: 'aktuell@example.org',
        password: 'ein-sicheres-passwort',
        consent: true,
        consentVersion: CURRENT_CONSENT_VERSION,
      });

      expect(updateSpy).not.toHaveBeenCalled();
      expect(result.user.consentGivenAt).toEqual(registeredUser.consentGivenAt);
    });
  });
});

describe('authService.refresh', () => {
  it('stellt bei gültigem Refresh Token neue Tokens aus', async () => {
    const { service, invitations } = makeService();
    const { refreshToken } = await registerViaInvitation(service, invitations);
    const result = await service.refresh(refreshToken);
    expect(result.accessToken).toBeTruthy();
    expect(result.refreshToken).toBeTruthy();
  });

  it('rotiert das Refresh Token: das alte Token ist nach Benutzung ungültig', async () => {
    const { service, invitations } = makeService();
    const { refreshToken } = await registerViaInvitation(service, invitations);
    await service.refresh(refreshToken);
    await expect(service.refresh(refreshToken)).rejects.toThrow(InvalidRefreshTokenError);
  });

  it('das neue Refresh Token aus refresh() funktioniert für den nächsten Refresh', async () => {
    const { service, invitations } = makeService();
    const first = await registerViaInvitation(service, invitations);
    const second = await service.refresh(first.refreshToken);
    const third = await service.refresh(second.refreshToken);
    expect(third.accessToken).toBeTruthy();
  });

  it('lehnt ein unbekanntes/erfundenes Refresh Token ab', async () => {
    const { service } = makeService();
    await expect(service.refresh('kein-echtes-token')).rejects.toThrow(InvalidRefreshTokenError);
  });

  // Regressionstest für Befund S2 (Code-Review): die Wiederverwendung
  // eines bereits ROTIERTEN Refresh Tokens ist das einzige verlässliche
  // Signal für einen Token-Diebstahl (siehe Kommentar in auth.service.ts:
  // refresh()). Ein solcher Versuch muss daher ALLE Sitzungen des Kontos
  // widerrufen — nicht nur den einen Wiederverwendungsversuch ablehnen —,
  // sonst behielte ein Angreifer, der ein gestohlenes Token zuerst einlöst,
  // über die Rotationskette dauerhaften Zugriff, während das rechtmäßige
  // Gerät irgendwann scheinbar grundlos ausgeloggt wird.
  it('widerruft bei Wiederverwendung eines bereits rotierten Refresh Tokens ALLE Sitzungen des Kontos (Reuse-Detection)', async () => {
    const { service, invitations } = makeService();
    const first = await registerViaInvitation(service, invitations);
    // Legitime Rotation: das neue Token (second.refreshToken) ist an
    // dieser Stelle gültig und noch nicht benutzt.
    const second = await service.refresh(first.refreshToken);

    // Ein Angreifer (oder ein Client-Bug ohne Single-Flight-Bündelung,
    // siehe apiClient.js: Befund S4) verwendet das bereits rotierte,
    // ALTE Token erneut.
    await expect(service.refresh(first.refreshToken)).rejects.toThrow(InvalidRefreshTokenError);

    // Das eigentlich noch gültige, NEUE Token muss durch die
    // Reuse-Detection ebenfalls widerrufen worden sein — nicht nur der
    // Wiederverwendungsversuch selbst wurde abgelehnt.
    await expect(service.refresh(second.refreshToken)).rejects.toThrow(InvalidRefreshTokenError);
  });
});

describe('authService.logout', () => {
  it('invalidiert das Refresh Token, sodass ein nachfolgender Refresh fehlschlägt', async () => {
    const { service, invitations } = makeService();
    const { refreshToken } = await registerViaInvitation(service, invitations);
    await service.logout(refreshToken);
    await expect(service.refresh(refreshToken)).rejects.toThrow(InvalidRefreshTokenError);
  });

  it('ist idempotent — ein zweiter Logout mit demselben (bereits ungültigen) Token wirft nicht', async () => {
    const { service, invitations } = makeService();
    const { refreshToken } = await registerViaInvitation(service, invitations);
    await service.logout(refreshToken);
    await expect(service.logout(refreshToken)).resolves.not.toThrow();
  });
});

describe('authService.getMe / updateMe', () => {
  it('liefert das öffentliche Profil ohne Passwort-Hash', async () => {
    const { service, invitations } = makeService();
    const { user } = await registerViaInvitation(service, invitations, { email: 'sabine.reuter@example.org' });
    const me = await service.getMe(user.id);
    expect(me.email).toBe('sabine.reuter@example.org');
    expect(me).not.toHaveProperty('passwordHash');
  });

  it('aktualisiert den Namen erfolgreich', async () => {
    const { service, invitations } = makeService();
    const { user } = await registerViaInvitation(service, invitations);
    const updated = await service.updateMe(user.id, { name: 'Neuer Name' });
    expect(updated.name).toBe('Neuer Name');
  });

  // Regressionstest für den DSV7/Lenex-Ergebnisimport (siehe
  // docs/dsv7-lenex-import-plan.md Abschnitt 3.1): getMe() muss die
  // externe Vereinskennung mitliefern, damit
  // apps/web/js/modules/resultsImportUI.js den eigenen Verein automatisch
  // gegen eine Importdatei abgleichen kann.
  it('liefert die Vereinskennung (clubNationalID/clubNationalIDType) mit, sobald hinterlegt', async () => {
    const { service, invitations, clubs } = makeService();
    const club = await clubs.create({ name: 'SC Beispielverein' });
    const token = await seedInvitation(invitations, { clubId: club.id });
    const { user } = await service.acceptInvitation({ token, name: 'Sabine Reuter', password: 'ein-sicheres-passwort', consent: true });

    // Ohne hinterlegte Kennung: beide Felder null, kein Fehler.
    const meBefore = await service.getMe(user.id);
    expect(meBefore.clubNationalID).toBeNull();
    expect(meBefore.clubNationalIDType).toBeNull();

    await clubs.updateIdentity(club.id, { nationalID: '1234', nationalIDType: 'DSV' });

    const meAfter = await service.getMe(user.id);
    expect(meAfter.clubNationalID).toBe('1234');
    expect(meAfter.clubNationalIDType).toBe('DSV');

    // Auch über login()/acceptInvitation() (dieselbe resolveClubContext()-
    // Stelle) — nicht nur getMe().
    const loginResult = await service.login({ email: 'sabine.reuter@example.org', password: 'ein-sicheres-passwort', consent: true, consentVersion: CURRENT_CONSENT_VERSION });
    expect(loginResult.clubNationalID).toBe('1234');
    expect(loginResult.clubNationalIDType).toBe('DSV');
  });

  // Code-Review 2026-09-02, Befund R1: getMe()/login() luden vormals über
  // zwei getrennte Funktionen (resolveEnabledModules()/resolveClubIdentity())
  // JEDE für sich denselben Club-Datensatz — zwei sequentiell awaitete
  // clubs.findById()-Aufrufe pro Antwort statt eines einzigen. Dieser Test
  // hält die Behebung (resolveClubContext(), EIN gemeinsamer Lookup) über
  // einen Spy auf clubs.findById() fest, statt sich nur auf die
  // zurückgegebenen Werte zu verlassen (die wären mit zwei Aufrufen
  // identisch geblieben — der Regressionstest oben hätte diesen Befund
  // nicht erkannt).
  it('lädt den Club-Datensatz für enabledModules UND die Vereinskennung nur EINMAL je Antwort', async () => {
    const { service, invitations, clubs } = makeService();
    const club = await clubs.create({ name: 'SC Beispielverein', enabledModules: ['athletes'] });
    await clubs.updateIdentity(club.id, { nationalID: '1234', nationalIDType: 'DSV' });
    const token = await seedInvitation(invitations, { clubId: club.id });
    const { user } = await service.acceptInvitation({ token, name: 'Sabine Reuter', password: 'ein-sicheres-passwort', consent: true });

    const findByIdSpy = vi.spyOn(clubs, 'findById');

    findByIdSpy.mockClear();
    const me = await service.getMe(user.id);
    expect(me.enabledModules).toEqual(['athletes']);
    expect(me.clubNationalID).toBe('1234');
    expect(findByIdSpy).toHaveBeenCalledTimes(1);

    findByIdSpy.mockClear();
    const loginResult = await service.login({ email: 'sabine.reuter@example.org', password: 'ein-sicheres-passwort', consent: true, consentVersion: CURRENT_CONSENT_VERSION });
    expect(loginResult.enabledModules).toEqual(['athletes']);
    expect(loginResult.clubNationalID).toBe('1234');
    expect(findByIdSpy).toHaveBeenCalledTimes(1);
  });

  // Sicherheitsreview 2026-08-27, Befund H2: `email` ist bewusst KEIN Feld
  // von updateMe() mehr — der Typ von `patch` erzwingt das bereits zur
  // Kompilierzeit für jeden Aufrufer innerhalb dieses Moduls. Die
  // eigentliche Laufzeit-Absicherung gegen ein von einem manipulierten
  // Client mitgeschicktes "email"-Feld sitzt eine Ebene höher, an der
  // Zod/parseInput()-Grenze (siehe packages/shared-types/test/auth.test.ts:
  // „entfernt ein mitgeschicktes 'email'-Feld …") bzw. end-to-end im
  // Routentest „PATCH /api/me ignoriert ein mitgeschicktes 'email'-Feld"
  // (auth.route.test.ts) — beide prüfen den tatsächlich erreichbaren
  // Angriffspfad, ein weiterer Test auf dieser Service-Ebene wäre
  // redundant. Siehe authService.changeEmail() weiter unten für den
  // neuen, per aktuellem Passwort abgesicherten Endpunkt.

  // Regressionstest für Befund S5 (Code-Review): UserRepository.update()
  // filterte bislang — anders als findById()/findByEmail() — NICHT auf
  // `deletedAt: null`. In der Praxis rufen login()/updateMe() update() nur
  // nach einem bereits aktiv-gescopten findById()/findByEmail() auf,
  // weshalb der Fall über den Service-Aufrufpfad nicht beobachtbar ist —
  // dieser Test prüft daher das Repository direkt (Vertrag: identisch zu
  // PrismaUserRepository.update(), siehe dessen Integrationstest-Pendant).
  it('UserRepository.update() lehnt ein bereits soft-gelöschtes Konto ab, statt es stillschweigend zu aktualisieren (Befund S5)', async () => {
    const { users, invitations, service } = makeService();
    const { user } = await registerViaInvitation(service, invitations, { email: 'wird-geloescht@example.org' });

    // Simuliert den Soft-Delete-Schritt von requestErasure() (Art. 17
    // DSGVO) — in Produktion via direktem Prisma-Zugriff in
    // profile.repository.ts, hier über dieselbe update()-Methode, deren
    // eigenes Verhalten geprüft wird (an dieser Stelle noch aktiv, greift
    // also normal).
    await users.update(user.id, { deletedAt: new Date() });

    await expect(users.update(user.id, { name: 'Sollte nicht ankommen' })).rejects.toMatchObject({ code: 'P2025' });
  });
});

describe('authService.exportMyData / requestAccountDeletion', () => {
  // Hinweis: InMemoryUserRepository (Login/Registrierung) und
  // InMemoryProfileDataGateway (Export/Löschung) sind in den Tests bewusst
  // getrennte In-Memory-Stores — in der echten Prisma-Implementierung
  // greifen beide auf dieselbe "users"-Tabelle zu, hier muss der
  // profileDb-Eintrag daher manuell nachgezogen werden, um denselben
  // Zustand zu simulieren.
  it('exportMyData() liefert das eigene Profil ohne Passwort-Hash', async () => {
    const { service, invitations, profileDb } = makeService();
    const { user } = await registerViaInvitation(service, invitations, { email: 'export@example.org' });
    profileDb.users.push({ id: user.id, clubId: CLUB_ID, athleteId: null, deletedAt: null, name: user.name, email: user.email });

    const result = await service.exportMyData(user.id);
    expect(result.user.email).toBe('export@example.org');
    expect(result.format).toBe('lane1-user-data-export-v1');
  });

  it('requestAccountDeletion() widerruft alle Refresh Tokens des Kontos', async () => {
    const { service, invitations, profileDb } = makeService();
    const { user, refreshToken } = await registerViaInvitation(service, invitations, { email: 'delete@example.org' });
    profileDb.users.push({ id: user.id, clubId: CLUB_ID, athleteId: null, deletedAt: null, name: user.name, email: user.email });

    await service.requestAccountDeletion(user.id);

    // Das Refresh Token, das bei der Registrierung ausgestellt wurde, ist
    // jetzt widerrufen — ein Refresh damit muss fehlschlagen.
    await expect(service.refresh(refreshToken)).rejects.toThrow(InvalidRefreshTokenError);
  });

  it('requestAccountDeletion() liefert das Datum des geplanten endgültigen Löschens (purgeAfter)', async () => {
    const { service, invitations, profileDb } = makeService();
    const { user } = await registerViaInvitation(service, invitations, { email: 'delete2@example.org' });
    profileDb.users.push({ id: user.id, clubId: CLUB_ID, athleteId: null, deletedAt: null, name: user.name, email: user.email });

    const before = Date.now();
    const result = await service.requestAccountDeletion(user.id);
    const expectedMs = before + 30 * 24 * 60 * 60 * 1000; // dataErasureRetentionDays: 30 in makeService()
    expect(Math.abs(result.purgeAfter.getTime() - expectedMs)).toBeLessThan(5000);
  });
});

// Sicherheitsreview 2026-08, Befund M5 ("Passwort vergessen").
describe('authService.requestPasswordReset', () => {
  it('legt für eine bekannte E-Mail-Adresse ein Reset-Token an und versendet eine E-Mail', async () => {
    const { service, invitations, passwordResetTokens, mailer } = makeService();
    const { user } = await registerViaInvitation(service, invitations, { email: 'vergessen@example.org' });

    await service.requestPasswordReset('vergessen@example.org');

    expect(mailer.sentPasswordResetEmails).toHaveLength(1);
    expect(mailer.sentPasswordResetEmails[0]).toMatchObject({ to: 'vergessen@example.org' });
    // Das Token im versendeten Link muss tatsächlich gegen das Repository
    // auflösbar sein (nicht nur irgendein String).
    const url = mailer.sentPasswordResetEmails[0]!.resetUrl;
    const token = url.split('/reset-password/')[1];
    expect(token).toBeTruthy();
    const { hashPasswordResetToken } = await import('../../src/auth/tokens.js');
    const stored = await passwordResetTokens.findByHash(hashPasswordResetToken(token!));
    expect(stored?.userId).toBe(user.id);
  });

  // Sicherheitsregression: verhindert User-Enumeration — kein Fehler, keine
  // erkennbar unterschiedliche Antwort für eine unbekannte E-Mail-Adresse.
  it('wirft KEINEN Fehler für eine unbekannte E-Mail-Adresse und versendet keine E-Mail', async () => {
    const { service, mailer } = makeService();
    await expect(service.requestPasswordReset('unbekannt@example.org')).resolves.toBeUndefined();
    expect(mailer.sentPasswordResetEmails).toHaveLength(0);
  });

  it('versendet keine E-Mail für ein bereits soft-gelöschtes Konto (findByEmail liefert nie gelöschte Konten)', async () => {
    const { service, invitations, users, mailer } = makeService();
    const { user } = await registerViaInvitation(service, invitations, { email: 'geloescht@example.org' });
    await users.update(user.id, { deletedAt: new Date() });

    await service.requestPasswordReset('geloescht@example.org');
    expect(mailer.sentPasswordResetEmails).toHaveLength(0);
  });

  // Regressionstest für Review 30.08.2026, Befund S3: der Schreibvorgang
  // in passwordResetTokens (nicht spiegelbar für den Nicht-Treffer-Fall,
  // siehe dortiger Kommentar) darf die Antwort nicht verzögern — genau wie
  // der bereits fire-and-forget behandelte Mailversand. Ein NIE
  // auflösendes create() darf requestPasswordReset() deshalb nicht
  // blockieren.
  it('wartet NICHT auf das Schreiben des Reset-Tokens, bevor es zurückkehrt (Zeitangleichung an den Nicht-Treffer-Pfad)', async () => {
    const { service, invitations, passwordResetTokens } = makeService();
    await registerViaInvitation(service, invitations, { email: 'zeitangleichung@example.org' });

    let releaseCreate: ((record: PasswordResetTokenRecord) => void) | undefined;
    const pendingCreate = new Promise<PasswordResetTokenRecord>((resolve) => {
      releaseCreate = resolve;
    });
    const createSpy = vi.spyOn(passwordResetTokens, 'create').mockReturnValue(pendingCreate);

    // Löst requestPasswordReset() NICHT auf, solange create() aussteht —
    // vor diesem Fix hätte das `create()` awaitet und der Test wäre nie
    // fertig geworden (Timeout).
    await expect(service.requestPasswordReset('zeitangleichung@example.org')).resolves.toBeUndefined();
    expect(createSpy).toHaveBeenCalledOnce();

    // Aufräumen: das ausstehende Promise nicht offen lassen.
    releaseCreate!({ id: 'x', userId: 'x', tokenHash: 'x', expiresAt: new Date(), usedAt: null, createdAt: new Date() });
    await pendingCreate;
  });

  // Code-Review 2026-09-02, Befund P1: Mailversand und Token-Schreibvorgang
  // liefen vormals PARALLEL und unabhängig voneinander (zwei getrennte
  // fire-and-forget-Ketten) — schlug NUR der Schreibvorgang fehl, ging die
  // Mail mit einem Link trotzdem hinaus, dessen Token nie gespeichert
  // wurde. Diese Person hätte beim Klick InvalidOrExpiredResetTokenError
  // gesehen, obwohl nichts davon zutraf.
  it('versendet KEINE E-Mail, wenn das Speichern des Reset-Tokens fehlschlägt', async () => {
    const { service, invitations, passwordResetTokens, mailer } = makeService();
    await registerViaInvitation(service, invitations, { email: 'schreibfehler@example.org' });

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(passwordResetTokens, 'create').mockRejectedValue(new Error('DB kurzzeitig nicht erreichbar'));

    // Der Fehlschlag darf weder nach außen geworfen werden (siehe Befund
    // S3: die generische Antwort bleibt für Treffer/Nicht-Treffer/Fehler
    // identisch) ...
    await expect(service.requestPasswordReset('schreibfehler@example.org')).resolves.toBeUndefined();
    // ... noch die Zeitangleichung verzögern (fire-and-forget, siehe Test
    // oben) — das await oben genügt hier bereits als Beleg.

    // Kurz auf den (bewusst nicht awaiteten) Rejection-Handler warten,
    // bevor die Abwesenheit der Mail geprüft wird.
    await new Promise((resolve) => setImmediate(resolve));

    expect(mailer.sentPasswordResetEmails).toHaveLength(0);
    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });
});

describe('authService.resetPassword', () => {
  async function requestAndExtractToken(
    service: ReturnType<typeof makeService>['service'],
    mailer: ReturnType<typeof makeService>['mailer'],
    email: string,
  ) {
    await service.requestPasswordReset(email);
    const url = mailer.sentPasswordResetEmails.at(-1)!.resetUrl;
    return url.split('/reset-password/')[1]!;
  }

  it('setzt bei gültigem Token ein neues Passwort und meldet die Person direkt an', async () => {
    const { service, invitations, mailer } = makeService();
    await registerViaInvitation(service, invitations, { email: 'reset@example.org' });
    const token = await requestAndExtractToken(service, mailer, 'reset@example.org');

    const result = await service.resetPassword(token, 'ein-neues-passwort');
    expect(result.user.email).toBe('reset@example.org');
    expect(result.accessToken).toBeTruthy();
    expect(result.refreshToken).toBeTruthy();

    // Das neue Passwort funktioniert, das alte nicht mehr.
    await expect(service.login({ email: 'reset@example.org', password: 'ein-neues-passwort', consent: true, consentVersion: CURRENT_CONSENT_VERSION })).resolves.toBeTruthy();
    await expect(
      service.login({ email: 'reset@example.org', password: 'ein-sicheres-passwort', consent: true, consentVersion: CURRENT_CONSENT_VERSION }),
    ).rejects.toThrow(InvalidCredentialsError);
  });

  it('widerruft alle bestehenden Sitzungen (Refresh Tokens) beim Zurücksetzen', async () => {
    const { service, invitations, mailer } = makeService();
    const { refreshToken: oldRefreshToken } = await registerViaInvitation(service, invitations, { email: 'reset2@example.org' });
    const token = await requestAndExtractToken(service, mailer, 'reset2@example.org');

    await service.resetPassword(token, 'ein-neues-passwort');

    await expect(service.refresh(oldRefreshToken)).rejects.toThrow(InvalidRefreshTokenError);
  });

  it('lehnt ein unbekanntes/erfundenes Token ab', async () => {
    const { service } = makeService();
    await expect(service.resetPassword('kein-echtes-token', 'ein-neues-passwort')).rejects.toThrow(InvalidOrExpiredResetTokenError);
  });

  it('lehnt ein bereits verwendetes Token ab (kein zweites Einlösen)', async () => {
    const { service, invitations, mailer } = makeService();
    await registerViaInvitation(service, invitations, { email: 'reset3@example.org' });
    const token = await requestAndExtractToken(service, mailer, 'reset3@example.org');

    await service.resetPassword(token, 'ein-neues-passwort');
    await expect(service.resetPassword(token, 'noch-ein-passwort')).rejects.toThrow(InvalidOrExpiredResetTokenError);
  });

  it('lehnt ein abgelaufenes Token ab', async () => {
    const { service, users, passwordResetTokens } = makeService();
    const user = await users.create({
      clubId: CLUB_ID, name: 'Test Person', email: 'abgelaufen@example.org', passwordHash: 'irrelevant',
      roles: ['trainer'], consentGivenAt: new Date(), consentVersion: '2026-07-15',
    });
    const { hashPasswordResetToken } = await import('../../src/auth/tokens.js');
    const plainToken = 'abgelaufenes-test-token';
    await passwordResetTokens.create(user.id, hashPasswordResetToken(plainToken), new Date(Date.now() - 1000));

    await expect(service.resetPassword(plainToken, 'ein-neues-passwort')).rejects.toThrow(InvalidOrExpiredResetTokenError);
  });

  // Regressionstest für Sicherheitsreview 2026-08-27, Befund N4:
  // markUsed(existing.id) allein invalidierte zuvor nur GENAU das
  // eingelöste Token — ein zweiter, innerhalb der TTL angeforderter
  // Reset-Link desselben Kontos blieb bis zu seinem eigenen Ablauf
  // gültig, obwohl das Passwort bereits über den ersten Link geändert
  // wurde.
  it('invalidiert beim Einlösen ZUSÄTZLICH jeden ANDEREN, noch offenen Reset-Link desselben Kontos', async () => {
    const { service, invitations, mailer } = makeService();
    await registerViaInvitation(service, invitations, { email: 'zwei-links@example.org' });

    const firstToken = await requestAndExtractToken(service, mailer, 'zwei-links@example.org');
    const secondToken = await requestAndExtractToken(service, mailer, 'zwei-links@example.org');

    // Der ERSTE (ältere) Link wird eingelöst — der ZWEITE, bislang noch
    // ungenutzte Link darf danach nicht mehr funktionieren.
    await service.resetPassword(firstToken, 'ein-neues-passwort');
    await expect(service.resetPassword(secondToken, 'noch-ein-anderes-passwort')).rejects.toThrow(InvalidOrExpiredResetTokenError);
  });
});

describe('authService.changePassword', () => {
  it('ändert bei korrektem aktuellem Passwort das Passwort und liefert ein frisches Token-Paar', async () => {
    const { service, invitations } = makeService();
    const { user } = await registerViaInvitation(service, invitations, { email: 'change@example.org' });

    const result = await service.changePassword(user.id, 'ein-sicheres-passwort', 'ein-noch-sichereres-passwort');
    expect(result.user.email).toBe('change@example.org');
    expect(result.accessToken).toBeTruthy();

    await expect(
      service.login({ email: 'change@example.org', password: 'ein-noch-sichereres-passwort', consent: true, consentVersion: CURRENT_CONSENT_VERSION }),
    ).resolves.toBeTruthy();
    await expect(
      service.login({ email: 'change@example.org', password: 'ein-sicheres-passwort', consent: true, consentVersion: CURRENT_CONSENT_VERSION }),
    ).rejects.toThrow(InvalidCredentialsError);
  });

  it('lehnt ein falsches aktuelles Passwort ab, ohne das gespeicherte Passwort zu ändern', async () => {
    const { service, invitations } = makeService();
    const { user } = await registerViaInvitation(service, invitations, { email: 'change2@example.org' });

    await expect(service.changePassword(user.id, 'falsches-passwort', 'ein-neues-passwort')).rejects.toThrow(InvalidCurrentPasswordError);

    // Login mit dem UNVERÄNDERTEN, ursprünglichen Passwort funktioniert weiterhin.
    await expect(
      service.login({ email: 'change2@example.org', password: 'ein-sicheres-passwort', consent: true, consentVersion: CURRENT_CONSENT_VERSION }),
    ).resolves.toBeTruthy();
  });

  // Sicherheitsmaßnahme: verhindert, dass ein kurzzeitig entwendeter Access
  // Token allein (ohne Kenntnis des aktuellen Passworts) zur dauerhaften
  // Kontoübernahme per Passwortwechsel reicht.
  it('widerruft ANDERE Sitzungen, stellt aber sofort ein NEUES gültiges Token-Paar für die aktuelle Sitzung aus', async () => {
    const { service, invitations } = makeService();
    const { user, refreshToken: oldRefreshToken } = await registerViaInvitation(service, invitations, { email: 'change3@example.org' });

    const result = await service.changePassword(user.id, 'ein-sicheres-passwort', 'ein-neues-passwort');

    // Das NEU ausgestellte Refresh Token funktioniert direkt (VOR dem
    // folgenden Check unten geprüft — dessen Reuse-Detection widerruft
    // anschließend absichtlich ALLE Sitzungen, siehe nächster Kommentar).
    await expect(service.refresh(result.refreshToken)).resolves.toBeTruthy();

    // Das ALTE, bereits vor dem Passwortwechsel widerrufene Refresh Token
    // schlägt fehl — und löst dabei (by design, siehe refresh()'
    // Reuse-Detection in auth.service.ts) einen Massen-Widerruf ALLER
    // Sitzungen aus, da ein Aufruf mit einem bereits widerrufenen Token
    // als Diebstahlsignal gilt. Deshalb bewusst als LETZTE Prüfung dieses
    // Tests, nicht vor der obigen.
    await expect(service.refresh(oldRefreshToken)).rejects.toThrow(InvalidRefreshTokenError);
  });

  // Regressionstest für Sicherheitsreview 2026-08-27, Befund N4: ein
  // regulärer Passwortwechsel (mit Kenntnis des aktuellen Passworts) soll
  // einen zuvor angeforderten, noch offenen "Passwort vergessen"-Link
  // ebenfalls invalidieren — sonst bliebe dieser bis zu seinem eigenen
  // Ablauf gültig, obwohl das Konto längst ein neues Passwort hat.
  it('invalidiert einen zuvor angeforderten, noch offenen Passwort-Reset-Link', async () => {
    const { service, invitations, mailer, passwordResetTokens } = makeService();
    const { user } = await registerViaInvitation(service, invitations, { email: 'change-invalidiert-reset@example.org' });

    const resetToken = await (async () => {
      await service.requestPasswordReset('change-invalidiert-reset@example.org');
      const url = mailer.sentPasswordResetEmails.at(-1)!.resetUrl;
      return url.split('/reset-password/')[1]!;
    })();

    await service.changePassword(user.id, 'ein-sicheres-passwort', 'ein-noch-sichereres-passwort');

    await expect(service.resetPassword(resetToken, 'ueber-den-alten-link')).rejects.toThrow(InvalidOrExpiredResetTokenError);
    // Zur Kontrolle: das Token trägt jetzt tatsächlich ein usedAt (statt
    // z. B. gelöscht/nicht mehr auffindbar zu sein).
    const { hashPasswordResetToken } = await import('../../src/auth/tokens.js');
    const stored = await passwordResetTokens.findByHash(hashPasswordResetToken(resetToken));
    expect(stored?.usedAt).toBeTruthy();
  });

  // Regressionstest für Review 30.08.2026, Befund S4: ein kurzzeitig
  // entwendetes Access Token reicht — kombiniert mit dem aktuellen
  // Passwort — bereits aus, um das Konto zu übernehmen. Die rechtmäßige
  // Person muss davon erfahren, ohne selbst einen Anmeldeversuch zu
  // brauchen.
  it('benachrichtigt die (unveränderte) hinterlegte Adresse über den Passwortwechsel', async () => {
    const { service, invitations, mailer } = makeService();
    const { user } = await registerViaInvitation(service, invitations, { email: 'benachrichtigung-passwort@example.org' });

    await service.changePassword(user.id, 'ein-sicheres-passwort', 'ein-neues-passwort');

    expect(mailer.sentAccountSecurityChangeEmails).toHaveLength(1);
    expect(mailer.sentAccountSecurityChangeEmails[0]).toMatchObject({
      to: 'benachrichtigung-passwort@example.org',
      changeType: 'password',
    });
  });
});

describe('authService.changeEmail (Sicherheitsreview 2026-08-27, Befund H2)', () => {
  it('ändert bei korrektem aktuellem Passwort die E-Mail-Adresse und liefert ein frisches Token-Paar', async () => {
    const { service, invitations } = makeService();
    const { user } = await registerViaInvitation(service, invitations, { email: 'alt@example.org' });

    const result = await service.changeEmail(user.id, 'ein-sicheres-passwort', 'neu@example.org');
    expect(result.user.email).toBe('neu@example.org');
    expect(result.accessToken).toBeTruthy();

    await expect(
      service.login({ email: 'neu@example.org', password: 'ein-sicheres-passwort', consent: true, consentVersion: CURRENT_CONSENT_VERSION }),
    ).resolves.toBeTruthy();
    await expect(
      service.login({ email: 'alt@example.org', password: 'ein-sicheres-passwort', consent: true, consentVersion: CURRENT_CONSENT_VERSION }),
    ).rejects.toThrow(InvalidCredentialsError);
  });

  it('lehnt ein falsches aktuelles Passwort ab, ohne die E-Mail-Adresse zu ändern', async () => {
    const { service, invitations } = makeService();
    const { user } = await registerViaInvitation(service, invitations, { email: 'unveraendert@example.org' });

    await expect(service.changeEmail(user.id, 'falsches-passwort', 'neu@example.org')).rejects.toThrow(InvalidCurrentPasswordError);

    await expect(
      service.login({ email: 'unveraendert@example.org', password: 'ein-sicheres-passwort', consent: true, consentVersion: CURRENT_CONSENT_VERSION }),
    ).resolves.toBeTruthy();
  });

  // Sicherheitsreview 2026-08-27, Befund H2 — der eigentliche Grund für
  // diesen Endpunkt: verhindert, dass ein kurzzeitig entwendeter, noch
  // gültiger Access Token allein (ohne Kenntnis des aktuellen Passworts)
  // ausreicht, um die hinterlegte E-Mail-Adresse umzubiegen und
  // anschließend über POST /auth/forgot-password einen Reset-Link an eine
  // fremde Adresse zuzustellen.
  it('widerruft ANDERE Sitzungen, stellt aber sofort ein NEUES gültiges Token-Paar für die aktuelle Sitzung aus', async () => {
    const { service, invitations } = makeService();
    const { user, refreshToken: oldRefreshToken } = await registerViaInvitation(service, invitations, { email: 'session-test@example.org' });

    const result = await service.changeEmail(user.id, 'ein-sicheres-passwort', 'session-test-neu@example.org');

    await expect(service.refresh(result.refreshToken)).resolves.toBeTruthy();
    await expect(service.refresh(oldRefreshToken)).rejects.toThrow(InvalidRefreshTokenError);
  });

  it('erlaubt es, die eigene E-Mail-Adresse unverändert beizubehalten (kein Konflikt mit sich selbst)', async () => {
    const { service, invitations } = makeService();
    const { user } = await registerViaInvitation(service, invitations, { email: 'gleich@example.org' });

    const result = await service.changeEmail(user.id, 'ein-sicheres-passwort', 'gleich@example.org');
    expect(result.user.email).toBe('gleich@example.org');
  });

  // Sicherheitsreview 2026-08-27, Befund N3 (mitbehoben): der frühere
  // updateMe()-Pfad prüfte NUR per findByEmail() vor, ob die Adresse
  // bereits einem AKTIVEN Konto gehört — dieser Fall bleibt unverändert
  // über denselben Vorab-Check abgedeckt. Der eigentliche N3-Fall (Adresse
  // gehört einem bereits SOFT-gelöschten Konto, findByEmail() liefert dann
  // fälschlich "nicht vergeben") lässt sich mit InMemoryUserRepository
  // nicht auslösen (dessen update() kennt keinen echten Unique-Constraint,
  // siehe auth.repository.memory.ts) — siehe stattdessen
  // test-integration/authService.integration.test.ts für den Test gegen
  // eine echte Postgres-Instanz.
  it('lehnt eine bereits von einem AKTIVEN Konto verwendete E-Mail-Adresse ab', async () => {
    const { service, invitations } = makeService();
    const { user } = await registerViaInvitation(service, invitations, { email: 'erste@example.org' });
    await registerViaInvitation(service, invitations, { email: 'andere@example.org' });

    await expect(service.changeEmail(user.id, 'ein-sicheres-passwort', 'andere@example.org')).rejects.toThrow(EmailAlreadyRegisteredError);
  });

  // Sicherheitsreview 2026-08-29, Befund M2: der Abgleich lief über einen
  // zeichengenauen Vergleich — eine abweichende Groß-/Kleinschreibung
  // umging die Prüfung oben und ließ für EIN reales Postfach zwei Konten
  // entstehen. Der Endpunkt normalisiert die Eingabe inzwischen
  // (NormalizedEmailSchema, packages/shared-types/src/auth.ts); der
  // Service selbst muss zusätzlich case-insensitiv abgleichen, damit auch
  // BEREITS gespeicherte Adressen in gemischter Schreibweise erkannt
  // werden. Der Aufruf hier geht bewusst am Schema vorbei (direkt auf den
  // Service), prüft also genau diese zweite Verteidigungslinie.
  it('lehnt eine fremde Adresse auch bei abweichender Groß-/Kleinschreibung ab (Befund M2)', async () => {
    const { service, invitations } = makeService();
    const { user } = await registerViaInvitation(service, invitations, { email: 'erste-m2@example.org' });
    await registerViaInvitation(service, invitations, { email: 'andere-m2@example.org' });

    await expect(service.changeEmail(user.id, 'ein-sicheres-passwort', 'Andere-M2@Example.org')).rejects.toThrow(EmailAlreadyRegisteredError);
  });

  // Kehrseite desselben Befunds: der case-insensitive Abgleich darf die
  // Person nicht an ihrer EIGENEN Adresse scheitern lassen — genau dafür
  // vergleicht changeEmail() jetzt `emailTaken.id !== userId`, statt vorab
  // `newEmail !== user.email` zu prüfen.
  it('erlaubt es, die EIGENE Adresse in eine andere Schreibweise zu ändern (Befund M2)', async () => {
    const { service, invitations } = makeService();
    const { user } = await registerViaInvitation(service, invitations, { email: 'Eigene-M2@example.org' });

    const result = await service.changeEmail(user.id, 'ein-sicheres-passwort', 'eigene-m2@example.org');
    expect(result.user.email).toBe('eigene-m2@example.org');
  });

  // Regressionstest für Review 30.08.2026, Befund S4: ohne diese
  // Benachrichtigung war die BISHERIGE Adresse der einzige Kanal, der
  // einer rechtmäßigen Person nach einer Kontoübernahme (kurzzeitig
  // entwendetes Access Token) noch geblieben wäre — und genau dieser
  // Kanal blieb bislang stumm.
  it('benachrichtigt die BISHERIGE (nicht die neue) Adresse über den E-Mail-Wechsel', async () => {
    const { service, invitations, mailer } = makeService();
    const { user } = await registerViaInvitation(service, invitations, { email: 'alte-adresse@example.org' });

    await service.changeEmail(user.id, 'ein-sicheres-passwort', 'neue-adresse@example.org');

    expect(mailer.sentAccountSecurityChangeEmails).toHaveLength(1);
    expect(mailer.sentAccountSecurityChangeEmails[0]).toMatchObject({
      to: 'alte-adresse@example.org',
      changeType: 'email',
    });
  });
});

// Sicherheitsreview 2026-08-29, Befund M2: E-Mail-Adressen wurden nirgends
// normalisiert, `User.email` trägt in PostgreSQL aber ein zeichengenaues
// `@unique`. Wer als „Anna@verein.de" eingeladen wurde und sich als
// „anna@verein.de" anmeldete, bekam „E-Mail-Adresse oder Passwort ist
// ungültig" — bei korrekten Zugangsdaten und ohne jeden Hinweis auf die
// Ursache. Bei „Passwort vergessen" war der Effekt noch stiller: der
// Endpunkt antwortet aus gutem Grund immer generisch, es kam schlicht nie
// eine E-Mail an.
describe('E-Mail-Abgleich ohne Rücksicht auf Groß-/Kleinschreibung (Befund M2)', () => {
  it('meldet ein in gemischter Schreibweise gespeichertes Konto auch bei kleingeschriebener Eingabe an', async () => {
    const { service, invitations } = makeService();
    await registerViaInvitation(service, invitations, { email: 'Gemischt@Example.org' });

    await expect(
      service.login({ email: 'gemischt@example.org', password: 'ein-sicheres-passwort', consent: true, consentVersion: CURRENT_CONSENT_VERSION }),
    ).resolves.toBeTruthy();
  });

  it('stellt einen Reset-Link auch dann zu, wenn die Schreibweise von der gespeicherten abweicht', async () => {
    const { service, invitations, mailer } = makeService();
    await registerViaInvitation(service, invitations, { email: 'Reset-Gemischt@Example.org' });

    await service.requestPasswordReset('reset-gemischt@example.org');
    expect(mailer.sentPasswordResetEmails).toHaveLength(1);
  });

  it('verhindert ein Doppelkonto per abweichender Schreibweise beim Einlösen einer Einladung', async () => {
    const { service, invitations } = makeService();
    await registerViaInvitation(service, invitations, { email: 'doppelt@example.org' });

    await expect(
      registerViaInvitation(service, invitations, { email: 'Doppelt@Example.org' }),
    ).rejects.toThrow(EmailAlreadyRegisteredError);
  });
});
