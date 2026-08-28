// apps/api/test/auth/keys.test.ts
//
// Regressionstests für Sicherheitsreview 2026-08-28, Befund H2,
// Empfehlung 3: resolveKeyPair() muss das RS256-Schlüsselpaar sowohl aus
// den bisherigen Inline-PEM-Variablen (JWT_PRIVATE_KEY/JWT_PUBLIC_KEY) als
// auch aus den neuen Dateipfad-Varianten (JWT_PRIVATE_KEY_FILE/
// JWT_PUBLIC_KEY_FILE) auflösen können — beliebig gemischt, je Schlüssel
// unabhängig gewählt (env.ts stellt bereits sicher, dass niemals beide
// Formen für DENSELBEN Schlüssel gleichzeitig gesetzt sind, siehe
// env.test.ts).
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveKeyPair, generateFreshKeyPair } from '../../src/auth/keys.js';
import { loadEnv } from '../../src/config/env.js';

const baseEnv = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/lane1',
  CORS_ORIGIN: 'https://training.example.org',
  TRUSTED_PROXY_IPS: '127.0.0.1',
};

// Eigenes Verzeichnis je Testlauf statt eines gemeinsamen — verhindert,
// dass parallel laufende Tests sich gegenseitig Dateien überschreiben.
let tmpDirs: string[] = [];
function makeTmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'lane1-jwt-keys-test-'));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true });
  tmpDirs = [];
});

describe('resolveKeyPair', () => {
  it('löst das Schlüsselpaar aus der Inline-Form (JWT_PRIVATE_KEY/JWT_PUBLIC_KEY) auf', () => {
    const { privateKey, publicKey } = generateFreshKeyPair();
    const env = loadEnv({ ...baseEnv, JWT_PRIVATE_KEY: privateKey, JWT_PUBLIC_KEY: publicKey });

    const resolved = resolveKeyPair(env);
    expect(resolved.privateKey).toBe(privateKey);
    expect(resolved.publicKey).toBe(publicKey);
  });

  it('löst das Schlüsselpaar aus der Datei-Form (JWT_PRIVATE_KEY_FILE/JWT_PUBLIC_KEY_FILE) auf', () => {
    const { privateKey, publicKey } = generateFreshKeyPair();
    const dir = makeTmpDir();
    const privatePath = join(dir, 'jwt_private.pem');
    const publicPath = join(dir, 'jwt_public.pem');
    writeFileSync(privatePath, privateKey, 'utf8');
    writeFileSync(publicPath, publicKey, 'utf8');
    chmodSync(privatePath, 0o600);

    const env = loadEnv({ ...baseEnv, JWT_PRIVATE_KEY_FILE: privatePath, JWT_PUBLIC_KEY_FILE: publicPath });

    const resolved = resolveKeyPair(env);
    expect(resolved.privateKey).toBe(privateKey);
    expect(resolved.publicKey).toBe(publicKey);
  });

  it('löst gemischte Formen auf — privat per Datei, öffentlich inline', () => {
    const { privateKey, publicKey } = generateFreshKeyPair();
    const dir = makeTmpDir();
    const privatePath = join(dir, 'jwt_private.pem');
    writeFileSync(privatePath, privateKey, 'utf8');

    const env = loadEnv({ ...baseEnv, JWT_PRIVATE_KEY_FILE: privatePath, JWT_PUBLIC_KEY: publicKey });

    const resolved = resolveKeyPair(env);
    expect(resolved.privateKey).toBe(privateKey);
    expect(resolved.publicKey).toBe(publicKey);
  });

  it('wandelt literale "\\n"-Sequenzen in einer PEM-Datei korrekt in echte Zeilenumbrüche um (Kompatibilität mit der Inline-Form)', () => {
    const { privateKey, publicKey } = generateFreshKeyPair();
    const dir = makeTmpDir();
    const privatePath = join(dir, 'jwt_private.pem');
    // Simuliert eine versehentlich wie die Inline-Form escapte Datei (z. B.
    // aus einer bestehenden .env kopiert) — unescapePem() greift auch hier.
    writeFileSync(privatePath, privateKey.replace(/\n/g, '\\n'), 'utf8');

    const env = loadEnv({ ...baseEnv, JWT_PRIVATE_KEY_FILE: privatePath, JWT_PUBLIC_KEY: publicKey });

    expect(resolveKeyPair(env).privateKey).toBe(privateKey);
  });

  it('bricht mit einer klaren, auf JWT_PRIVATE_KEY_FILE zurückführbaren Fehlermeldung ab, wenn die Datei nicht lesbar ist', () => {
    const { publicKey } = generateFreshKeyPair();
    const missingPath = join(makeTmpDir(), 'does-not-exist.pem');

    const env = loadEnv({ ...baseEnv, JWT_PRIVATE_KEY_FILE: missingPath, JWT_PUBLIC_KEY: publicKey });

    expect(() => resolveKeyPair(env)).toThrow(/JWT_PRIVATE_KEY_FILE/);
  });

  it('erzeugt außerhalb von Produktion ohne jede JWT-Konfiguration automatisch ein Wegwerf-Schlüsselpaar', () => {
    const env = loadEnv({ ...baseEnv, NODE_ENV: 'test', TRUSTED_PROXY_IPS: '' });

    const resolved = resolveKeyPair(env);
    expect(resolved.privateKey).toContain('BEGIN PRIVATE KEY');
    expect(resolved.publicKey).toContain('BEGIN PUBLIC KEY');
  });

  it('liefert innerhalb desselben Prozesses stets dasselbe Wegwerf-Schlüsselpaar (Caching)', () => {
    const env = loadEnv({ ...baseEnv, NODE_ENV: 'test', TRUSTED_PROXY_IPS: '' });

    const first = resolveKeyPair(env);
    const second = resolveKeyPair(env);
    expect(second.privateKey).toBe(first.privateKey);
    expect(second.publicKey).toBe(first.publicKey);
  });
});
