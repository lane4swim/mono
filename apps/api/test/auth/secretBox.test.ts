// Issue #97: Verschlüsselung der TOTP-Secrets im Ruhezustand.
import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { seal, open, parseSecretBoxKey, SecretBoxError } from '../../src/auth/secretBox.js';

describe('secretBox', () => {
  const key = randomBytes(32);

  it('verschlüsselt mit zufälligem IV und entschlüsselt verlustfrei', () => {
    const a = seal('JBSWY3DPEHPK3PXP', key);
    const b = seal('JBSWY3DPEHPK3PXP', key);
    expect(a).not.toBe(b);
    expect(a.startsWith('v1:')).toBe(true);
    expect(a).not.toContain('JBSWY3DPEHPK3PXP');
    expect(open(a, key)).toBe('JBSWY3DPEHPK3PXP');
  });

  it('scheitert mit falschem Schlüssel oder verändertem Wert', () => {
    const sealed = seal('geheim', key);
    expect(() => open(sealed, randomBytes(32))).toThrow(SecretBoxError);
    const parts = sealed.split(':');
    parts[3] = Buffer.from('manipuliert').toString('base64url');
    expect(() => open(parts.join(':'), key)).toThrow(SecretBoxError);
    expect(() => open('v2:x:y:z', key)).toThrow(SecretBoxError);
  });

  it('verlangt einen 32-Byte-Schlüssel', () => {
    expect(parseSecretBoxKey(randomBytes(32).toString('base64'))).toHaveLength(32);
    expect(() => parseSecretBoxKey(randomBytes(16).toString('base64'))).toThrow(SecretBoxError);
  });
});
