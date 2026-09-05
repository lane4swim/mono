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
  return new SignJWT({ roles: claims.roles, clubId: claims.clubId, athleteId: claims.athleteId })
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
      roles: payload.roles as AccessTokenClaims['roles'],
      clubId: (payload.clubId as string | null) ?? null,
      athleteId: (payload.athleteId as string | null) ?? null,
    };
  } catch (err) {
    if (err instanceof InvalidAccessTokenError) throw err;
    throw new InvalidAccessTokenError('Access Token ist ungültig oder abgelaufen.');
  }
}

// Code-Review, Befund R7: generateRefreshToken()/generateInvitationToken()
// sowie hashRefreshToken()/hashInvitationToken() unterschieden sich zuvor
// ausschließlich in der Byte-Länge (48 vs. 32) — beide folgen demselben
// Prinzip (opakes Zufalls-Token, serverseitig nur der SHA-256-Hash
// gespeichert, analog zu Passwort-Handling). Eine gemeinsame Basis
// (generateOpaqueToken()/hashOpaqueToken()) plus zwei schlanke,
// weiterhin einzeln exportierte Wrapper je Tokentyp deckt beides ab; die
// semantische Unterscheidung (Refresh- vs. Einladungs-Token — unter-
// schiedliche Byte-Länge, unterschiedliche Aufrufer) bleibt über eigene
// Funktionsnamen und Typ-Aliase erhalten, nicht über Code-Duplikation.
export interface GeneratedOpaqueToken {
  plainToken: string; // wird einmalig an den Client ausgegeben
  tokenHash: string; // wird serverseitig gespeichert
  expiresAt: Date;
}

// Nimmt die TTL bewusst in Millisekunden entgegen (nicht in Tagen) — die
// drei Aufrufer unten haben unterschiedliche natürliche Zeiteinheiten
// (Tage für Refresh-/Einladungs-Tokens, Minuten für das kurzlebigere
// Passwort-Zurücksetzen-Token, siehe generatePasswordResetToken()) und
// rechnen jeweils selbst in Millisekunden um, statt diese Funktion mit
// einer weiteren Einheit zu verkomplizieren.
function generateOpaqueToken(bytes: number, ttlMs: number): GeneratedOpaqueToken {
  const plainToken = randomBytes(bytes).toString('base64url');
  return {
    plainToken,
    tokenHash: hashOpaqueToken(plainToken),
    expiresAt: new Date(Date.now() + ttlMs),
  };
}

function hashOpaqueToken(plainToken: string): string {
  return createHash('sha256').update(plainToken).digest('hex');
}

export type GeneratedRefreshToken = GeneratedOpaqueToken;

export function generateRefreshToken(ttlDays: number): GeneratedRefreshToken {
  return generateOpaqueToken(48, ttlDays * 24 * 60 * 60 * 1000);
}

export function hashRefreshToken(plainToken: string): string {
  return hashOpaqueToken(plainToken);
}

// Einladungs-Tokens folgen demselben Prinzip wie Refresh Tokens (siehe
// generateOpaqueToken() oben) — eigene Funktion (statt Wiederverwendung
// von generateRefreshToken), da die TTL hier in Tagen für Einladungen
// typischerweise deutlich kürzer ist (Tage statt eines Monats) und
// semantisch ein anderer Tokentyp ist.
export type GeneratedInvitationToken = GeneratedOpaqueToken;

export function generateInvitationToken(ttlDays: number): GeneratedInvitationToken {
  return generateOpaqueToken(32, ttlDays * 24 * 60 * 60 * 1000);
}

export function hashInvitationToken(plainToken: string): string {
  return hashOpaqueToken(plainToken);
}

// Passwort-Zurücksetzen-Tokens (Sicherheitsreview 2026-08, Befund M5):
// folgen demselben Prinzip wie Refresh-/Einladungs-Tokens oben (opakes
// Zufalls-Token, serverseitig nur der SHA-256-Hash gespeichert) — eigene
// Funktion statt Wiederverwendung, da die TTL hier bewusst in MINUTEN
// statt Tagen angegeben wird: ein Passwort-Reset-Token autorisiert eine
// sicherheitskritische Aktion an einem BEREITS bestehenden Konto (anders
// als ein Einladungs-Token, das nur eine Erstregistrierung ermöglicht)
// und sollte daher deutlich kurzlebiger sein (Standard: 60 Minuten, siehe
// app.ts: PASSWORD_RESET_TTL_MINUTES).
export type GeneratedPasswordResetToken = GeneratedOpaqueToken;

export function generatePasswordResetToken(ttlMinutes: number): GeneratedPasswordResetToken {
  return generateOpaqueToken(32, ttlMinutes * 60 * 1000);
}

export function hashPasswordResetToken(plainToken: string): string {
  return hashOpaqueToken(plainToken);
}
