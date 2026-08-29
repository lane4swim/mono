// apps/api/src/auth/keys.ts
//
// Löst das RS256-Schlüsselpaar für die Access-Token-Signatur auf.
// Produktion: Pflicht aus der Umgebung, je Schlüssel entweder als
// Inline-PEM (JWT_PRIVATE_KEY/JWT_PUBLIC_KEY) oder als Dateipfad
// (JWT_PRIVATE_KEY_FILE/JWT_PUBLIC_KEY_FILE, Sicherheitsreview
// 2026-08-28, Befund H2, Empfehlung 3) — loadEnv() (config/env.ts) hat
// bereits geprüft, dass je Schlüssel GENAU EINE der beiden Formen gesetzt
// ist, bevor diese Funktion je aufgerufen wird. Entwicklung/Test: wird
// automatisch ein Wegwerf-Schlüsselpaar erzeugt, damit `npm run dev` bzw.
// die Testsuite ohne manuellen `openssl`-Schritt sofort funktionieren.
import { generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { Env } from '../config/env.js';

export interface KeyPair {
  privateKey: string;
  publicKey: string;
}

// PEM-Werte werden in der .env mit literalen "\n" statt echten Zeilenumbrüchen
// gespeichert (üblich, da .env-Dateien keine echten Mehrzeiler gut vertragen).
// Bei einer Datei (JWT_*_KEY_FILE) ist das normalerweise nicht nötig — echte
// Zeilenumbrüche in einer Datei sind kein Problem —, der Aufruf bleibt hier
// trotzdem bestehen: `unescapePem()` greift nur, wenn der Inhalt tatsächlich
// ein literales "\n" enthält, und ist damit für bereits korrekt formatierte
// Dateiinhalte ein No-op.
function unescapePem(value: string): string {
  return value.includes('\\n') ? value.replace(/\\n/g, '\n') : value;
}

// Liest eine PEM-Datei (JWT_PRIVATE_KEY_FILE/JWT_PUBLIC_KEY_FILE). Ein
// nicht lesbarer Pfad (Tippfehler, falsche Rechte fürs Dienstkonto, Datei
// fehlt) soll den Start mit einer eindeutig auf die verantwortliche
// Variable zurückführbaren Fehlermeldung abbrechen, statt Node.js' rohe
// ENOENT-Meldung unkommentiert durchzureichen.
function readPemFile(varName: string, path: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`${varName}=${path} konnte nicht gelesen werden: ${reason}`, { cause: err });
  }
}

// Löst EINEN Schlüssel (privat oder öffentlich) aus den beiden möglichen
// Formen auf — Inline-PEM hat Vorrang vor der Datei rein aus
// Implementierungssicht ohne praktische Bedeutung: env.ts hat bereits
// sichergestellt, dass niemals beide gleichzeitig gesetzt sind.
function resolveKeyValue(varName: string, inline: string | undefined, filePath: string | undefined): string | undefined {
  if (inline) return unescapePem(inline);
  if (filePath) return unescapePem(readPemFile(`${varName}_FILE`, filePath));
  return undefined;
}

let cachedDevKeyPair: KeyPair | null = null;

export function resolveKeyPair(env: Env): KeyPair {
  const privateKey = resolveKeyValue('JWT_PRIVATE_KEY', env.JWT_PRIVATE_KEY, env.JWT_PRIVATE_KEY_FILE);
  const publicKey = resolveKeyValue('JWT_PUBLIC_KEY', env.JWT_PUBLIC_KEY, env.JWT_PUBLIC_KEY_FILE);

  if (privateKey && publicKey) {
    return { privateKey, publicKey };
  }

  if (env.NODE_ENV === 'production') {
    // loadEnv() sollte das bereits verhindert haben — zusätzliche
    // Absicherung, falls resolveKeyPair je isoliert aufgerufen wird.
    throw new Error('JWT_PRIVATE_KEY/JWT_PUBLIC_KEY (bzw. deren _FILE-Variante) fehlen in Produktion.');
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
