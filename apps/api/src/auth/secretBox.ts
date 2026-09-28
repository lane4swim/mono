// Verschlüsselung kleiner Geheimnisse im Ruhezustand (Issue #97: TOTP-
// Secrets). AES-256-GCM mit zufälligem 96-Bit-IV je Wert. Format
// "v1:<iv>:<tag>:<ciphertext>" (base64url), damit ein späterer Wechsel von
// Verfahren oder Schlüssel erkennbar bleibt. Ein Datenbank-Dump allein
// reicht so nicht, um Codes zu erzeugen — dafür braucht es zusätzlich
// TOTP_ENCRYPTION_KEY aus der Server-Konfiguration.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const VERSION = 'v1';
const KEY_BYTES = 32;

export class SecretBoxError extends Error {}

export function parseSecretBoxKey(base64Key: string): Buffer {
  const key = Buffer.from(base64Key, 'base64');
  if (key.length !== KEY_BYTES) {
    throw new SecretBoxError(`Der Schlüssel muss genau ${KEY_BYTES} Byte lang sein (base64-kodiert, z. B. "openssl rand -base64 32").`);
  }
  return key;
}

export function seal(plaintext: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join(':');
}

export function open(sealed: string, key: Buffer): string {
  const [version, iv, tag, ciphertext] = sealed.split(':');
  if (version !== VERSION || !iv || !tag || ciphertext === undefined) {
    throw new SecretBoxError('Unbekanntes Format des verschlüsselten Werts.');
  }
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    throw new SecretBoxError('Entschlüsselung fehlgeschlagen (falscher Schlüssel oder veränderter Wert).');
  }
}
