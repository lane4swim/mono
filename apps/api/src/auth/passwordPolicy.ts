// Anforderungen an ein NEUES Passwort (Issue #97), zusätzlich zur
// Schema-Prüfung in packages/shared-types/src/auth.ts (8–200 Zeichen):
//   - Konten mit admin- oder superadmin-Rolle brauchen mindestens 12 Zeichen.
//     Die Rolle kennt erst der Server (Einladung, bestehendes Konto), daher
//     hier statt im gemeinsamen Zod-Schema.
//   - Kein Passwort aus bekannten Leak-Sammlungen (data/common-passwords.txt.gz,
//     Herkunft siehe data/README.md). Bewusst eine mitgelieferte Liste statt
//     eines Online-Dienstes: keine ausgehende Verbindung, kein Datenabfluss.
//     Abgleich ohne Groß-/Kleinschreibung — "Passwort123" ist nicht stärker
//     als "passwort123".
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

export const PRIVILEGED_PASSWORD_MIN_LENGTH = 12;
const PRIVILEGED_ROLES = ['admin', 'superadmin'];

export class PasswordTooShortForRoleError extends Error {
  constructor() {
    super(`Für Konten mit Administrationsrechten muss das Passwort mindestens ${PRIVILEGED_PASSWORD_MIN_LENGTH} Zeichen lang sein.`);
  }
}

export class CommonPasswordError extends Error {
  constructor() {
    super('Dieses Passwort ist aus bekannten Datenlecks bekannt und zu leicht zu erraten. Bitte ein anderes wählen.');
  }
}

let commonPasswords: Set<string> | null = null;
function loadCommonPasswords(): Set<string> {
  // Relativ zu dieser Datei: src/auth/ (tsx/vitest) wie dist/auth/ (Build)
  // liegen gleich tief unter apps/api/.
  const file = new URL('../../data/common-passwords.txt.gz', import.meta.url);
  commonPasswords ??= new Set(gunzipSync(readFileSync(file)).toString('utf8').split('\n').filter(Boolean));
  return commonPasswords;
}

export function isCommonPassword(password: string): boolean {
  return loadCommonPasswords().has(password.toLowerCase());
}

// Wirft, wenn `password` für ein Konto mit diesen Rollen nicht zulässig ist.
export function assertPasswordPolicy(password: string, roles: readonly string[]): void {
  if (roles.some((role) => PRIVILEGED_ROLES.includes(role)) && password.length < PRIVILEGED_PASSWORD_MIN_LENGTH) {
    throw new PasswordTooShortForRoleError();
  }
  if (isCommonPassword(password)) throw new CommonPasswordError();
}
