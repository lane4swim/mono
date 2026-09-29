// Issue #97: TOTP-Implementierung gegen die Testvektoren aus RFC 6238
// (Anhang B, SHA-1, Secret "12345678901234567890", 8 Stellen).
import { describe, it, expect } from 'vitest';
import { base32Encode, base32Decode, hotp, verifyTotp, totpAt, totpStep, generateTotpSecret, buildOtpauthUri } from '../../src/auth/totp.js';

const RFC_SECRET = Buffer.from('12345678901234567890', 'ascii');

describe('hotp() — RFC 6238, Anhang B', () => {
  it.each([
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
    [20000000000, '65353130'],
  ])('T=%i ergibt %s', (unixSeconds, expected) => {
    expect(hotp(RFC_SECRET, Math.floor(unixSeconds / 30), 8)).toBe(expected);
  });

  it('liefert die RFC-4226-Werte für die ersten Zähler (6 Stellen)', () => {
    expect([0, 1, 2, 3].map((c) => hotp(RFC_SECRET, c))).toEqual(['755224', '287082', '359152', '969429']);
  });
});

describe('base32', () => {
  it('kodiert nach RFC 4648 und dekodiert verlustfrei', () => {
    expect(base32Encode(Buffer.from('foobar'))).toBe('MZXW6YTBOI');
    expect(base32Decode('MZXW6YTBOI').toString()).toBe('foobar');
    expect(base32Decode('mzxw 6ytb-oi').toString()).toBe('foobar');
  });

  it('erzeugt 160-Bit-Secrets (32 Base32-Zeichen)', () => {
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(base32Decode(secret)).toHaveLength(20);
  });
});

describe('verifyTotp()', () => {
  const secret = base32Encode(RFC_SECRET);
  const now = new Date(1_700_000_000_000);
  const step = totpStep(now);

  it('akzeptiert den aktuellen sowie den vorigen und nächsten Zeitschritt', () => {
    for (const offset of [-1, 0, 1]) {
      expect(verifyTotp(secret, totpAt(secret, step + offset), { now })).toBe(step + offset);
    }
  });

  it('lehnt Codes außerhalb des Fensters, falsche und ungültig formatierte Codes ab', () => {
    expect(verifyTotp(secret, totpAt(secret, step - 2), { now })).toBeNull();
    expect(verifyTotp(secret, totpAt(secret, step + 2), { now })).toBeNull();
    expect(verifyTotp(secret, '12345', { now })).toBeNull();
    expect(verifyTotp(secret, 'abcdef', { now })).toBeNull();
  });

  it('lehnt einen bereits verwendeten oder älteren Zeitschritt ab (Wiederverwendung)', () => {
    const code = totpAt(secret, step);
    expect(verifyTotp(secret, code, { now, lastUsedStep: step })).toBeNull();
    expect(verifyTotp(secret, code, { now, lastUsedStep: step - 1 })).toBe(step);
  });

  it('ignoriert Leerzeichen im eingegebenen Code', () => {
    const code = totpAt(secret, step);
    expect(verifyTotp(secret, `${code.slice(0, 3)} ${code.slice(3)}`, { now })).toBe(step);
  });
});

describe('buildOtpauthUri()', () => {
  it('erzeugt eine Key-URI mit Aussteller, Konto und Parametern', () => {
    const uri = buildOtpauthUri('JBSWY3DPEHPK3PXP', 'mara@example.org', 'Lane 1');
    expect(uri).toBe('otpauth://totp/Lane%201%3Amara%40example.org?secret=JBSWY3DPEHPK3PXP&issuer=Lane+1&algorithm=SHA1&digits=6&period=30');
  });
});
