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
import type { UserRepository, RefreshTokenRepository, UserRecord } from './auth.repository.js';
import type { InvitationRecord } from '../invitations/invitations.repository.js';
import {
  InvitationNotFoundError,
  InvitationRevokedError,
  InvitationAlreadyUsedError,
  InvitationExpiredError,
} from '../invitations/invitations.service.js';
import type { ProfileDataGateway } from '../profile/profile.repository.js';
import { hashPassword, verifyPassword } from '../../auth/password.js';
import { signAccessToken, generateRefreshToken, hashRefreshToken } from '../../auth/tokens.js';
import type { KeyPair } from '../../auth/keys.js';

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
// resolveEnabledModules() unten).
export interface ClubModulesLookup {
  findById(clubId: string): Promise<{ enabledModules: string[] } | null>;
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
}

export function toPublicUser(user: UserRecord) {
  const { passwordHash: _passwordHash, ...publicUser } = user;
  return publicUser;
}

// null nur für "superadmin" (gehört zu keinem Verein, siehe
// UserRecord.clubId-Kommentar) — liefert dafür konsequent ein leeres
// Array statt eines Fehlers, die Superadmin-Oberfläche ("/admin") nutzt
// den normalen Router mit Modul-Gating ohnehin nicht.
async function resolveEnabledModules(clubs: ClubModulesLookup, clubId: string | null): Promise<string[]> {
  if (!clubId) return [];
  const club = await clubs.findById(clubId);
  return club?.enabledModules ?? [];
}

export function createAuthService(deps: AuthServiceDeps) {
  async function issueTokens(user: UserRecord): Promise<AuthTokens> {
    const claims: AccessTokenClaims = {
      sub: user.id,
      role: user.role as AccessTokenClaims['role'],
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
  async function listMembers(
    clubId: string,
    { filter, compare }: { filter?: (user: UserRecord) => boolean; compare: (a: UserRecord, b: UserRecord) => number },
  ) {
    const users = await deps.users.listByClub(clubId);
    const scoped = filter ? users.filter(filter) : users;
    const sorted = [...scoped].sort(compare);
    return sorted.map(toPublicUser);
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
          role: invitation.role,
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
      const enabledModules = await resolveEnabledModules(deps.clubs, user.clubId);
      return { ...tokens, user: toPublicUser(user), enabledModules };
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

      // input.consent ist bereits durch LoginRequestSchema (consent:
      // z.literal(true)) erzwungen — jeder Login aktualisiert den
      // Nachweis-Zeitstempel/die -Version erneut (z. B. nach einer
      // geänderten Datenschutzerklärung).
      const updated = await deps.users.update(user.id, {
        consentGivenAt: new Date(),
        consentVersion: CURRENT_CONSENT_VERSION,
      });

      const tokens = await issueTokens(updated);
      const enabledModules = await resolveEnabledModules(deps.clubs, updated.clubId);
      return { ...tokens, user: toPublicUser(updated), enabledModules };
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
      const enabledModules = await resolveEnabledModules(deps.clubs, user.clubId);
      return { ...tokens, user: toPublicUser(user), enabledModules };
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

    async getMe(userId: string) {
      const user = await deps.users.findById(userId);
      if (!user) throw new UserNotFoundError();
      const enabledModules = await resolveEnabledModules(deps.clubs, user.clubId);
      return { ...toPublicUser(user), enabledModules };
    },

    async updateMe(userId: string, patch: { name?: string; email?: string; locale?: string }) {
      const current = await deps.users.findById(userId);
      if (!current) throw new UserNotFoundError();

      if (patch.email && patch.email !== current.email) {
        const emailTaken = await deps.users.findByEmail(patch.email);
        if (emailTaken) throw new EmailAlreadyRegisteredError();
      }

      const updated = await deps.users.update(userId, patch);
      // enabledModules mitgegeben (wie getMe()): state.js ersetzt `current`
      // nach einem Profil-Update komplett durch diese Antwort (siehe
      // updateProfile()) — ohne dieses Feld ginge die zuvor bei
      // Login/Refresh geladene Modul-Information dabei verloren.
      const enabledModules = await resolveEnabledModules(deps.clubs, updated.clubId);
      return { ...toPublicUser(updated), enabledModules };
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
    async listClubMembers(requester: { role: string; clubId: string | null }, requestedClubId?: string) {
      const clubId = requester.role === 'superadmin' ? requestedClubId : requester.clubId;
      if (!clubId) throw new ClubIdRequiredError();

      const rolePriority: Record<string, number> = { admin: 0, trainer: 1, athlete: 2, superadmin: 3 };
      return listMembers(clubId, {
        compare: (a, b) => {
          const roleDiff = (rolePriority[a.role] ?? 9) - (rolePriority[b.role] ?? 9);
          return roleDiff !== 0 ? roleDiff : a.name.localeCompare(b.name);
        },
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
        filter: (u) => u.role === 'trainer' || u.role === 'admin',
        compare: (a, b) => a.name.localeCompare(b.name),
      });
    },
  };
}

export type AuthService = ReturnType<typeof createAuthService>;
