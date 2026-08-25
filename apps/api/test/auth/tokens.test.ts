// apps/api/test/auth/tokens.test.ts
import { describe, it, expect, vi } from 'vitest';

// Umhüllt importPKCS8()/importSPKI() aus "jose" mit Spies (Delegation an
// die echte Implementierung), damit die Tests zu Befund P1 unten prüfen
// können, WIE OFT tatsächlich importiert wird — ohne das echte
// PEM-Parsing/die Schlüsselkonstruktion zu ersetzen.
vi.mock('jose', async (importOriginal) => {
  const actual = await importOriginal<typeof import('jose')>();
  return { ...actual, importPKCS8: vi.fn(actual.importPKCS8), importSPKI: vi.fn(actual.importSPKI) };
});

import * as jose from 'jose';
import {
  signAccessToken,
  verifyAccessToken,
  InvalidAccessTokenError,
  generateRefreshToken,
  hashRefreshToken,
  generateInvitationToken,
  hashInvitationToken,
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

// generateInvitationToken()/hashInvitationToken() waren bislang völlig
// ungetestet — Lücke, die durch die Vereinheitlichung mit
// generateRefreshToken()/hashRefreshToken() unter generateOpaqueToken()/
// hashOpaqueToken() (Code-Review, Befund R7) sichtbar wurde. Spiegelt
// bewusst dieselben Fälle wie oben, damit beide Wrapper nachweislich
// gleichwertig getestet sind.
describe('generateInvitationToken / hashInvitationToken', () => {
  it('erzeugt ein Klartext-Token und dessen Hash, die nicht identisch sind', () => {
    const { plainToken, tokenHash } = generateInvitationToken(7);
    expect(plainToken).not.toBe(tokenHash);
    expect(plainToken.length).toBeGreaterThan(20);
  });

  it('erzeugt für denselben Klartext-Token stets denselben Hash (deterministisch, für die DB-Suche notwendig)', () => {
    const { plainToken } = generateInvitationToken(7);
    expect(hashInvitationToken(plainToken)).toBe(hashInvitationToken(plainToken));
  });

  it('erzeugt bei jedem Aufruf ein anderes Token (hohe Entropie)', () => {
    const a = generateInvitationToken(7);
    const b = generateInvitationToken(7);
    expect(a.plainToken).not.toBe(b.plainToken);
  });

  it('setzt die Ablaufzeit gemäß übergebener TTL in Tagen', () => {
    const { expiresAt } = generateInvitationToken(7);
    const expectedMs = Date.now() + 7 * 24 * 60 * 60 * 1000;
    expect(Math.abs(expiresAt.getTime() - expectedMs)).toBeLessThan(5000); // Toleranz für Testlaufzeit
  });
});

// Regressionstest für Befund R7 (Code-Review): generateRefreshToken()
// (48 Byte) und generateInvitationToken() (32 Byte) unterscheiden sich
// bewusst in der Byte-Länge — eine unachtsame Vereinheitlichung unter
// generateOpaqueToken() hätte diese Unterscheidung versehentlich
// einebnen können (z. B. beide auf denselben Wert festgelegt). Vergleicht
// die tatsächliche Klartext-Länge (base64url, längenproportional zur
// Byte-Zahl) statt die Byte-Zahl selbst zu wiederholen.
describe('Byte-Längen-Unterscheidung bleibt nach der Vereinheitlichung erhalten (Befund R7)', () => {
  it('erzeugt für generateRefreshToken() ein deutlich längeres Klartext-Token als für generateInvitationToken()', () => {
    const refreshToken = generateRefreshToken(30);
    const invitationToken = generateInvitationToken(7);
    expect(refreshToken.plainToken.length).toBeGreaterThan(invitationToken.plainToken.length);
  });
});

// Regressionstests für Befund P1 (Code-Review): importPKCS8()/importSPKI()
// liefen zuvor bei JEDEM Sign/Verify neu — messbar bei jedem einzelnen
// authentifizierten Request. Das Schlüsselpaar ist prozessweit konstant,
// der Import muss also pro PEM-String nur einmal stattfinden.
describe('Schlüssel-Caching (Befund P1)', () => {
  it('importiert den privaten Schlüssel nur einmal für mehrere signAccessToken()-Aufrufe mit demselben Schlüsselpaar', async () => {
    const keyPair = generateFreshKeyPair();
    vi.mocked(jose.importPKCS8).mockClear();

    await signAccessToken(claims, keyPair, 900);
    await signAccessToken(claims, keyPair, 900);
    await signAccessToken(claims, keyPair, 900);

    expect(jose.importPKCS8).toHaveBeenCalledTimes(1);
  });

  it('importiert den öffentlichen Schlüssel nur einmal für mehrere verifyAccessToken()-Aufrufe mit demselben Schlüsselpaar', async () => {
    const keyPair = generateFreshKeyPair();
    const token = await signAccessToken(claims, keyPair, 900);
    vi.mocked(jose.importSPKI).mockClear();

    await verifyAccessToken(token, keyPair);
    await verifyAccessToken(token, keyPair);
    await verifyAccessToken(token, keyPair);

    expect(jose.importSPKI).toHaveBeenCalledTimes(1);
  });

  it('importiert erneut, wenn sich das Schlüsselpaar (also das PEM) unterscheidet', async () => {
    const keyPairA = generateFreshKeyPair();
    const keyPairB = generateFreshKeyPair();
    vi.mocked(jose.importPKCS8).mockClear();

    await signAccessToken(claims, keyPairA, 900);
    await signAccessToken(claims, keyPairB, 900);

    expect(jose.importPKCS8).toHaveBeenCalledTimes(2);
  });

  it('bündelt gleichzeitige (parallele) Aufrufe mit demselben Schlüsselpaar ebenfalls auf einen einzigen Import', async () => {
    const keyPair = generateFreshKeyPair();
    vi.mocked(jose.importPKCS8).mockClear();

    await Promise.all([
      signAccessToken(claims, keyPair, 900),
      signAccessToken(claims, keyPair, 900),
      signAccessToken(claims, keyPair, 900),
    ]);

    expect(jose.importPKCS8).toHaveBeenCalledTimes(1);
  });
});
