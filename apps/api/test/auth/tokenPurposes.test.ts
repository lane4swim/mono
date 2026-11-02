// Zweckbindung der JWTs: Access Token, mfaToken (zwischen Passwort- und
// Code-Schritt) und setupToken (erzwungene TOTP-Einrichtung) sind mit
// demselben Schlüssel signiert. Jede verify-Funktion darf ausschließlich
// ihren eigenen Tokentyp annehmen — sonst ließe sich z. B. mit einem
// mfaToken (nur "Passwort war korrekt") eine Sitzung führen. Geprüft wird
// die vollständige Matrix, dazu Ablauf und fremder Schlüssel je Typ.
import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  signAccessToken,
  verifyAccessToken,
  InvalidAccessTokenError,
  signMfaToken,
  verifyMfaToken,
  InvalidMfaTokenError,
  signMfaSetupToken,
  verifyMfaSetupToken,
  InvalidMfaSetupTokenError,
  MFA_TOKEN_TTL_SECONDS,
  MFA_SETUP_TOKEN_TTL_SECONDS,
} from '../../src/auth/tokens.js';
import { generateFreshKeyPair, type KeyPair } from '../../src/auth/keys.js';

const USER_ID = '11111111-1111-1111-1111-111111111111';
const keyPair = generateFreshKeyPair();

type Kind = 'access' | 'mfa' | 'mfa-setup';

async function sign(kind: Kind, keys: KeyPair = keyPair): Promise<string> {
  if (kind === 'access') return signAccessToken({ sub: USER_ID, roles: ['admin'], clubId: null, athleteId: null }, keys, 900);
  if (kind === 'mfa') return (await signMfaToken(USER_ID, keys)).token;
  return signMfaSetupToken(USER_ID, keys);
}

const VERIFIERS: Record<Kind, { verify: (token: string, keys: KeyPair) => Promise<unknown>; error: new (...args: never[]) => Error }> = {
  access: { verify: verifyAccessToken, error: InvalidAccessTokenError },
  mfa: { verify: verifyMfaToken, error: InvalidMfaTokenError },
  'mfa-setup': { verify: verifyMfaSetupToken, error: InvalidMfaSetupTokenError },
};

const KINDS: Kind[] = ['access', 'mfa', 'mfa-setup'];

afterEach(() => {
  vi.useRealTimers();
});

describe('Zweckbindung: jede verify-Funktion nimmt nur ihren eigenen Tokentyp an', () => {
  for (const signed of KINDS) {
    for (const verifier of KINDS) {
      const accepted = signed === verifier;
      it(`${signed}-Token → verify ${verifier}: ${accepted ? 'angenommen' : 'abgelehnt'}`, async () => {
        const token = await sign(signed);
        const { verify, error } = VERIFIERS[verifier];
        if (accepted) await expect(verify(token, keyPair)).resolves.toBeDefined();
        else await expect(verify(token, keyPair)).rejects.toBeInstanceOf(error);
      });
    }
  }
});

describe('Rückgabewerte der zweckgebundenen Tokens', () => {
  it('verifyMfaToken() liefert userId, jti und den Ablaufzeitpunkt', async () => {
    const before = Date.now();
    const { token, jti } = await signMfaToken(USER_ID, keyPair);
    const result = await verifyMfaToken(token, keyPair);
    expect(result).toMatchObject({ userId: USER_ID, jti });
    expect(result.expiresAt.getTime()).toBeGreaterThanOrEqual(Math.floor(before / 1000) * 1000 + MFA_TOKEN_TTL_SECONDS * 1000);
    expect(result.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + MFA_TOKEN_TTL_SECONDS * 1000);
  });

  it('verifyMfaSetupToken() liefert genau die userId', async () => {
    await expect(verifyMfaSetupToken(await signMfaSetupToken(USER_ID, keyPair), keyPair)).resolves.toEqual({ userId: USER_ID });
  });

  it('jedes mfaToken trägt eine eigene jti (Fehlversuchs-Grenze je Anmeldeversuch)', async () => {
    const a = await signMfaToken(USER_ID, keyPair);
    const b = await signMfaToken(USER_ID, keyPair);
    expect(a.jti).not.toBe(b.jti);
  });
});

describe('Ablauf und fremder Schlüssel', () => {
  const ttl: Record<'mfa' | 'mfa-setup', number> = { mfa: MFA_TOKEN_TTL_SECONDS, 'mfa-setup': MFA_SETUP_TOKEN_TTL_SECONDS };

  for (const kind of ['mfa', 'mfa-setup'] as const) {
    it(`${kind}: ein abgelaufenes Token wird abgelehnt`, async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(Date.now() - (ttl[kind] + 60) * 1000);
      const token = await sign(kind);
      vi.useRealTimers();
      await expect(VERIFIERS[kind].verify(token, keyPair)).rejects.toBeInstanceOf(VERIFIERS[kind].error);
    });

    it(`${kind}: kurz vor Ablauf wird das Token noch angenommen`, async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(Date.now() - (ttl[kind] - 60) * 1000);
      const token = await sign(kind);
      vi.useRealTimers();
      await expect(VERIFIERS[kind].verify(token, keyPair)).resolves.toBeDefined();
    });

    it(`${kind}: ein mit fremdem Schlüssel signiertes Token wird abgelehnt`, async () => {
      const token = await sign(kind, generateFreshKeyPair());
      await expect(VERIFIERS[kind].verify(token, keyPair)).rejects.toBeInstanceOf(VERIFIERS[kind].error);
    });

    it(`${kind}: ein manipuliertes Token wird abgelehnt`, async () => {
      const token = await sign(kind);
      const [header, payload, signature] = token.split('.');
      const forged = JSON.parse(Buffer.from(payload!, 'base64url').toString());
      forged.sub = '99999999-9999-9999-9999-999999999999';
      const tampered = [header, Buffer.from(JSON.stringify(forged)).toString('base64url'), signature].join('.');
      await expect(VERIFIERS[kind].verify(tampered, keyPair)).rejects.toBeInstanceOf(VERIFIERS[kind].error);
    });
  }
});
