// apps/api/src/modules/auth/auth.service.ts
//
// Geschäftslogik für Login/Refresh/Logout/Profil sowie — jetzt
// einladungsbasiert — das Registrieren via acceptInvitation(). Eine offene
// Selbstregistrierung (vormals register()) existiert nicht mehr: ein neues
// Konto entsteht ausschließlich durch Einlösen eines gültigen, nicht
// abgelaufenen, nicht bereits verwendeten Einladungs-Tokens (siehe
// modules/invitations/invitations.service.ts für dessen Ausstellung).
//
// Hängt bewusst nur von den Repository-Interfaces sowie den reinen
// Hilfsfunktionen aus auth/password.ts und auth/tokens.ts ab — dadurch
// vollständig ohne Datenbank testbar.
import type { LoginRequest, AcceptInvitationRequest, AccessTokenClaims } from '@lane1/shared-types';
import { CURRENT_CONSENT_VERSION } from '@lane1/shared-types';
import type { UserRepository, RefreshTokenRepository, UserRecord, PasswordResetTokenRepository } from './auth.repository.js';
import type { InvitationRecord } from '../invitations/invitations.repository.js';
import {
  InvitationNotFoundError,
  InvitationRevokedError,
  InvitationAlreadyUsedError,
  InvitationExpiredError,
} from '../invitations/invitations.service.js';
import type { ProfileDataGateway } from '../profile/profile.repository.js';
import { hashPassword, verifyPassword } from '../../auth/password.js';
import { signAccessToken, generateRefreshToken, hashRefreshToken, generatePasswordResetToken, hashPasswordResetToken } from '../../auth/tokens.js';
import type { KeyPair } from '../../auth/keys.js';
import type { MailSender } from '../../mail/mailer.js';

// Fest einprogrammierter, gültig kodierter argon2id-Hash für ein beliebiges
// Dummy-Passwort — dient AUSSCHLIESSLICH dazu, login() bei einer unbekannten
// E-Mail-Adresse denselben Rechenaufwand durchlaufen zu lassen wie bei
// einer bekannten (siehe login()-Kommentar dort). Kein echtes Nutzerkonto
// verwendet diesen Wert; er muss nicht geheim gehalten werden.
const DUMMY_PASSWORD_HASH_FOR_TIMING_SAFETY =
  '$argon2id$v=19$m=65536,t=3,p=1$BwcHBwcHBwcHBwcHBwcHBw$+bswrS8sR9j3B1OQvLnpXgVUe+eYdjzgsPy1U28dBpk';

export class EmailAlreadyRegisteredError extends Error {
  constructor() {
    super('Diese E-Mail-Adresse ist bereits registriert.');
  }
}
// Aufräumarbeit (Code-Review): User.athleteId trägt jetzt ein
// Unique-Constraint (siehe schema.prisma) — verhindert, dass zwei Konten
// auf dasselbe Athletenprofil zeigen. Tritt praktisch nur auf, wenn ein
// Admin versehentlich zwei Einladungen mit derselben athleteId ausstellt
// (die Einladungsausstellung selbst prüft das nicht, siehe
// invitations.service.ts) und beide angenommen werden.
export class AthleteAlreadyLinkedError extends Error {
  constructor() {
    super('Für dieses Athletenprofil existiert bereits ein Nutzerkonto.');
  }
}
export class InvalidCredentialsError extends Error {
  constructor() {
    // Bewusst generisch — verrät nicht, ob die E-Mail existiert oder nur
    // das Passwort falsch war (verhindert User-Enumeration).
    super('E-Mail-Adresse oder Passwort ist ungültig.');
  }
}
export class InvalidRefreshTokenError extends Error {
  constructor() {
    super('Refresh Token ist ungültig, abgelaufen oder wurde bereits verwendet.');
  }
}
export class UserNotFoundError extends Error {
  constructor() {
    super('Nutzer:in wurde nicht gefunden.');
  }
}
export class InvalidInvitationError extends Error {
  constructor(message = 'Die Einladung ist ungültig, abgelaufen, widerrufen oder bereits verwendet.') {
    super(message);
  }
}

export class ClubIdRequiredError extends Error {
  constructor() {
    super('Als Superadministrator:in muss der Verein (clubId) explizit angegeben werden.');
  }
}

// PATCH /api/users/:userId/roles (docs/kampfrichter-modul-plan.md,
// Abschnitt 1.4) — Ziel-Konto gehört nicht zum eigenen Verein. Bewusst wie
// bei qualifications.service.ts (QualificationForbiddenError) statt 404,
// analog dem dort bereits etablierten Muster für :userId-Routen.
export class ForeignClubUserError extends Error {
  constructor() {
    super('Diese Person gehört nicht zu Ihrem Verein.');
  }
}

// "superadmin" wird ausschließlich über scripts/createSuperAdmin.ts
// vergeben (siehe RoleSchema-Kommentar) — nie über diesen Endpunkt, auch
// nicht durch einen Admin des betroffenen Vereins.
export class CannotAssignSuperadminError extends Error {
  constructor() {
    super('"superadmin" kann nicht über diesen Endpunkt vergeben werden.');
  }
}

// Verhindert, dass ein Verein durch eine Rollenänderung ohne jede
// verbleibende admin-Rolle zurückbleibt — sonst könnte niemand mehr
// Mitglieder verwalten/einladen oder weitere Rollenänderungen vornehmen.
export class LastAdminError extends Error {
  constructor() {
    super('Diese Änderung würde den Verein ohne Administrator:in zurücklassen.');
  }
}

