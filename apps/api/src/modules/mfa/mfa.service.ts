// Verwaltung der Zwei-Faktor-Anmeldung per TOTP (Issue #97): Einrichten,
// Bestätigen, Abschalten, Wiederherstellungscodes, Zurücksetzen durch
// Admins/Superadmins und die Vereinseinstellung "TOTP für Admins
// verlangen". Der zweite Anmeldeschritt selbst liegt in auth.service.ts.
import QRCode from 'qrcode';
import type { MfaRecoveryCodeRepository, RefreshTokenRepository, UserRecord, UserRepository } from '../auth/auth.repository.js';
import type { ClubRepository } from '../invitations/invitations.repository.js';
import type { AuditLogWriter } from '../auditLog/auditLog.service.js';
import type { MailSender } from '../../mail/mailer.js';
import { InvalidCurrentPasswordError, UserNotFoundError } from '../auth/auth.service.js';
import { ForbiddenError, ClubNotFoundError } from '../invitations/invitations.service.js';
import { verifyPassword } from '../../auth/password.js';
import { buildOtpauthUri, generateTotpSecret, verifyTotp } from '../../auth/totp.js';
import { isMfaRequired, MfaNotConfiguredError, type MfaVerifier, type SecondFactorInput } from './mfa.core.js';
import {
  MfaAlreadyEnabledError,
  MfaSetupNotStartedError,
  MfaNotEnabledError,
  InvalidMfaCodeError,
  MfaCodeRequiredError,
  MfaRequiredForActionError,
} from './mfaErrors.js';

export interface MfaRequester {
  id: string;
  roles: string[];
  clubId: string | null;
}

export interface MfaServiceDeps {
  users: UserRepository;
  recoveryCodes: MfaRecoveryCodeRepository;
  refreshTokens: Pick<RefreshTokenRepository, 'revokeAllForUser'>;
  clubs: Pick<ClubRepository, 'findById' | 'setMfaRequiredForAdmins'>;
  verifier: MfaVerifier;
  auditLog: AuditLogWriter;
  mailer: Pick<MailSender, 'sendAccountSecurityChangeNotice'>;
  // Stellt nach einer Änderung, die alle Sitzungen beendet, ein frisches
  // Token-Paar für die AKTUELLE Sitzung aus (wie changePassword()).
  issueSession: (userId: string) => Promise<unknown>;
  enforce: boolean;
  issuer: string;
}

