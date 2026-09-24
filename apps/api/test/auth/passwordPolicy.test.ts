// Issue #97: Mindestlänge für Administrationskonten und Abgleich gegen
// bekannte Leak-Passwörter.
import { describe, it, expect } from 'vitest';
import { assertPasswordPolicy, isCommonPassword, PasswordTooShortForRoleError, CommonPasswordError } from '../../src/auth/passwordPolicy.js';

describe('isCommonPassword()', () => {
  it('erkennt bekannte Leak-Passwörter, unabhängig von Groß-/Kleinschreibung', () => {
    expect(isCommonPassword('password')).toBe(true);
    expect(isCommonPassword('PassWord')).toBe(true);
    expect(isCommonPassword('12345678')).toBe(true);
    expect(isCommonPassword('qwertyuiop')).toBe(true);
  });

  it('lässt ungewöhnliche Passwörter durch', () => {
    expect(isCommonPassword('Seepferdchen-Bahn4-Kraulbeine')).toBe(false);
  });
});

describe('assertPasswordPolicy()', () => {
  const strong11 = 'Kx7!mQ2#vLp'; // 11 Zeichen, nicht in der Liste

  it('verlangt 12 Zeichen für admin und superadmin', () => {
    expect(() => assertPasswordPolicy(strong11, ['admin'])).toThrow(PasswordTooShortForRoleError);
    expect(() => assertPasswordPolicy(strong11, ['trainer', 'superadmin'])).toThrow(PasswordTooShortForRoleError);
    expect(() => assertPasswordPolicy(`${strong11}9`, ['admin'])).not.toThrow();
  });

  it('lässt 8+ Zeichen für andere Rollen zu', () => {
    for (const role of ['trainer', 'athlete', 'parent', 'referee']) {
      expect(() => assertPasswordPolicy('Kx7!mQ2#', [role])).not.toThrow();
    }
  });

  it('lehnt Leak-Passwörter für jede Rolle ab', () => {
    expect(() => assertPasswordPolicy('password', ['athlete'])).toThrow(CommonPasswordError);
    expect(() => assertPasswordPolicy('passwordpassword', ['admin'])).toThrow(CommonPasswordError);
  });
});
