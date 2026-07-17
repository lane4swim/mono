// apps/api/test/auth/tokens.test.ts
import { describe, it, expect } from 'vitest';
import {
  signAccessToken,
  verifyAccessToken,
  InvalidAccessTokenError,
  generateRefreshToken,
  hashRefreshToken,
} from '../../src/auth/tokens.js';
import { generateFreshKeyPair } from '../../src/auth/keys.js';
import type { AccessTokenClaims } from '@lane1/shared-types';

const claims: AccessTokenClaims = {
  sub: '11111111-1111-1111-1111-111111111111',
  role: 'trainer',
  clubId: '22222222-2222-2222-2222-222222222222',
  athleteId: null,
};

describe('signAccessToken / verifyAccessToken', () => {
  it('signiert und verifiziert ein Token erfolgreich (Roundtrip)', async () => {
    const keyPair = generateFreshKeyPair();
    const token = await signAccessToken(claims, keyPair, 900);
    const verified = await verifyAccessToken(token, keyPair);
    expect(verified).toEqual(claims);
  });

  it('lehnt ein Token ab, das mit einem anderen Schlüsselpaar verifiziert wird', async () => {
    const keyPairA = generateFreshKeyPair();
    const keyPairB = generateFreshKeyPair();
    const token = await signAccessToken(claims, keyPairA, 900);
    await expect(verifyAccessToken(token, keyPairB)).rejects.toThrow(InvalidAccessTokenError);
  });

  it('lehnt ein abgelaufenes Token ab', async () => {
    const keyPair = generateFreshKeyPair();
    const token = await signAccessToken(claims, keyPair, -10); // bereits in der Vergangenheit abgelaufen
    await expect(verifyAccessToken(token, keyPair)).rejects.toThrow(InvalidAccessTokenError);
  });

  it('lehnt ein manipuliertes Token ab', async () => {
    const keyPair = generateFreshKeyPair();
    const token = await signAccessToken(claims, keyPair, 900);
    const tampered = token.slice(0, -3) + (token.slice(-3) === 'AAA' ? 'BBB' : 'AAA');
    await expect(verifyAccessToken(tampered, keyPair)).rejects.toThrow(InvalidAccessTokenError);
  });

  it('überträgt athleteId korrekt, wenn gesetzt (nicht null)', async () => {
    const keyPair = generateFreshKeyPair();
    const athleteClaims: AccessTokenClaims = { ...claims, role: 'athlete', athleteId: '33333333-3333-3333-3333-333333333333' };
    const token = await signAccessToken(athleteClaims, keyPair, 900);
    const verified = await verifyAccessToken(token, keyPair);
    expect(verified.athleteId).toBe('33333333-3333-3333-3333-333333333333');
  });
});

describe('generateRefreshToken / hashRefreshToken', () => {
  it('erzeugt ein Klartext-Token und dessen Hash, die nicht identisch sind', () => {
    const { plainToken, tokenHash } = generateRefreshToken(30);
    expect(plainToken).not.toBe(tokenHash);
    expect(plainToken.length).toBeGreaterThan(20);
  });

  it('erzeugt für denselben Klartext-Token stets denselben Hash (deterministisch, für die DB-Suche notwendig)', () => {
    const { plainToken } = generateRefreshToken(30);
    expect(hashRefreshToken(plainToken)).toBe(hashRefreshToken(plainToken));
  });

  it('erzeugt bei jedem Aufruf ein anderes Token (hohe Entropie)', () => {
    const a = generateRefreshToken(30);
    const b = generateRefreshToken(30);
    expect(a.plainToken).not.toBe(b.plainToken);
  });

  it('setzt die Ablaufzeit gemäß übergebener TTL in Tagen', () => {
    const { expiresAt } = generateRefreshToken(30);
    const expectedMs = Date.now() + 30 * 24 * 60 * 60 * 1000;
    expect(Math.abs(expiresAt.getTime() - expectedMs)).toBeLessThan(5000); // Toleranz für Testlaufzeit
  });
});
