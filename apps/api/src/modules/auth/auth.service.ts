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
import type { InvitationRepository } from '../invitations/invitations.repository.js';
import type { ProfileDataGateway } from '../profile/profile.repository.js';
import { hashPassword, verifyPassword } from '../../auth/password.js';
import { signAccessToken, generateRefreshToken, hashRefreshToken, hashInvitationToken } from '../../auth/tokens.js';
import type { KeyPair } from '../../auth/keys.js';

export class EmailAlreadyRegisteredError extends Error {
  constructor() {
    super('Diese E-Mail-Adresse ist bereits registriert.');
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

export interface AuthServiceDeps {
  users: UserRepository;
  refreshTokens: RefreshTokenRepository;
  invitations: InvitationRepository;
  profileGateway: ProfileDataGateway;
  dataErasureRetentionDays: number;
  keyPair: KeyPair;
  accessTtlSeconds: number;
  refreshTtlDays: number;
}

export function toPublicUser(user: UserRecord) {
  const { passwordHash: _passwordHash, ...publicUser } = user;
  return publicUser;
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

  return {
    // Ersetzt das frühere offene register(): ein Konto entsteht nur durch
    // Einlösen einer gültigen Einladung. Name und Passwort kommen vom
    // Client, E-Mail/Rolle/Verein/athleteId stammen bewusst AUSSCHLIESSLICH
    // aus der serverseitig gespeicherten Einladung — ein manipulierter
    // Client könnte sich sonst z. B. selbst die Rolle "admin" zuweisen.
    async acceptInvitation(input: AcceptInvitationRequest) {
      const tokenHash = hashInvitationToken(input.token);
      const invitation = await deps.invitations.findByTokenHash(tokenHash);
      if (!invitation) throw new InvalidInvitationError();
      if (invitation.revokedAt) throw new InvalidInvitationError('Diese Einladung wurde widerrufen.');
      if (invitation.usedAt) throw new InvalidInvitationError('Diese Einladung wurde bereits verwendet.');
      if (invitation.expiresAt.getTime() < Date.now()) throw new InvalidInvitationError('Diese Einladung ist abgelaufen.');

      const existingUser = await deps.users.findByEmail(invitation.email);
      if (existingUser) throw new EmailAlreadyRegisteredError();

      const passwordHash = await hashPassword(input.password);
      const user = await deps.users.create({
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
      await deps.invitations.markUsed(invitation.id);

      const tokens = await issueTokens(user);
      return { ...tokens, user: toPublicUser(user) };
    },

    async login(input: LoginRequest) {
      const user = await deps.users.findByEmail(input.email); // findByEmail liefert nie gelöschte Konten
      if (!user) throw new InvalidCredentialsError();

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
      return { ...tokens, user: toPublicUser(updated) };
    },

    async refresh(plainRefreshToken: string) {
      const tokenHash = hashRefreshToken(plainRefreshToken);
      const existing = await deps.refreshTokens.findByHash(tokenHash);
      if (!existing) throw new InvalidRefreshTokenError();
      if (existing.revokedAt) throw new InvalidRefreshTokenError();
      if (existing.expiresAt.getTime() < Date.now()) throw new InvalidRefreshTokenError();

      const user = await deps.users.findById(existing.userId);
      if (!user) throw new InvalidRefreshTokenError();

      // Rotation: das alte Token wird ungültig, sobald ein neues ausgestellt
      // wurde — ein wiederverwendetes (z. B. gestohlenes) altes Token
      // funktioniert danach nicht mehr.
      await deps.refreshTokens.revoke(existing.id);
      const tokens = await issueTokens(user);
      return { ...tokens, user: toPublicUser(user) };
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
      return toPublicUser(user);
    },

    async updateMe(userId: string, patch: { name?: string; email?: string; locale?: string }) {
      const current = await deps.users.findById(userId);
      if (!current) throw new UserNotFoundError();

      if (patch.email && patch.email !== current.email) {
        const emailTaken = await deps.users.findByEmail(patch.email);
        if (emailTaken) throw new EmailAlreadyRegisteredError();
      }

      const updated = await deps.users.update(userId, patch);
      return toPublicUser(updated);
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

      const users = await deps.users.listByClub(clubId);
      const rolePriority: Record<string, number> = { admin: 0, trainer: 1, athlete: 2, superadmin: 3 };
      const sorted = [...users].sort((a, b) => {
        const roleDiff = (rolePriority[a.role] ?? 9) - (rolePriority[b.role] ?? 9);
        return roleDiff !== 0 ? roleDiff : a.name.localeCompare(b.name);
      });
      return sorted.map(toPublicUser);
    },
  };
}

export type AuthService = ReturnType<typeof createAuthService>;
