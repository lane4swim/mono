// Gemeinsame Bausteine der Zwei-Faktor-Anmeldung (Issue #97), genutzt vom
// Anmeldeablauf (auth.service.ts) und von der Verwaltung (mfa.service.ts).
import { createHash, randomInt } from 'node:crypto';
import type { MfaRecoveryCodeRepository, UserRecord, UserRepository } from '../auth/auth.repository.js';
import { open, seal } from '../../auth/secretBox.js';
import { verifyTotp } from '../../auth/totp.js';

export const RECOVERY_CODE_COUNT = 10;
// Ohne leicht verwechselbare Zeichen (0/o, 1/l/i). 10 Zeichen aus 31 ≈ 49 Bit
// je Code — zusammen mit der Fehlversuchs-Grenze je Anmeldung reichlich.
const RECOVERY_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

export class MfaNotConfiguredError extends Error {
  constructor() {
    super('Die Zwei-Faktor-Anmeldung ist auf diesem Server nicht eingerichtet (TOTP_ENCRYPTION_KEY fehlt).');
  }
}

export function normalizeRecoveryCode(code: string): string {
  return code.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function hashRecoveryCode(code: string): string {
  return createHash('sha256').update(normalizeRecoveryCode(code)).digest('hex');
}

// Klartext wird genau einmal an die Person ausgegeben, gespeichert werden nur
// die Hashes.
export function generateRecoveryCodes(): { codes: string[]; hashes: string[] } {
  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, () => {
    const chars = Array.from({ length: 10 }, () => RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)]).join('');
    return `${chars.slice(0, 5)}-${chars.slice(5)}`;
  });
  return { codes, hashes: codes.map(hashRecoveryCode) };
}

// Ob TOTP für diese Person Pflicht ist: Superadmins immer, Admins nur in
// Vereinen mit mfaRequiredForAdmins — beides nur bei MFA_ENFORCE.
// Hinweis: PR 1 berechnet die Pflicht nur (Status-Anzeige); erzwungen wird
// sie erst mit der Oberfläche (Plan, PR 3).
export function isMfaRequired(
  user: Pick<UserRecord, 'roles'>,
  club: { mfaRequiredForAdmins?: boolean } | null,
  enforce: boolean,
): boolean {
  if (!enforce) return false;
  if (user.roles.includes('superadmin')) return true;
  return user.roles.includes('admin') && Boolean(club?.mfaRequiredForAdmins);
}

export interface MfaVerifierDeps {
  users: Pick<UserRepository, 'recordTotpStep'>;
  recoveryCodes: Pick<MfaRecoveryCodeRepository, 'consume'>;
  // null: TOTP ist auf diesem Server nicht verfügbar (siehe auth/mfaKey.ts).
  encryptionKey: Buffer | null;
}

export type SecondFactorInput = { code?: string; recoveryCode?: string };

export function createMfaVerifier(deps: MfaVerifierDeps) {
  function requireKey(): Buffer {
    if (!deps.encryptionKey) throw new MfaNotConfiguredError();
    return deps.encryptionKey;
  }

  return {
    isAvailable: () => deps.encryptionKey !== null,
    sealSecret: (secret: string) => seal(secret, requireKey()),
    openSecret: (secretEnc: string) => open(secretEnc, requireKey()),

    // Prüft einen TOTP-Code (oder einen Wiederherstellungscode) für eine
    // Person mit aktivem TOTP und verbraucht ihn atomar. Liefert, womit die
    // Anmeldung bestätigt wurde, oder null.
    async verifySecondFactor(user: UserRecord, input: SecondFactorInput): Promise<'totp' | 'recovery' | null> {
      if (!user.totpEnabledAt || !user.totpSecretEnc) return null;
      if (input.recoveryCode) {
        return (await deps.recoveryCodes.consume(user.id, hashRecoveryCode(input.recoveryCode))) ? 'recovery' : null;
      }
      if (!input.code) return null;
      const step = verifyTotp(open(user.totpSecretEnc, requireKey()), input.code, { lastUsedStep: user.totpLastUsedStep });
      if (step === null) return null;
      // Atomar: zwei gleichzeitige Anmeldungen mit demselben Code können
      // nicht beide durchkommen.
      return (await deps.users.recordTotpStep(user.id, step)) ? 'totp' : null;
    },
  };
}

export type MfaVerifier = ReturnType<typeof createMfaVerifier>;
