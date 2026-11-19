// Kontoweite Grenze für falsche Codes der Zwei-Faktor-Anmeldung (Issue #109).
//
// Die Grenze je mfaToken (mfaChallenges.ts) allein reicht nicht: wer das
// Passwort kennt, holt sich per POST /auth/login beliebig viele neue
// mfaTokens. Gezählt wird deshalb je Konto in der Datenbank: nach
// MFA_LOCK_THRESHOLD Fehlversuchen innerhalb von MFA_FAILURE_WINDOW_MS ist
// der zweite Faktor gesperrt — es werden keine mfaTokens mehr ausgegeben
// und keine Codes mehr geprüft. Jede weitere Sperre ohne zwischenzeitlichen
// Erfolg dauert doppelt so lange, höchstens MFA_LOCK_MAX_MS.
//
// Ein erfolgreicher zweiter Faktor setzt alles zurück, ebenso jedes
// Zurücksetzen/Abschalten von TOTP (UserRepository.clearTotp()).
//
// Die Sperre ist ein Hebel für eine Aussperrung durch jemanden, der das
// Passwort (oder beim Reset das Postfach) schon hat. Das ist in Kauf
// genommen: die Hinweis-Mail bei einer Sperre rät, das Passwort zu ändern.
export const MFA_LOCK_THRESHOLD = 10;
export const MFA_FAILURE_WINDOW_MS = 15 * 60 * 1000;
export const MFA_LOCK_BASE_MS = 15 * 60 * 1000;
export const MFA_LOCK_MAX_MS = 24 * 60 * 60 * 1000;

export interface MfaFailureState {
  mfaFailedCount: number;
  mfaFailedWindowStart: Date | null;
  mfaLockedUntil: Date | null;
  mfaLockoutCount: number;
}

export const CLEARED_MFA_FAILURE_STATE: MfaFailureState = {
  mfaFailedCount: 0,
  mfaFailedWindowStart: null,
  mfaLockedUntil: null,
  mfaLockoutCount: 0,
};

export function isMfaLocked(state: { mfaLockedUntil?: Date | null }, now: Date): boolean {
  return state.mfaLockedUntil != null && state.mfaLockedUntil.getTime() > now.getTime();
}

export function lockDurationMs(previousLockouts: number): number {
  return Math.min(MFA_LOCK_BASE_MS * 2 ** Math.min(previousLockouts, 16), MFA_LOCK_MAX_MS);
}

// Zustand nach einem weiteren Fehlversuch. `newlyLocked`: dieser Versuch
// hat die Sperre ausgelöst (für Hinweis-Mail und Audit-Eintrag).
// Während einer Sperre (gleichzeitige Anfragen) zählt nichts weiter.
export function nextMfaFailureState(current: MfaFailureState, now: Date): { state: MfaFailureState; newlyLocked: boolean } {
  if (isMfaLocked(current, now)) return { state: current, newlyLocked: false };
  const windowStart = current.mfaFailedWindowStart;
  const windowOpen = windowStart !== null && now.getTime() - windowStart.getTime() < MFA_FAILURE_WINDOW_MS;
  const count = windowOpen ? current.mfaFailedCount + 1 : 1;
  if (count < MFA_LOCK_THRESHOLD) {
    return {
      state: { ...current, mfaFailedCount: count, mfaFailedWindowStart: windowOpen ? windowStart : now },
      newlyLocked: false,
    };
  }
  return {
    state: {
      mfaFailedCount: 0,
      mfaFailedWindowStart: null,
      mfaLockedUntil: new Date(now.getTime() + lockDurationMs(current.mfaLockoutCount)),
      mfaLockoutCount: current.mfaLockoutCount + 1,
    },
    newlyLocked: true,
  };
}
