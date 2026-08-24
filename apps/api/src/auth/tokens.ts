// apps/api/src/auth/tokens.ts
//
// Access Token: JWT, RS256-signiert (asymmetrisch — siehe Abschnitt 5.2 des
// Backend-Entwicklungsplans), kurzlebig. Refresh Token: KEIN JWT, sondern
// ein opakes Zufalls-Token — der Server speichert nur dessen SHA-256-Hash,
// nie den Klartext (analog zu Passwort-Handling, nur ohne Argon2, da schon
// hochentropisch/zufällig statt nutzergewählt).
import { SignJWT, jwtVerify, importPKCS8, importSPKI, type KeyLike } from 'jose';
import { randomBytes, createHash } from 'node:crypto';
import type { AccessTokenClaims } from '@lane1/shared-types';
import type { KeyPair } from './keys.js';

const ALG = 'RS256';

// Code-Review, Befund P1: importPKCS8()/importSPKI() liefen zuvor bei
// JEDEM Sign/Verify neu — also bei jedem einzelnen authentifizierten
// Request (siehe plugins/authenticate.ts). Das Schlüsselpaar ist
// prozessweit konstant (resolveKeyPair() cacht es bereits), daher genügt
// ein einmaliger, lazy pro PEM-String gecachter Import.
const privateKeyCache = new Map<string, Promise<KeyLike>>();
const publicKeyCache = new Map<string, Promise<KeyLike>>();

function getPrivateKey(pem: string): Promise<KeyLike> {
  let cached = privateKeyCache.get(pem);
  if (!cached) {
    cached = importPKCS8(pem, ALG);
    privateKeyCache.set(pem, cached);
  }
  return cached;
}

function getPublicKey(pem: string): Promise<KeyLike> {
  let cached = publicKeyCache.get(pem);
  if (!cached) {
    cached = importSPKI(pem, ALG);
    publicKeyCache.set(pem, cached);
  }
  return cached;
}

export async function signAccessToken(
  claims: AccessTokenClaims,
  keyPair: KeyPair,
  ttlSeconds: number,
): Promise<string> {
  const privateKey = await getPrivateKey(keyPair.privateKey);
  return new SignJWT({ role: claims.role, clubId: claims.clubId, athleteId: claims.athleteId })
    .setProtectedHeader({ alg: ALG })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(privateKey);
}

export class InvalidAccessTokenError extends Error {}

export async function verifyAccessToken(token: string, keyPair: KeyPair): Promise<AccessTokenClaims> {
  const publicKey = await getPublicKey(keyPair.publicKey);
  try {
    const { payload } = await jwtVerify(token, publicKey, { algorithms: [ALG] });
    if (!payload.sub) throw new InvalidAccessTokenError('Token ohne "sub"-Claim.');
    return {
      sub: payload.sub,
      role: payload.role as AccessTokenClaims['role'],
      clubId: (payload.clubId as string | null) ?? null,
      athleteId: (payload.athleteId as string | null) ?? null,
    };
  } catch (err) {
    if (err instanceof InvalidAccessTokenError) throw err;
    throw new InvalidAccessTokenError('Access Token ist ungültig oder abgelaufen.');
  }
}

export interface GeneratedRefreshToken {
  plainToken: string; // wird einmalig an den Client ausgegeben
  tokenHash: string; // wird serverseitig gespeichert
  expiresAt: Date;
}

export function generateRefreshToken(ttlDays: number): GeneratedRefreshToken {
  const plainToken = randomBytes(48).toString('base64url');
  return {
    plainToken,
    tokenHash: hashRefreshToken(plainToken),
    expiresAt: new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000),
  };
}

export function hashRefreshToken(plainToken: string): string {
  return createHash('sha256').update(plainToken).digest('hex');
}

// Einladungs-Tokens folgen demselben Prinzip wie Refresh Tokens: opakes
// Zufalls-Token, serverseitig nur der SHA-256-Hash gespeichert. Eigene
// Funktion (statt Wiederverwendung von generateRefreshToken), da die TTL
// hier in Tagen für Einladungen typischerweise deutlich kürzer ist
// (Tage statt eines Monats) und semantisch ein anderer Tokentyp ist.
export interface GeneratedInvitationToken {
  plainToken: string;
  tokenHash: string;
  expiresAt: Date;
}

export function generateInvitationToken(ttlDays: number): GeneratedInvitationToken {
  const plainToken = randomBytes(32).toString('base64url');
  return {
    plainToken,
    tokenHash: hashInvitationToken(plainToken),
    expiresAt: new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000),
  };
}

export function hashInvitationToken(plainToken: string): string {
  return createHash('sha256').update(plainToken).digest('hex');
}
