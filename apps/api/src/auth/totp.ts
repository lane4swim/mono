// Zeitbasierte Einmalcodes nach RFC 6238 (TOTP, auf HOTP/RFC 4226) für die
// Zwei-Faktor-Anmeldung (Issue #97). Bewusst ohne Fremdbibliothek: das
// Verfahren ist klein, und node:crypto liefert HMAC-SHA1 und den
// zeitkonstanten Vergleich. Die Tests prüfen gegen die Testvektoren aus
// RFC 6238, Anhang B.
//
// Parameter wie bei allen gängigen Authenticator-Apps: SHA-1, 6 Stellen,
// 30 Sekunden. Akzeptiert wird der aktuelle Zeitschritt sowie je einer davor
// und danach, damit leicht abweichende Uhren und die Tippzeit nicht stören.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const TOTP_PERIOD_SECONDS = 30;
export const TOTP_DIGITS = 6;
export const TOTP_WINDOW_STEPS = 1;
const SECRET_BYTES = 20; // 160 Bit, von RFC 4226 empfohlen

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = value * 256 + byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += BASE32_ALPHABET[Math.floor(value / 2 ** bits) % 32];
    }
    value %= 2 ** bits;
  }
  if (bits > 0) out += BASE32_ALPHABET[(value * 2 ** (5 - bits)) % 32];
  return out;
}

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[\s=-]/g, '');
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) throw new Error('Ungültiges Base32-Zeichen.');
    value = value * 32 + index;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push(Math.floor(value / 2 ** bits) % 256);
      value %= 2 ** bits;
    }
  }
  return Buffer.from(bytes);
}

export function generateTotpSecret(): string {
  return base32Encode(randomBytes(SECRET_BYTES));
}

export function totpStep(now: Date = new Date()): number {
  return Math.floor(now.getTime() / 1000 / TOTP_PERIOD_SECONDS);
}

// HOTP (RFC 4226, Abschnitt 5.3): HMAC über den 8-Byte-Zähler, dynamische
// Kürzung, die letzten `digits` Dezimalstellen.
export function hotp(secret: Buffer, counter: number, digits: number = TOTP_DIGITS): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac('sha1', secret).update(message).digest();
  const offset = hmac[hmac.length - 1]! % 16;
  const binary =
    (hmac[offset]! % 128) * 2 ** 24 + hmac[offset + 1]! * 2 ** 16 + hmac[offset + 2]! * 2 ** 8 + hmac[offset + 3]!;
  return String(binary % 10 ** digits).padStart(digits, '0');
}

export function totpAt(base32Secret: string, step: number, digits: number = TOTP_DIGITS): string {
  return hotp(base32Decode(base32Secret), step, digits);
}

// Liefert den Zeitschritt des passenden Codes oder null. Codes, deren
// Zeitschritt nicht NACH `lastUsedStep` liegt, werden abgelehnt: ein
// abgefangener oder mitgelesener Code lässt sich so nicht innerhalb seiner
// Gültigkeit erneut verwenden. Der Aufrufer speichert den zurückgegebenen
// Schritt atomar als neuen `lastUsedStep` (siehe UserRepository).
export function verifyTotp(
  base32Secret: string,
  code: string,
  options: { now?: Date; lastUsedStep?: number | null } = {},
): number | null {
  const normalized = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(normalized)) return null;
  const secret = base32Decode(base32Secret);
  const current = totpStep(options.now);
  let matched: number | null = null;
  // Alle Kandidaten prüfen (kein vorzeitiger Abbruch), damit die Laufzeit
  // nicht verrät, welcher Zeitschritt getroffen wurde.
  for (let step = current - TOTP_WINDOW_STEPS; step <= current + TOTP_WINDOW_STEPS; step++) {
    const expected = Buffer.from(hotp(secret, step));
    if (timingSafeEqual(expected, Buffer.from(normalized)) && matched === null) matched = step;
  }
  if (matched === null) return null;
  if (options.lastUsedStep != null && matched <= options.lastUsedStep) return null;
  return matched;
}

// otpauth-URI (Key-URI-Format der Authenticator-Apps), Grundlage des QR-Codes.
export function buildOtpauthUri(base32Secret: string, accountName: string, issuer: string): string {
  const label = encodeURIComponent(`${issuer}:${accountName}`);
  const params = new URLSearchParams({
    secret: base32Secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