// Sicherheitsreview 2026-08, Befund M5 ("Passwort vergessen" +
// Passwortwechsel).
export class InvalidCurrentPasswordError extends Error {
  constructor() {
    super('Das aktuelle Passwort ist nicht korrekt.');
  }
}
// Bewusst EIN gemeinsamer Fehlertyp für "Token existiert nicht" /
// "bereits verwendet" / "abgelaufen" — analog zu InvalidInvitationError
// oben bzw. InvalidRefreshTokenError: für den Aufrufer (die Person, die
// gerade einen Reset-Link öffnet) ist die Botschaft in allen drei Fällen
// dieselbe ("dieser Link funktioniert nicht mehr"), eine feinere
// Unterscheidung wäre zudem ein Informationsleck (ließe z. B. erkennen,
// ob ein Token je gültig war).
export class InvalidOrExpiredResetTokenError extends Error {
  constructor() {
    super('Der Link zum Zurücksetzen des Passworts ist ungültig, abgelaufen oder wurde bereits verwendet.');
  }
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

// Schmale Abhängigkeit statt der vollen InvitationRepository: erzwingt, dass
// acceptInvitation() unten dieselbe Gültigkeitsprüfung verwendet wie
// invitations.service.ts' preview() — nämlich GENAU dessen
// findValidByToken() —, statt die vier Prüfungen (nicht gefunden/
// widerrufen/verwendet/abgelaufen) hier ein zweites Mal, potenziell
// abweichend, zu implementieren (siehe Code-Review: die beiden Prüfungen
// waren bereits einmal auseinandergelaufen — unterschiedliche Fehlertypen
// trotz eines Kommentars dort, der fälschlich eine gemeinsame Nutzung
// behauptete). In Produktion (app.ts) ist dies dieselbe InvitationsService-
// Instanz, die auch preview() bedient.
export interface InvitationValidator {
  findValidByToken(token: string): Promise<InvitationRecord>;
  markUsed(id: string): Promise<void>;
}

// Schmale Abhängigkeit (wie InvitationValidator oben) statt des vollen
// ClubRepository aus modules/invitations — dieser Service braucht nur
// findById(), um die gebuchten Module des Vereins in die Session-Antwort
// (login/refresh/acceptInvitation/getMe) einzubetten (siehe
// resolveClubContext() unten).
export interface ClubModulesLookup {
  findById(clubId: string): Promise<{ enabledModules: string[]; nationalID: string | null; nationalIDType: string | null } | null>;
}

export interface AuthServiceDeps {
  users: UserRepository;
  refreshTokens: RefreshTokenRepository;
  invitations: InvitationValidator;
  profileGateway: ProfileDataGateway;
  clubs: ClubModulesLookup;
  dataErasureRetentionDays: number;
  keyPair: KeyPair;
  accessTtlSeconds: number;
  refreshTtlDays: number;
  // "Passwort vergessen" (Sicherheitsreview 2026-08, Befund M5).
  passwordResetTokens: PasswordResetTokenRepository;
  mailer: MailSender;
  frontendBaseUrl: string;
  passwordResetTtlMinutes: number;
}

// Analog zu buildInviteUrl() in invitations.service.ts: die Annahme-/
// Zurücksetzen-Seite liegt im normalen Frontend, NICHT unter "/admin".
function buildPasswordResetUrl(frontendBaseUrl: string, token: string): string {
  return `${frontendBaseUrl.replace(/\/+$/, '')}/#/reset-password/${token}`;
}

export function toPublicUser(user: UserRecord) {
  const { passwordHash: _passwordHash, ...publicUser } = user;
  return publicUser;
}

// Code-Review 2026-09-02, Befund R1: vormals zwei getrennte Funktionen
// (resolveEnabledModules()/resolveClubIdentity()), die JEDE für sich
// dieselbe Zeile per clubs.findById() luden — an allen acht Aufrufstellen
// unten (acceptInvitation/login/refresh/resetPassword/changePassword/
// changeEmail/getMe/updateMe) also zwei sequentiell awaitete
// Datenbankzugriffe für denselben Club-Datensatz, statt eines einzigen.
// `PrismaClubRepository.findById()` (invitations.repository.ts) liefert
// alle drei benötigten Felder (enabledModules/nationalID/nationalIDType)
// ohnehin in einem `findUnique()`. `null` nur für "superadmin" (gehört zu
// keinem Verein, siehe UserRecord.clubId-Kommentar) — liefert dafür
// konsequent leere/null-Werte statt eines Fehlers, die Superadmin-
// Oberfläche ("/admin") nutzt den normalen Router mit Modul-Gating und den
// Ergebnisimport (siehe unten) ohnehin nicht.
//
// `clubNationalID`/`clubNationalIDType` dienen der externen Vereinskennung
// des Ergebnisimports (DSV7/Lenex, siehe
// docs/dsv7-lenex-import-plan.md Abschnitt 3.1) — eingebettet in dieselben
// Session-/Profil-Antworten, damit das Frontend den eigenen Verein beim
// Import automatisch gegen die Datei abgleichen kann
// (apps/web/js/modules/resultsImportUI.js), ohne einen eigenen Endpunkt
// dafür aufrufen zu müssen.
async function resolveClubContext(
  clubs: ClubModulesLookup,
  clubId: string | null,
): Promise<{ enabledModules: string[]; clubNationalID: string | null; clubNationalIDType: string | null }> {
  const club = clubId ? await clubs.findById(clubId) : null;
  return {
    enabledModules: club?.enabledModules ?? [],
    clubNationalID: club?.nationalID ?? null,
    clubNationalIDType: club?.nationalIDType ?? null,
  };
}

export function createAuthService(deps: AuthServiceDeps) {
  async function issueTokens(user: UserRecord): Promise<AuthTokens> {
    const claims: AccessTokenClaims = {
      sub: user.id,
      roles: user.roles as AccessTokenClaims['roles'],
      clubId: user.clubId,
      athleteId: user.athleteId,
    };
    const accessToken = await signAccessToken(claims, deps.keyPair, deps.accessTtlSeconds);
    const refresh = generateRefreshToken(deps.refreshTtlDays);
    await deps.refreshTokens.create(user.id, refresh.tokenHash, refresh.expiresAt);
    return { accessToken, refreshToken: refresh.plainToken, expiresIn: deps.accessTtlSeconds };
  }

  // Code-Review, Befund R9: listClubMembers() und listAssignableTrainers()
  // teilten sich zuvor Abruf, Sortierung und toPublicUser()-Mapping als
  // Kopie und unterschieden sich nur in Filter und Sortierkriterium.
  //
  // Sicherheitsreview 2026-08-27, Befund N6: `project` zusätzlich
  // parametrisiert (statt fest `toPublicUser()`) — `/api/users/trainers`
  // (siehe listAssignableTrainers() unten) bedient ausschließlich ein
  // Dropdown zur Auswahl der zuständigen Person für ein Handlungsfeld und
  // brauchte dafür nie mehr als id/name/role; `toPublicUser()` lieferte
  // dort bislang zusätzlich E-Mail-Adresse und DSGVO-Einwilligungs-
  // Nachweisdaten (`consentGivenAt`/`consentVersion`), die in einem
  // reinen Auswahl-Endpunkt nichts verloren haben. `listClubMembers()`
  // (echte Mitgliederverwaltung, braucht tatsächlich mehr Felder) bleibt
  // unverändert bei `toPublicUser()`.
  async function listMembers<T>(
    clubId: string,
    opts: {
      filter?: (user: UserRecord) => boolean;
      compare: (a: UserRecord, b: UserRecord) => number;
      project: (user: UserRecord) => T;
    },
  ): Promise<T[]> {
    const users = await deps.users.listByClub(clubId);
    const scoped = opts.filter ? users.filter(opts.filter) : users;
    return [...scoped].sort(opts.compare).map(opts.project);
  }

  return {
    // Ersetzt das frühere offene register(): ein Konto entsteht nur durch
    // Einlösen einer gültigen Einladung. Name und Passwort kommen vom
    // Client, E-Mail/Rolle/Verein/athleteId stammen bewusst AUSSCHLIESSLICH
    // aus der serverseitig gespeicherten Einladung — ein manipulierter
    // Client könnte sich sonst z. B. selbst die Rolle "admin" zuweisen.
    async acceptInvitation(input: AcceptInvitationRequest) {
      let invitation: InvitationRecord;
      try {
        invitation = await deps.invitations.findValidByToken(input.token);
      } catch (err) {
        // Die vier Gültigkeitsfehler von findValidByToken() (siehe deren
        // Kommentar in invitations.service.ts) auf den schmaleren,
        // öffentlichen InvalidInvitationError dieses Moduls abgebildet —
        // auth.route.ts antwortet dadurch weiterhin einheitlich mit
        // HTTP 410, ohne die vier internen Fehlertypen selbst kennen zu
        // müssen (die gehören zur Domäne von invitations.service.ts).
        if (
          err instanceof InvitationNotFoundError ||
          err instanceof InvitationRevokedError ||
          err instanceof InvitationAlreadyUsedError ||
          err instanceof InvitationExpiredError
        ) {
          throw new InvalidInvitationError(err.message);
        }
        throw err;
      }

      const existingUser = await deps.users.findByEmail(invitation.email);
      if (existingUser) throw new EmailAlreadyRegisteredError();

      const passwordHash = await hashPassword(input.password);
      let user: UserRecord;
      try {
        user = await deps.users.create({
          clubId: invitation.clubId,
          name: input.name,
          email: invitation.email,
          passwordHash,
          // Startmenge mit genau einer Rolle — weitere Rollen kommen
          // ausschließlich über PATCH /api/users/:userId/roles hinzu, nie
          // direkt bei der Registrierung (docs/kampfrichter-modul-plan.md,
          // Abschnitt 1.4).
          roles: [invitation.role],
          athleteId: invitation.athleteId,
          // input.consent ist an dieser Stelle bereits durch
          // AcceptInvitationRequestSchema (consent: z.literal(true)) erzwungen —
          // wird hier dennoch nicht blind angenommen, sondern explizit als
          // Zeitpunkt/Version dokumentiert (DSGVO-Nachweispflicht).
          consentGivenAt: new Date(),
          consentVersion: CURRENT_CONSENT_VERSION,
        });
      } catch (err) {
        // Zwei unterschiedliche Unique-Constraints auf "users" können hier
        // greifen (siehe schema.prisma: email, athleteId) — Prismas
        // meta.target nennt zuverlässig das betroffene Feld (empirisch
        // geprüft), damit beide mit der jeweils richtigen, spezifischen
        // Fehlermeldung beantwortet werden, statt beide unter einem
        // pauschalen "E-Mail bereits registriert" zu vermischen.
        const target = err && typeof err === 'object' && 'meta' in err ? (err as { meta?: { target?: string[] } }).meta?.target : undefined;
        if (err && typeof err === 'object' && 'code' in err && (err as { code?: string }).code === 'P2002') {
          if (target?.includes('athleteId')) throw new AthleteAlreadyLinkedError();
          // findByEmail() oben liefert bewusst NUR aktive Konten (siehe
          // dessen Kommentar in auth.repository.ts) — für eine E-Mail, die
          // einem bereits SOFT-gelöschten Konto gehört (Recht auf Löschung,
          // Art. 17 DSGVO, noch vor dem endgültigen Hard-Purge), liefert
          // findByEmail() fälschlich `null`, obwohl `email` in der
          // Datenbank weiterhin `@unique` ist — genau dieser Fall tritt
          // ein, wenn eine gelöschte Person erneut eingeladen wird und die
          // Einladung annimmt. Ohne diesen Fang würde Prismas "P2002" hier
          // als ungefangener 500 durchschlagen, statt als derselbe, bereits
          // vorhandene 409, den findByEmail() für ein aktives Konto liefert.
          throw new EmailAlreadyRegisteredError();
        }
        throw err;
      }
      await deps.invitations.markUsed(invitation.id);

      const tokens = await issueTokens(user);
      const clubContext = await resolveClubContext(deps.clubs, user.clubId);
      return { ...tokens, user: toPublicUser(user), ...clubContext };
    },

    async login(input: LoginRequest) {
      const user = await deps.users.findByEmail(input.email); // findByEmail liefert nie gelöschte Konten
      if (!user) {
        // Sicherheitskorrektur (Code-Review): ohne diesen Zweig kehrte
        // login() bei einer unbekannten E-Mail-Adresse SOFORT zurück,
        // während eine bekannte Adresse erst nach einem vollständigen,
        // absichtlich teuren argon2id-Vergleich (64 MiB Speicher, siehe
        // auth/password.ts) fehlschlug. Dieser klar messbare Zeitunterschied
        // hebelt den bewusst generischen InvalidCredentialsError unten aus
        // (siehe dessen Kommentar: "verrät nicht, ob die E-Mail existiert")
        // — ein Angreifer könnte per Timing-Messung trotzdem systematisch
        // registrierte E-Mail-Adressen von unregistrierten unterscheiden.
        // Der Vergleich läuft daher IMMER gegen einen fest einprogrammierten
        // Dummy-Hash (mit denselben Kostenparametern), das Ergebnis wird
        // verworfen — der Rechenaufwand bleibt für beide Fälle derselbe.
        await verifyPassword(input.password, DUMMY_PASSWORD_HASH_FOR_TIMING_SAFETY);
        throw new InvalidCredentialsError();
      }

      const passwordOk = await verifyPassword(input.password, user.passwordHash);
      if (!passwordOk) throw new InvalidCredentialsError();

      // Review 30.08.2026, Befund S1: input.consentVersion ist durch
      // LoginRequestSchema (z.literal(CURRENT_CONSENT_VERSION)) bereits auf
      // exakt die aktuelle Fassung geprüft — der Datensatz unten spiegelt
      // damit eine tatsächlich vom Client bestätigte Version wider, keine
      // vom Server unterstellte. Geschrieben wird trotzdem nur, wenn sich
      // etwas ändert (das gespeicherte consentVersion also veraltet war):
      // sonst würde jeder Routine-Login dieselbe Zeile erneut schreiben und
      // consentGivenAt ohne fachlichen Anlass vorrücken, obwohl niemand neu
      // zugestimmt hat.
      const updated =
        user.consentVersion === CURRENT_CONSENT_VERSION
          ? user
          : await deps.users.update(user.id, {
              consentGivenAt: new Date(),
              consentVersion: CURRENT_CONSENT_VERSION,
            });

      const tokens = await issueTokens(updated);
      const clubContext = await resolveClubContext(deps.clubs, updated.clubId);
      return { ...tokens, user: toPublicUser(updated), ...clubContext };
    },

    async refresh(plainRefreshToken: string) {
      const tokenHash = hashRefreshToken(plainRefreshToken);
      const existing = await deps.refreshTokens.findByHash(tokenHash);
      if (!existing) throw new InvalidRefreshTokenError();

      // Sicherheitskorrektur (Code-Review, Befund S2 — Reuse-Detection):
      // ein bereits widerrufenes Token wurde bislang identisch zu einem
      // unbekannten/abgelaufenen behandelt (schlicht InvalidRefreshTokenError).
      // Ein Token wird aber AUSSCHLIESSLICH durch Rotation widerrufen (siehe
      // deps.refreshTokens.revoke() unten) oder durch Logout — ein Aufruf
      // mit einem bereits rotierten Token ist damit das einzige verlässliche
      // Signal für einen Token-Diebstahl: löst ein Angreifer ein gestohlenes
      // Refresh Token vor dem rechtmäßigen Gerät ein, würde er über die
      // Rotationskette sonst dauerhaften Zugriff behalten, während der
      // eigentliche Fehlschlag später beim rechtmäßigen Gerät auftritt und
      // dort wie ein normaler Sitzungsablauf aussieht. Statt nur diesen
      // einen Versuch abzulehnen, werden deshalb ALLE Sitzungen dieses
      // Nutzerkontos sofort widerrufen (revokeAllForUser() existiert
      // bereits für Logout/Kontolöschung) — sowohl das gestohlene als auch
      // das eigentlich rechtmäßige Gerät müssen sich danach neu anmelden,
      // was für einen tatsächlichen Diebstahl der einzig sichere Ausgang
      // ist. `expiresAt` wird hier bewusst NICHT mitgeprüft: ein
      // wiederverwendetes Token bleibt auch nach seinem eigenen Ablaufdatum
      // ein Diebstahlsignal, solange der Datensatz noch existiert.
      //
      // WICHTIG: dieser Zweig reagiert scharf auf jede Zweit-Verwendung —
      // ein Client, der ein rotiertes Token versehentlich ein zweites Mal
      // schickt (z. B. mehrere parallele 401-getriebene Refresh-Versuche
      // ohne Bündelung), löst denselben Massen-Widerruf aus. apiClient.js
      // bündelt gleichzeitige refreshTokens()-Aufrufe deshalb serverseitig
      // wie clientseitig auf GENAU einen In-Flight-Versuch (siehe dort,
      // Befund S4) — ohne dieses Bündeln wäre dieser Reuse-Schutz gegen
      // das eigene, harmlose Nebeneinanderherlaufen der App ausgelöst worden.
      if (existing.revokedAt) {
        await deps.refreshTokens.revokeAllForUser(existing.userId);
        throw new InvalidRefreshTokenError();
      }

      if (existing.expiresAt.getTime() < Date.now()) throw new InvalidRefreshTokenError();

      const user = await deps.users.findById(existing.userId);
      if (!user) throw new InvalidRefreshTokenError();

      // Rotation: das alte Token wird ungültig, sobald ein neues ausgestellt
      // wurde — ein wiederverwendetes (z. B. gestohlenes) altes Token
      // funktioniert danach nicht mehr (siehe Reuse-Detection oben, die
      // genau DIESEN Fall abfängt).
      await deps.refreshTokens.revoke(existing.id);
      const tokens = await issueTokens(user);
      const clubContext = await resolveClubContext(deps.clubs, user.clubId);
      return { ...tokens, user: toPublicUser(user), ...clubContext };
    },

    async logout(plainRefreshToken: string) {
      const tokenHash = hashRefreshToken(plainRefreshToken);
      const existing = await deps.refreshTokens.findByHash(tokenHash);
      if (existing && !existing.revokedAt) {
        await deps.refreshTokens.revoke(existing.id);
      }
      // Logout ist idempotent: ein bereits ungültiges/unbekanntes Token
      // führt nicht zu einem Fehler — der Effekt ("nicht mehr eingeloggt")
      // ist ohnehin bereits erreicht.
    },

    // "Passwort vergessen" (Sicherheitsreview 2026-08, Befund M5). Liefert
    // IMMER denselben Effekt nach außen (kein Fehler, keine Information
    // darüber, ob die E-Mail-Adresse zu einem Konto gehört) — verhindert
    // User-Enumeration über diesen öffentlichen, nicht authentifizierten
    // Endpunkt, analog zum generischen InvalidCredentialsError bei login().
    // Anders als bei login() wird hier bewusst NICHT auf einen
    // Dummy-Arbeitsaufwand für den "nicht gefunden"-Fall gesetzt: die
    // eigentlich variable, potenziell verräterische Zeitkomponente ist
    // hier nicht ein Passwort-Hash-Vergleich (konstant teuer, einfach
    // anzugleichen), sondern der E-Mail-Versand (SMTP-Netzwerklatenz, von
    // Natur aus stark schwankend) — sendPasswordResetEmail() wird daher
    // bewusst NICHT awaited (siehe unten), sodass die Antwortzeit für
    // "gefunden" und "nicht gefunden" ähnlich schnell (dominiert von der
    // DB-Abfrage) bleibt, statt für den "gefunden"-Fall um einen vollen
    // SMTP-Roundtrip zu wachsen.
    //
    // Review 30.08.2026, Befund S3: dieselbe Überlegung galt bislang nicht
    // für die Arbeit ZWISCHEN der Suche und dem E-Mail-Versand — der
    // Nicht-Treffer-Pfad kehrte sofort zurück, während der Treffer-Pfad
    // zusätzlich ein Token erzeugte, hashte und in die Datenbank schrieb.
    // Zwar leichtgewichtige Operationen (randomBytes()/SHA-256, kein
    // teurer argon2id-Vergleich wie bei login()), aber eine stabile,
    // messbare Differenz — genug, um die Adressliste eines Vereins über
    // wiederholte Zeitmessungen durchzuprobieren. Token-Erzeugung/-Hash
    // läuft jetzt auf BEIDEN Pfaden; der Schreibvorgang selbst lässt sich
    // für den Nicht-Treffer-Fall nicht spiegeln (kein Konto, in das
    // geschrieben werden könnte) und wird deshalb — wie der Mailversand
    // unten — ebenfalls nicht awaitet.
    async requestPasswordReset(email: string): Promise<void> {
      const user = await deps.users.findByEmail(email); // liefert nie gelöschte Konten
      const { plainToken, tokenHash, expiresAt } = generatePasswordResetToken(deps.passwordResetTtlMinutes);
      if (!user) return;

      // Bewusst ohne await (Befund S3, siehe Kommentar oben) — der
      // Aufrufer wartet auf keines von beidem, die generische Antwort geht
      // unabhängig vom Ausgang sofort zurück.
      //
      // Sicherheitskorrektur (Code-Review 2026-09-02, Befund P1): der
      // Mailversand hängt jetzt AN das Schreiben des Tokens (`.then()`
      // statt eines zweiten, unabhängigen `deps.mailer...`-Aufrufs
      // darunter). Vormals liefen beide Zweige parallel und unabhängig
      // voneinander — schlug NUR der Schreibvorgang fehl (z. B. DB
      // kurzzeitig nicht erreichbar), ging die Mail mit einem Link
      // trotzdem hinaus, dessen Token nie gespeichert wurde. Diese Person
      // bekäme beim Klick InvalidOrExpiredResetTokenError ("ungültig,
      // abgelaufen oder bereits verwendet") angezeigt, obwohl nichts davon
      // zutrifft — der einzige Hinweis auf die eigentliche Ursache wäre
      // die untenstehende, rein serverseitige Log-Zeile gewesen. Ein
      // Fehlschlag AN JEDER Stelle dieser Kette (Schreiben ODER Versand)
      // wird weiterhin nur geloggt, nie an den Client durchgereicht.
      deps.passwordResetTokens
        .create(user.id, tokenHash, expiresAt)
        .then(() =>
          deps.mailer.sendPasswordResetEmail({
            to: user.email,
            recipientName: user.name,
            resetUrl: buildPasswordResetUrl(deps.frontendBaseUrl, plainToken),
            expiresAt,
            locale: user.locale,
          }),
        )
        .catch((err) => {
          console.error('[auth] Fehler beim Zurücksetzen-Passwort-Ablauf (Token speichern/E-Mail versenden):', err);
        });
    },

    // Löst ein per E-Mail zugestelltes Reset-Token ein. Wie
    // acceptInvitation() meldet sich die Person danach direkt an (issueTokens()
    // unten) — sie hat mit dem Öffnen des Links bereits Zugriff auf das
    // E-Mail-Postfach nachgewiesen, ein zusätzlicher manueller Login-Schritt
    // böte keinen echten Sicherheitsgewinn, nur schlechtere UX.
    //
    // Sicherheitsmaßnahme: ALLE bestehenden Sitzungen (Refresh Tokens)
    // werden vor der Neuausstellung widerrufen — ein zurückgesetztes
    // Passwort deutet typischerweise auf einen (vermuteten) Kontokompromiss
    // hin; jedes andere angemeldete Gerät muss sich danach mit dem neuen
    // Passwort neu anmelden, analog zur Reuse-Detection in refresh().
    async resetPassword(plainToken: string, newPassword: string) {
      const tokenHash = hashPasswordResetToken(plainToken);
      const existing = await deps.passwordResetTokens.findByHash(tokenHash);
      if (!existing) throw new InvalidOrExpiredResetTokenError();
      if (existing.usedAt) throw new InvalidOrExpiredResetTokenError();
      if (existing.expiresAt.getTime() < Date.now()) throw new InvalidOrExpiredResetTokenError();

      const user = await deps.users.findById(existing.userId);
      if (!user) throw new InvalidOrExpiredResetTokenError(); // Konto zwischenzeitlich gelöscht

      const passwordHash = await hashPassword(newPassword);
      const updated = await deps.users.update(user.id, { passwordHash });
      // Sicherheitsreview 2026-08-27, Befund N4: markAllUsedForUser()
      // statt nur markUsed(existing.id) — deckt das gerade eingelöste
      // Token mit ab (dessen usedAt ist an dieser Stelle noch null) UND
      // invalidiert zusätzlich jeden ANDEREN, noch offenen Reset-Link
      // desselben Kontos (siehe Kommentar am Interface in
      // auth.repository.ts). Ohne dies blieb z. B. bei mehreren innerhalb
      // der TTL angeforderten Reset-Mails jeder weitere Link bis zu seinem
      // eigenen Ablauf gültig und hätte unabhängig vom soeben gesetzten
      // neuen Passwort erneut einen Passwortwechsel samt Auto-Login
      // ausgelöst.
      await deps.passwordResetTokens.markAllUsedForUser(user.id);
      await deps.refreshTokens.revokeAllForUser(user.id);

      const tokens = await issueTokens(updated);
      const clubContext = await resolveClubContext(deps.clubs, updated.clubId);
      return { ...tokens, user: toPublicUser(updated), ...clubContext };
    },

    // Passwortwechsel für die AKTUELL eingeloggte Person (Sicherheitsreview
    // 2026-08, Befund M5) — verlangt zusätzlich das aktuelle Passwort
    // (verhindert, dass ein kurzzeitig entwendeter Access Token allein zur
    // dauerhaften Kontoübernahme reicht: ohne diese Prüfung könnte ein
    // gestohlenes, noch gültiges Access Token genutzt werden, um die
    // eigentliche Besitzerin/den eigentlichen Besitzer per neuem Passwort
    // dauerhaft auszusperren).
    //
    // Widerruft — wie resetPassword() oben — ALLE bestehenden Sitzungen und
    // stellt danach sofort ein frisches Token-Paar aus: die AKTUELLE
    // Sitzung bleibt dadurch nahtlos angemeldet, jede ANDERE (z. B. ein
    // verlorenes/gestohlenes Gerät) wird abgemeldet.
    async changePassword(userId: string, currentPassword: string, newPassword: string) {
      const user = await deps.users.findById(userId);
      if (!user) throw new UserNotFoundError();

      const currentPasswordOk = await verifyPassword(currentPassword, user.passwordHash);
      if (!currentPasswordOk) throw new InvalidCurrentPasswordError();

      const passwordHash = await hashPassword(newPassword);
      const updated = await deps.users.update(userId, { passwordHash });
      // Sicherheitsreview 2026-08-27, Befund N4: ein regulärer
      // Passwortwechsel (mit Kenntnis des aktuellen Passworts) soll einen
      // zuvor angeforderten, noch nicht eingelösten "Passwort
      // vergessen"-Link nicht überleben lassen — sonst bliebe dieser
      // weiterhin bis zu seinem eigenen Ablauf gültig, obwohl das Konto
      // längst ein neues Passwort hat.
      await deps.passwordResetTokens.markAllUsedForUser(userId);
      await deps.refreshTokens.revokeAllForUser(userId);

      // Review 30.08.2026, Befund S4: ein kurzzeitig entwendetes, noch
      // gültiges Access Token reicht — kombiniert mit diesem aktuellen
      // Passwort — bereits aus, um das Konto zu übernehmen; die
      // rechtmäßige Person erfährt davon sonst erst beim nächsten eigenen
      // Anmeldeversuch. Bewusst ohne await (wie der Mailversand bei
      // requestPasswordReset()): ein Fehlschlag darf den erfolgreichen
      // Passwortwechsel selbst nicht verzögern oder scheitern lassen.
      deps.mailer
        .sendAccountSecurityChangeNotice({ to: user.email, recipientName: user.name, changeType: 'password', locale: user.locale })
        .catch((err) => {
          console.error('[auth] Fehler beim Versand des Sicherheitshinweises nach Passwortwechsel:', err);
        });

      const tokens = await issueTokens(updated);
      const clubContext = await resolveClubContext(deps.clubs, updated.clubId);
      return { ...tokens, user: toPublicUser(updated), ...clubContext };
    },

    // E-Mail-Wechsel für die AKTUELL eingeloggte Person (Sicherheitsreview
    // 2026-08-27, Befund H2) — verlangt wie changePassword() oben
    // zusätzlich das aktuelle Passwort. `email` ist deshalb bewusst KEIN
    // Feld von updateMe()/UpdateMeRequestSchema mehr (siehe dortiger
    // Kommentar in packages/shared-types/src/auth.ts für die vollständige
    // Begründung): ohne diese Prüfung hätte ein kurzzeitig entwendeter,
    // noch gültiger Access Token gereicht, um die hinterlegte Adresse auf
    // eine eigene umzubiegen und sich über POST /auth/forgot-password
    // selbst einen Reset-Link zuzustellen — eine dauerhafte
    // Kontoübernahme, bei der die rechtmäßige Person weder die neue
    // E-Mail-Adresse noch das anschließend gesetzte Passwort kennt.
    //
    // Widerruft — wie changePassword() — ALLE bestehenden Sitzungen und
    // stellt sofort ein frisches Token-Paar für die AKTUELLE Sitzung aus:
    // jede künftige "Passwort vergessen"-Anfrage geht ab sofort an die
    // NEUE Adresse, ein Wechsel ist damit ebenso sicherheitsrelevant wie
    // ein Passwortwechsel.
    async changeEmail(userId: string, currentPassword: string, newEmail: string) {
      const user = await deps.users.findById(userId);
      if (!user) throw new UserNotFoundError();

      const currentPasswordOk = await verifyPassword(currentPassword, user.passwordHash);
      if (!currentPasswordOk) throw new InvalidCurrentPasswordError();

      // Schneller, klarer Vorab-Check für den häufigen Fall (Adresse
      // gehört zu einem AKTIVEN Konto) — spart einen DB-Schreibversuch,
      // der ohnehin scheitern würde.
      //
      // Sicherheitsreview 2026-08-29, Befund M2: die Prüfung schließt
      // jetzt das EIGENE Konto explizit aus (`emailTaken.id !== userId`),
      // statt vorab `newEmail !== user.email` zu vergleichen. Zwei Gründe,
      // beide Folge der Normalisierung/des case-insensitiven Abgleichs:
      //   - findByEmail() findet seit Befund M2 auch die eigene, in
      //     abweichender Schreibweise gespeicherte Adresse — der frühere
      //     Zeichenvergleich hätte „Anna@verein.de" -> „anna@verein.de"
      //     (die Normalisierung der EIGENEN Adresse) fälschlich als
      //     „bereits vergeben" abgelehnt.
      //   - Der Vergleich `newEmail !== user.email` war ohnehin
      //     zeichengenau und hätte eine reine Schreibweisen-Änderung als
      //     echten Wechsel behandelt.
      // Der Aufwand bleibt identisch: eine Abfrage in beiden Fällen.
      const emailTaken = await deps.users.findByEmail(newEmail);
      if (emailTaken && emailTaken.id !== userId) throw new EmailAlreadyRegisteredError();

      let updated: UserRecord;
      try {
        updated = await deps.users.update(userId, { email: newEmail });
      } catch (err) {
        // Sicherheitsreview 2026-08-27, Befund N3 (behoben zusammen mit
        // H2) — analog zum bestehenden P2002-Fang in acceptInvitation()
        // (siehe dort für die ausführliche Begründung): findByEmail() oben
        // liefert bewusst NUR aktive Konten, für eine E-Mail-Adresse eines
        // bereits SOFT-gelöschten Kontos also fälschlich "nicht vergeben",
        // obwohl `email` in der Datenbank weiterhin `@unique` ist. Ohne
        // diesen Fang schlüge Prismas "P2002" hier als ungefangener 500
        // durch, statt als derselbe, bereits vorhandene 409, den eine
        // Adresse eines aktiven Kontos liefert — ein Existenz-Orakel
        // (500 vs. 409 verriet, ob die Adresse zu einem — wenn auch
        // gelöschten — Konto gehört).
        if (err && typeof err === 'object' && 'code' in err && (err as { code?: string }).code === 'P2002') {
          throw new EmailAlreadyRegisteredError();
        }
        throw err;
      }

      await deps.refreshTokens.revokeAllForUser(userId);

      // Review 30.08.2026, Befund S4: geht an user.email — die Adresse VOR
      // diesem Wechsel, nicht `updated.email` (die neue). Nur die
      // bisherige Adresse ist noch ein Kanal, über den die rechtmäßige
      // Person eine unautorisierte Änderung überhaupt erfahren kann: die
      // neue Adresse gehört im Übernahme-Fall bereits der angreifenden
      // Person. Bewusst ohne await, aus demselben Grund wie bei
      // changePassword() oben.
      deps.mailer
        .sendAccountSecurityChangeNotice({ to: user.email, recipientName: user.name, changeType: 'email', locale: user.locale })
        .catch((err) => {
          console.error('[auth] Fehler beim Versand des Sicherheitshinweises nach E-Mail-Wechsel:', err);
        });

      const tokens = await issueTokens(updated);
      const clubContext = await resolveClubContext(deps.clubs, updated.clubId);
      return { ...tokens, user: toPublicUser(updated), ...clubContext };
    },

    async getMe(userId: string) {
      const user = await deps.users.findById(userId);
      if (!user) throw new UserNotFoundError();
      const clubContext = await resolveClubContext(deps.clubs, user.clubId);
      return { ...toPublicUser(user), ...clubContext };
    },

    // Sicherheitsreview 2026-08-27, Befund H2: `email` ist bewusst KEIN
    // Feld dieses Patches mehr — siehe changeEmail() oben bzw. den
    // Kommentar an UpdateMeRequestSchema (packages/shared-types/src/
    // auth.ts) für die vollständige Begründung.
    async updateMe(userId: string, patch: { name?: string; locale?: string }) {
      const current = await deps.users.findById(userId);
      if (!current) throw new UserNotFoundError();

      const updated = await deps.users.update(userId, patch);
      // enabledModules mitgegeben (wie getMe()): state.js ersetzt `current`
      // nach einem Profil-Update komplett durch diese Antwort (siehe
      // updateProfile()) — ohne dieses Feld ginge die zuvor bei
      // Login/Refresh geladene Modul-Information dabei verloren.
      const clubContext = await resolveClubContext(deps.clubs, updated.clubId);
      return { ...toPublicUser(updated), ...clubContext };
    },

    // Art. 15 DSGVO (Recht auf Auskunft): bündelt den eigenen Nutzer-
    // Datensatz sowie — falls über athleteId verknüpft — das
    // Athletenprofil und dessen Ergebnisse/Startlisteneinträge/
    // Handlungsfelder/Anwesenheitseinträge.
    async exportMyData(userId: string) {
      return deps.profileGateway.exportUserData(userId);
    },

    // Art. 17 DSGVO (Recht auf Löschung): sofortiger Soft-Delete von
    // Konto + verknüpften fachlichen Daten, Widerruf aller Sitzungen
    // (Refresh Tokens), und Planung des endgültigen, unwiderruflichen
    // Hard-Purge nach der Aufbewahrungsfrist (siehe
    // jobs/purgeExpiredDeletions.ts).
    async requestAccountDeletion(userId: string) {
      const request = await deps.profileGateway.requestErasure(userId, deps.dataErasureRetentionDays);
      await deps.refreshTokens.revokeAllForUser(userId);
      return { purgeAfter: request.purgeAfter };
    },

    // GET /api/users — Nutzerverwaltung: bestehende Vereinsmitglieder
    // anzeigen. admin sieht immer den eigenen Verein (eine mitgeschickte
    // abweichende clubId wird ignoriert, analog zu createInvitation());
    // superadmin gehört zu keinem Verein und muss die clubId daher
    // explizit angeben.
    async listClubMembers(requester: { roles: string[]; clubId: string | null }, requestedClubId?: string) {
      const clubId = requester.roles.includes('superadmin') ? requestedClubId : requester.clubId;
      if (!clubId) throw new ClubIdRequiredError();

      // Sortiert nach der jeweils HÖCHSTEN Rolle einer Person (docs/
      // kampfrichter-modul-plan.md, Abschnitt 1.4) — reine Anzeige-/
      // Gruppierungslogik, keine Berechtigung. Ein Konto mit mehreren
      // Rollen (z. B. trainer + athlete) erscheint dadurch in derselben
      // Gruppe wie ein reiner Trainer.
      // docs/kampfrichter-modul-plan.md, Abschnitt 1.4: "referee" reiht
      // sich zwischen trainer und athlete ein (admin > trainer > referee >
      // athlete).
      const rolePriority: Record<string, number> = { admin: 0, trainer: 1, referee: 2, athlete: 3, superadmin: 4 };
      const bestPriority = (roles: string[]) => Math.min(...roles.map((r) => rolePriority[r] ?? 9), 9);
      return listMembers(clubId, {
        compare: (a, b) => {
          const roleDiff = bestPriority(a.roles) - bestPriority(b.roles);
          return roleDiff !== 0 ? roleDiff : a.name.localeCompare(b.name);
        },
        project: toPublicUser,
      });
    },

    // GET /api/users/trainers — mögliche Zuständige für ein Handlungsfeld
    // (siehe ActionItem.assignedTrainerId): Trainer:innen UND Admins des
    // eigenen Vereins, da ein Handlungsfeld auch von einem Admin erfasst
    // werden kann und der/die Erfasser:in dann standardmäßig selbst
    // zuständig ist (siehe apps/web/js/modules/actionItems.js). Anders als
    // listClubMembers() ohne clubId-Parameter — die Rolle "trainer" darf
    // (anders als admin/superadmin) keinen fremden Verein abfragen, und
    // beide anfragenden Rollen haben stets eine eigene clubId.
    async listAssignableTrainers(requester: { clubId: string | null }) {
      if (!requester.clubId) throw new ClubIdRequiredError();

      return listMembers(requester.clubId, {
        filter: (u) => u.roles.includes('trainer') || u.roles.includes('admin'),
        compare: (a, b) => a.name.localeCompare(b.name),
        // Sicherheitsreview 2026-08-27, Befund N6: schmale Projektion
        // statt toPublicUser() — siehe Kommentar bei listMembers() oben.
        project: (u) => ({ id: u.id, name: u.name, roles: u.roles }),
      });
    },

    // PATCH /api/users/:userId/roles — admin, eigener Verein (docs/
    // kampfrichter-modul-plan.md, Abschnitt 1.4). Ersetzt die vollständige
    // Rollenmenge einer Person (kein Add/Remove-Diff, siehe
    // UpdateUserRolesRequestSchema-Kommentar in shared-types) und widerruft
    // danach ALLE Sitzungen der Zielperson: ohne das bliebe eine entzogene
    // Rolle bis zu JWT_REFRESH_TTL_DAYS (Standard 30 Tage) lang wirksam,
    // weil das Access Token die Rollen zum Ausstellzeitpunkt einfriert und
    // ein Refresh sie unverändert erneuert (analog revokeAllForUser() bei
    // der DSGVO-Löschung/einem Passwortwechsel).
    async updateUserRoles(targetUserId: string, roles: string[], requester: { clubId: string | null }) {
      if (roles.includes('superadmin')) throw new CannotAssignSuperadminError();
      if (!requester.clubId) throw new ClubIdRequiredError();

      const target = await deps.users.findById(targetUserId);
      if (!target) throw new UserNotFoundError();
      if (target.clubId !== requester.clubId) throw new ForeignClubUserError();

      // Entzieht diese Änderung der letzten "admin"-Rolle im Verein?
      // Geprüft anhand des AKTUELLEN Bestands (vor dieser Änderung) — ein
      // Verein mit z. B. zwei Admins darf einem von beiden die Rolle
      // problemlos entziehen.
      if (target.roles.includes('admin') && !roles.includes('admin')) {
        const members = await deps.users.listByClub(requester.clubId);
        const remainingAdmins = members.filter((m) => m.id !== targetUserId && m.roles.includes('admin'));
        if (remainingAdmins.length === 0) throw new LastAdminError();
      }

      const updated = await deps.users.update(targetUserId, { roles });
      await deps.refreshTokens.revokeAllForUser(targetUserId);
      return toPublicUser(updated);
    },
  };
}

export type AuthService = ReturnType<typeof createAuthService>;
