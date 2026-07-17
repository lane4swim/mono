// apps/api/src/auth/password.ts
//
// Passwort-Hashing mit argon2id (OWASP-Empfehlung, siehe Abschnitt 5.2 des
// Backend-Entwicklungsplans). Nutzt `hash-wasm` statt des nativen `argon2`-
// Pakets — reines WebAssembly, kein Compile-Schritt/Build-Tools nötig,
// funktioniert identisch in CI, lokal und in eingeschränkten Umgebungen.
import { argon2id, argon2Verify } from 'hash-wasm';
import { randomBytes } from 'node:crypto';

// Parameter angelehnt an die OWASP-Empfehlung für argon2id (Stand 2026):
// mind. 19 MiB Speicher, 2 Iterationen, 1 Parallelitätsgrad als Minimum
// für interaktive Logins; hier etwas großzügiger für zusätzliche Sicherheit.
const MEMORY_KIB = 65536; // 64 MiB
const ITERATIONS = 3;
const PARALLELISM = 1;
const HASH_LENGTH = 32;
const SALT_LENGTH = 16;

export async function hashPassword(plainPassword: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  return argon2id({
    password: plainPassword,
    salt,
    memorySize: MEMORY_KIB,
    iterations: ITERATIONS,
    parallelism: PARALLELISM,
    hashLength: HASH_LENGTH,
    outputType: 'encoded', // enthält Salt+Parameter im Ergebnis-String
  });
}

export async function verifyPassword(plainPassword: string, encodedHash: string): Promise<boolean> {
  try {
    return await argon2Verify({ password: plainPassword, hash: encodedHash });
  } catch {
    // Fehlerhaftes/fremdes Hash-Format -> als "stimmt nicht überein" werten,
    // statt den Fehler nach außen durchzureichen.
    return false;
  }
}
