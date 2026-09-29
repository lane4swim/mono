// Issue #97, Plan PR 3: scripts/lib/mfa-env.sh — TOTP_ENCRYPTION_KEY und
// MFA_ENFORCE in apps/api/.env, genutzt von setup-codespace.sh und
// setup-netcup.sh. Läuft das Bash-Skript mit vorgegebenen Antworten.
import { describe, it, expect, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { parseSecretBoxKey } from '../../src/auth/secretBox.js';

const HELPER = resolve(__dirname, '../../../../scripts/lib/mfa-env.sh');

let dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs = [];
});

function envFile(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'lane1-mfa-env-'));
  dirs.push(dir);
  const file = join(dir, '.env');
  writeFileSync(file, content);
  return file;
}

function run(file: string, standard: 'true' | 'false', options: { input?: string; tty?: boolean; enforce?: string } = {}) {
  const env: Record<string, string> = { PATH: process.env.PATH ?? '' };
  if (options.tty) env.MFA_STDIN_IS_TTY = '1';
  if (options.enforce !== undefined) env.MFA_ENFORCE = options.enforce;
  const result = spawnSync('bash', ['-c', `source "${HELPER}" && mfa_ensure_env "$1" "$2"`, 'bash', file, standard], {
    input: options.input ?? '',
    env,
    encoding: 'utf8',
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}`, values: parseEnv(readFileSync(file, 'utf8')) };
}

describe('scripts/lib/mfa-env.sh', () => {
  it('erzeugt einen gültigen Schlüssel und übernimmt ohne Terminal den Standard', () => {
    const file = envFile('NODE_ENV=production\n');
    const { status, values } = run(file, 'true');
    expect(status).toBe(0);
    expect(parseSecretBoxKey(values.TOTP_ENCRYPTION_KEY!)).toHaveLength(32);
    expect(values.MFA_ENFORCE).toBe('true');
    expect(values.NODE_ENV).toBe('production');
  });

  it('Enter übernimmt den Standard, j/n entscheiden, andere Antworten werden erneut erfragt', () => {
    expect(run(envFile(''), 'false', { tty: true, input: '\n' }).values.MFA_ENFORCE).toBe('false');
    expect(run(envFile(''), 'false', { tty: true, input: 'j\n' }).values.MFA_ENFORCE).toBe('true');
    expect(run(envFile(''), 'true', { tty: true, input: 'nein\n' }).values.MFA_ENFORCE).toBe('false');
    const retried = run(envFile(''), 'true', { tty: true, input: 'vielleicht\nn\n' });
    expect(retried.output).toContain('Bitte mit j (ja) oder n (nein) antworten.');
    expect(retried.values.MFA_ENFORCE).toBe('false');
  });

  it('eine vorgegebene Umgebungsvariable ersetzt die Frage; ungültige Werte brechen ab, ohne zu schreiben', () => {
    expect(run(envFile(''), 'true', { tty: true, enforce: 'false' }).values.MFA_ENFORCE).toBe('false');
    const invalid = run(envFile('X=1\n'), 'true', { enforce: 'ja' });
    expect(invalid.status).toBe(1);
    expect(invalid.values).toEqual({ X: '1' });
  });

  it('vorhandene Werte bleiben, ein leerer Schlüssel wird an Ort und Stelle gefüllt', () => {
    const file = envFile('TOTP_ENCRYPTION_KEY=\nMFA_ENFORCE=false\n');
    const first = run(file, 'true');
    const key = first.values.TOTP_ENCRYPTION_KEY!;
    expect(parseSecretBoxKey(key)).toHaveLength(32);
    expect(first.values.MFA_ENFORCE).toBe('false');
    expect(readFileSync(file, 'utf8').match(/^TOTP_ENCRYPTION_KEY=/gm)).toHaveLength(1);

    const second = run(file, 'true', { tty: true, input: 'j\n' });
    expect(second.values).toEqual({ TOTP_ENCRYPTION_KEY: key, MFA_ENFORCE: 'false' });
    expect(second.output).toContain('bleibt unverändert');
  });
});
