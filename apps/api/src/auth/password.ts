// Passwort-Hashing mit argon2id (OWASP-Empfehlung, siehe Abschnitt 5.2 des
// Backend-Entwicklungsplans). Nutzt `hash-wasm` statt des nativen `argon2`-
// Pakets — reines WebAssembly, kein Compile-Schritt/Build-Tools nötig,
// funktioniert identisch in CI, lokal und in eingeschränkten Umgebungen.
// Gerechnet wird in einem Worker-Pool, nicht auf dem Haupt-Thread (siehe
// passwordHasherPool.ts).
import { randomBytes } from 'node:crypto';
import { availableParallelism } from 'node:os';
import { PasswordHasherPool } from './passwordHasherPool.js';

// Parameter angelehnt an die OWASP-Empfehlung für argon2id (Stand 2026):
// mind. 19 MiB Speicher, 2 Iterationen, 1 Parallelitätsgrad als Minimum
// für interaktive Logins; hier etwas großzügiger für zusätzliche Sicherheit.
const ARGON2_PARAMS = {
  memorySize: 65536, // 64 MiB je laufender Operation
  iterations: 3,
  parallelism: 1,
  hashLength: 32,
};
const SALT_LENGTH = 16;

// Ein Kern bleibt dem Haupt-Thread; höchstens 4 Worker (4 × 64 MiB), damit
// auch kleine Hosts (Raspberry Pi, siehe docs/deployment) nicht an
// Speicher-Grenzen stoßen.
const POOL_SIZE = Math.max(1, Math.min(availableParallelism() - 1, 4));
// ~300 ms je Operation: 32 wartende Aufgaben entsprechen bei einem Worker
// rund 10 s Wartezeit — alles darüber wird sofort mit 503 abgelehnt.
const MAX_QUEUE = 32;

let pool: PasswordHasherPool | null = null;
function getPool(): PasswordHasherPool {
  pool ??= new PasswordHasherPool({ size: POOL_SIZE, maxQueue: MAX_QUEUE });
  return pool;
}

export async function hashPassword(plainPassword: string): Promise<string> {
  return getPool().run({ kind: 'hash', password: plainPassword, salt: randomBytes(SALT_LENGTH), params: ARGON2_PARAMS });
}

// Fehlerhaftes/fremdes Hash-Format -> false statt Fehler (siehe Worker-Code).
export async function verifyPassword(plainPassword: string, encodedHash: string): Promise<boolean> {
  return getPool().run({ kind: 'verify', password: plainPassword, hash: encodedHash });
}
