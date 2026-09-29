// Löst den Schlüssel für die TOTP-Secrets auf (Issue #97, siehe
// TOTP_ENCRYPTION_KEY in config/env.ts). `null` heißt: TOTP kann auf diesem
// Server nicht eingerichtet werden (Produktion ohne Schlüssel).
import { randomBytes } from 'node:crypto';
import type { Env } from '../config/env.js';
import { parseSecretBoxKey } from './secretBox.js';

export function resolveTotpEncryptionKey(env: Pick<Env, 'NODE_ENV' | 'TOTP_ENCRYPTION_KEY'>): Buffer | null {
  if (env.TOTP_ENCRYPTION_KEY) return parseSecretBoxKey(env.TOTP_ENCRYPTION_KEY);
  if (env.NODE_ENV === 'production') return null;
  // Wie das Wegwerf-Schlüsselpaar für JWTs in auth/keys.ts: in der
  // Entwicklung ohne Konfiguration lauffähig. Eingerichtete TOTP-Secrets
  // sind nach einem Neustart allerdings nicht mehr lesbar.
  if (env.NODE_ENV === 'development') {
    console.warn('[mfa] TOTP_ENCRYPTION_KEY nicht gesetzt — Wegwerf-Schlüssel für diesen Prozess (TOTP-Einrichtungen überstehen keinen Neustart).');
  }
  return randomBytes(32);
}
