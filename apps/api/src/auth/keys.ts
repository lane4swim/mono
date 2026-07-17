// apps/api/src/auth/keys.ts
//
// Löst das RS256-Schlüsselpaar für die Access-Token-Signatur auf.
// Produktion: Pflicht aus der Umgebung (siehe env.ts — loadEnv wirft sonst
// bereits vorher einen Fehler). Entwicklung/Test: wird automatisch ein
// Wegwerf-Schlüsselpaar erzeugt, damit `npm run dev` bzw. die Testsuite
// ohne manuellen `openssl`-Schritt sofort funktionieren.
import { generateKeyPairSync } from 'node:crypto';
import type { Env } from '../config/env.js';

export interface KeyPair {
  privateKey: string;
  publicKey: string;
}

// PEM-Werte werden in der .env mit literalen "\n" statt echten Zeilenumbrüchen
// gespeichert (üblich, da .env-Dateien keine echten Mehrzeiler gut vertragen).
function unescapePem(value: string): string {
  return value.includes('\\n') ? value.replace(/\\n/g, '\n') : value;
}

let cachedDevKeyPair: KeyPair | null = null;

export function resolveKeyPair(env: Env): KeyPair {
  if (env.JWT_PRIVATE_KEY && env.JWT_PUBLIC_KEY) {
    return {
      privateKey: unescapePem(env.JWT_PRIVATE_KEY),
      publicKey: unescapePem(env.JWT_PUBLIC_KEY),
    };
  }

  if (env.NODE_ENV === 'production') {
    // loadEnv() sollte das bereits verhindert haben — zusätzliche
    // Absicherung, falls resolveKeyPair je isoliert aufgerufen wird.
    throw new Error('JWT_PRIVATE_KEY/JWT_PUBLIC_KEY fehlen in Produktion.');
  }

  // Pro Prozess nur einmal erzeugen, damit innerhalb eines Testlaufs/einer
  // Dev-Session ausgestellte Tokens konsistent verifizierbar bleiben.
  if (!cachedDevKeyPair) {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    });
    cachedDevKeyPair = { privateKey, publicKey };
  }
  return cachedDevKeyPair;
}

// Für Tests: erzwingt ein frisches Schlüsselpaar statt des Caches, damit
// Tests, die unterschiedliche Schlüssel brauchen (z. B. "falscher Schlüssel"),
// sich nicht gegenseitig beeinflussen.
export function generateFreshKeyPair(): KeyPair {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  return { privateKey, publicKey };
}