export function createMfaService(deps: MfaServiceDeps) {
  async function requireUser(userId: string): Promise<UserRecord> {
    const user = await deps.users.findById(userId);
    if (!user) throw new UserNotFoundError();
    return user;
  }

  async function requirePassword(user: UserRecord, currentPassword: string): Promise<void> {
    if (!(await verifyPassword(currentPassword, user.passwordHash))) throw new InvalidCurrentPasswordError();
  }

  // Zweiter Faktor der handelnden Person — nur, wenn sie TOTP nutzt.
  async function requireOwnSecondFactor(user: UserRecord, input: SecondFactorInput): Promise<void> {
    if (!user.totpEnabledAt) return;
    if (!input.code && !input.recoveryCode) throw new MfaCodeRequiredError();
    if (!(await deps.verifier.verifySecondFactor(user, input))) throw new InvalidMfaCodeError();
  }

  function notify(user: UserRecord, changeType: 'mfa' | 'recoveryCodesRegenerated' = 'mfa'): void {
    deps.mailer
      .sendAccountSecurityChangeNotice({ to: user.email, recipientName: user.name, changeType, locale: user.locale })
      .catch((err) => {
        console.error('[mfa] Fehler beim Versand des Sicherheitshinweises:', err);
      });
  }

  async function newRecoveryCodes(userId: string): Promise<string[]> {
    const { codes, hashes } = deps.verifier.generateRecoveryCodes(userId);
    await deps.recoveryCodes.replaceAll(userId, hashes);
    return codes;
  }

  return {
    async status(userId: string) {
      const user = await requireUser(userId);
      const club = user.clubId ? await deps.clubs.findById(user.clubId) : null;
      return {
        available: deps.verifier.isAvailable(),
        enabled: Boolean(user.totpEnabledAt),
        required: isMfaRequired(user, club, deps.enforce),
        enforced: deps.enforce,
        recoveryCodesRemaining: user.totpEnabledAt ? await deps.recoveryCodes.countUnused(user.id) : 0,
        // Vereinseinstellung "TOTP für Admins verlangen" (null ohne Verein) —
        // für die Anzeige im Verein-Reiter; unabhängig von MFA_ENFORCE.
        clubRequiresAdminMfa: club ? Boolean(club.mfaRequiredForAdmins) : null,
      };
    },

    // Neues, noch unbestätigtes Secret. Ein erneuter Aufruf ersetzt ein
    // unbestätigtes Secret (z. B. QR-Code nicht gescannt).
    async beginSetup(userId: string) {
      if (!deps.verifier.isAvailable()) throw new MfaNotConfiguredError();
      const user = await requireUser(userId);
      if (user.totpEnabledAt) throw new MfaAlreadyEnabledError();
      const secret = generateTotpSecret();
      if (!(await deps.users.setPendingTotpSecret(user.id, deps.verifier.sealSecret(secret)))) throw new MfaAlreadyEnabledError();
      const otpauthUri = buildOtpauthUri(secret, user.email, deps.issuer);
      const qrSvg = await QRCode.toString(otpauthUri, { type: 'svg', errorCorrectionLevel: 'M', margin: 1 });
      return { secret, otpauthUri, qrSvg };
    },

    // Aktiviert TOTP mit einem ersten gültigen Code. Beendet alle anderen
    // Sitzungen und stellt für die aktuelle ein frisches Token-Paar aus.
    // Verlangt das aktuelle Passwort (wie Passwort- und E-Mail-Wechsel): mit
    // nur einem entwendeten Access Token ließe sich sonst TOTP einrichten und
    // die rechtmäßige Person dauerhaft aussperren.
    async confirmSetup(userId: string, code: string, currentPassword: string) {
      const user = await requireUser(userId);
      if (user.totpEnabledAt) throw new MfaAlreadyEnabledError();
      await requirePassword(user, currentPassword);
      if (!user.totpSecretEnc) throw new MfaSetupNotStartedError();
      const step = verifyTotp(deps.verifier.openSecret(user.totpSecretEnc), code);
      if (step === null) throw new InvalidMfaCodeError();
      if (!(await deps.users.enableTotp(user.id, step))) throw new MfaAlreadyEnabledError();
      const recoveryCodes = await newRecoveryCodes(user.id);
      await deps.refreshTokens.revokeAllForUser(user.id);
      await deps.auditLog.record({ clubId: user.clubId, actorId: user.id, action: 'mfa.enabled', targetId: user.id });
      notify(user);
      return { recoveryCodes, session: await deps.issueSession(user.id) };
    },

    // Abschalten durch die Person selbst: Passwort UND ein zweiter Faktor.
    // (Die Pflicht nach Rolle/Verein verhindert das erst ab PR 3 des Plans.)
    async disable(userId: string, currentPassword: string, secondFactor: SecondFactorInput) {
      const user = await requireUser(userId);
      if (!user.totpEnabledAt) throw new MfaNotEnabledError();
      await requirePassword(user, currentPassword);
      await requireOwnSecondFactor(user, secondFactor);
      await deps.users.clearTotp(user.id);
      await deps.recoveryCodes.deleteAll(user.id);
      await deps.refreshTokens.revokeAllForUser(user.id);
      await deps.auditLog.record({ clubId: user.clubId, actorId: user.id, action: 'mfa.disabled', targetId: user.id });
      notify(user);
      return { session: await deps.issueSession(user.id) };
    },

    async regenerateRecoveryCodes(userId: string, secondFactor: SecondFactorInput) {
      const user = await requireUser(userId);
      if (!user.totpEnabledAt) throw new MfaNotEnabledError();
      await requireOwnSecondFactor(user, secondFactor);
      const recoveryCodes = await newRecoveryCodes(user.id);
      await deps.auditLog.record({ clubId: user.clubId, actorId: user.id, action: 'mfa.recoveryCodesRegenerated', targetId: user.id });
      notify(user, 'recoveryCodesRegenerated');
      return { recoveryCodes };
    },

    // Zurücksetzen für eine andere Person (verlorenes Gerät). Superadmin:
    // jede Person; Admin: Personen des eigenen Vereins, außer Superadmins.
    // Nie das eigene Konto — dafür gibt es Wiederherstellungscodes und
    // disable(). Die handelnde Person bestätigt mit Passwort und, falls sie
    // selbst TOTP nutzt, mit einem Code.
    async resetForUser(targetUserId: string, requester: MfaRequester, currentPassword: string, secondFactor: SecondFactorInput) {
      if (targetUserId === requester.id) throw new ForbiddenError('Die eigene Zwei-Faktor-Anmeldung lässt sich nicht auf diesem Weg zurücksetzen.');
      const isSuperadmin = requester.roles.includes('superadmin');
      if (!isSuperadmin && !requester.roles.includes('admin')) {
        throw new ForbiddenError('Nur Admins und Superadmins dürfen die Zwei-Faktor-Anmeldung zurücksetzen.');
      }
      const target = await requireUser(targetUserId);
      if (!isSuperadmin && (target.clubId === null || target.clubId !== requester.clubId || target.roles.includes('superadmin'))) {
        throw new ForbiddenError('Diese Person gehört nicht zu Ihrem Verein.');
      }
      const actor = await requireUser(requester.id);
      await requirePassword(actor, currentPassword);
      await requireOwnSecondFactor(actor, secondFactor);
      if (!target.totpEnabledAt && !target.totpSecretEnc) throw new MfaNotEnabledError();

      await deps.users.clearTotp(target.id);
      await deps.recoveryCodes.deleteAll(target.id);
      await deps.refreshTokens.revokeAllForUser(target.id);
      await deps.auditLog.record({ clubId: target.clubId, actorId: actor.id, action: 'mfa.reset', targetId: target.id });
      notify(target);
    },

    // "TOTP für alle Admins dieses Vereins verlangen". Superadmin: jeder
    // Verein; Admin: der eigene. Einschalten nur mit eigenem, aktivem TOTP;
    // jede Änderung mit Passwort (und Code, falls TOTP aktiv).
    async setClubAdminRequirement(
      clubId: string,
      required: boolean,
      requester: MfaRequester,
      currentPassword: string,
      secondFactor: SecondFactorInput,
    ) {
      const isSuperadmin = requester.roles.includes('superadmin');
      if (!isSuperadmin && !(requester.roles.includes('admin') && requester.clubId === clubId)) {
        throw new ForbiddenError('Nur Admins des eigenen Vereins oder Superadmins dürfen diese Einstellung ändern.');
      }
      const club = await deps.clubs.findById(clubId);
      if (!club) throw new ClubNotFoundError();
      const actor = await requireUser(requester.id);
      if (required && !actor.totpEnabledAt) throw new MfaRequiredForActionError();
      await requirePassword(actor, currentPassword);
      await requireOwnSecondFactor(actor, secondFactor);

      const updated = await deps.clubs.setMfaRequiredForAdmins(clubId, required);
      if (Boolean(club.mfaRequiredForAdmins) !== required) {
        await deps.auditLog.record({
          clubId,
          actorId: actor.id,
          action: 'club.mfaPolicyChanged',
          targetId: clubId,
          targetLabel: club.name,
          metadata: { requiredForAdmins: required },
        });
      }
      return { mfaRequiredForAdmins: Boolean(updated.mfaRequiredForAdmins) };
    },
  };
}

export type MfaService = ReturnType<typeof createMfaService>;
