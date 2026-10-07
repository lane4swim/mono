// scripts/createTestAccounts.ts — die datenbankfreien Teile (Kontenplan,
// Optionen, Sicherungen). Die Prisma-Schreibzugriffe selbst sind bewusst
// schlicht und laufen nur gegen eine echte Datenbank im Codespace.
import { describe, it, expect } from 'vitest';
import { NormalizedEmailSchema, RoleSchema } from '@lane1/shared-types';
import {
  assertSafeToRun,
  buildTestAccountPlan,
  DEFAULT_CLUB_NAME,
  DEFAULT_COUNT,
  MAX_COUNT,
  parseOptions,
} from '../../scripts/createTestAccounts.js';

describe('buildTestAccountPlan', () => {
  it('plant für jede Rolle count Konten mit eindeutigen, gültigen E-Mail-Adressen', () => {
    const plan = buildTestAccountPlan(3);
    expect(plan).toHaveLength(3 * RoleSchema.options.length);
    for (const role of RoleSchema.options) {
      expect(plan.filter((a) => a.role === role).map((a) => a.index)).toEqual([1, 2, 3]);
    }
    expect(new Set(plan.map((a) => a.email)).size).toBe(plan.length);
    for (const account of plan) {
      // Bereits normalisiert, sonst wäre ein Login mit der ausgegebenen Adresse nicht möglich.
      expect(NormalizedEmailSchema.parse(account.email)).toBe(account.email);
      expect(account.email.endsWith('@example.org')).toBe(true);
    }
  });
});

describe('parseOptions', () => {
  it('liefert Standardwerte ohne Argumente', () => {
    expect(parseOptions([])).toEqual({ count: DEFAULT_COUNT, clubName: DEFAULT_CLUB_NAME, resetPasswords: false });
  });

  it('übernimmt --count, --club und --reset-passwords', () => {
    expect(parseOptions(['--count=5', '--club=SV Test', '--reset-passwords'])).toEqual({
      count: 5,
      clubName: 'SV Test',
      resetPasswords: true,
    });
  });

  it.each(['--count=0', `--count=${MAX_COUNT + 1}`, '--count=1.5', '--count=abc', '--password=x', 'foo', '--club='])(
    'weist %s ab',
    (arg) => {
      expect(() => parseOptions([arg])).toThrow();
    },
  );
});

describe('assertSafeToRun', () => {
  const confirmed = { TEST_ACCOUNTS_CONFIRM: 'yes-test-accounts' };

  it('verlangt die explizite Bestätigung', () => {
    expect(() => assertSafeToRun({ NODE_ENV: 'development' })).toThrow(/Bestätigung/);
    expect(() => assertSafeToRun({ NODE_ENV: 'development', ...confirmed })).not.toThrow();
  });

  it('bricht bei NODE_ENV=production außerhalb eines Codespace ab', () => {
    expect(() => assertSafeToRun({ NODE_ENV: 'production', ...confirmed })).toThrow(/production/);
  });

  it('erlaubt NODE_ENV=production in einem Codespace (setup-codespace.sh setzt es so)', () => {
    expect(() => assertSafeToRun({ NODE_ENV: 'production', CODESPACES: 'true', ...confirmed })).not.toThrow();
  });
});
