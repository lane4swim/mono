// Zentrale Stelle für die wiederkehrenden Zugriffsprüfungen "gehört die
// anfragende Person zu einem Verein", "ist sie dort admin", "gehört die
// Zielperson zu demselben Verein" und "darf sie auf einen per clubId
// angegebenen Verein zugreifen" sowie für den Umgang mit
// personenbezogenen, per Soft-Delete entfernbaren Datensätzen
// (Qualifikationen, Kampfrichtereinsätze, …). Services rufen diese
// Funktionen auf, statt die Prüfungen selbst nachzubauen — eine Änderung
// an einer dieser Regeln (z. B. eine weitere berechtigte Rolle) wird damit
// an genau einer Stelle wirksam.
//
// Jede Prüfung nimmt optional die zu werfende Fehlerklasse entgegen
// (Standard: ForbiddenError bzw. eine vom Aufrufer übergebene
// Unterklasse), damit Module ihre eigene, unterscheidbare Klasse behalten
// können; die HTTP-Abbildung bleibt über die gemeinsame Basisklasse
// dieselbe (siehe errors.ts).
import type { Requester } from '../../plugins/requester.js';
import type { UserRecord, UserRepository } from '../auth/auth.repository.js';
import { UserNotFoundError } from '../auth/auth.service.js';
import { ForbiddenError } from './errors.js';

type ErrorClass = new (message?: string) => Error;

// Ein Requester, für den requireClub()/requireClubAdmin() bereits
// sichergestellt haben, dass ein Verein gesetzt ist.
export type ClubRequester<R extends Pick<Requester, 'clubId'> = Requester> = R & { clubId: string };

export const CLUB_REQUIRED_MESSAGE = 'Für diese Aktion ist ein Verein erforderlich.';
export const NOT_SAME_CLUB_MESSAGE = 'Diese Person gehört nicht zu Ihrem Verein.';

// Die anfragende Person muss einem Verein angehören (schließt superadmin
// aus). Verengt `requester.clubId` danach auf `string`.
export function requireClub<R extends Pick<Requester, 'clubId'>>(
  requester: R,
  message: string = CLUB_REQUIRED_MESSAGE,
  Forbidden: ErrorClass = ForbiddenError,
): asserts requester is ClubRequester<R> {
  if (!requester.clubId) throw new Forbidden(message);
}

// Die anfragende Person muss admin sein UND einem Verein angehören — die
// Voraussetzung für jede Verwaltung von Daten des eigenen Vereins.
export function requireClubAdmin<R extends Pick<Requester, 'roles' | 'clubId'>>(
  requester: R,
  message: string,
  Forbidden: ErrorClass = ForbiddenError,
): asserts requester is ClubRequester<R> {
  if (!requester.roles.includes('admin') || !requester.clubId) throw new Forbidden(message);
}

export interface AdminOfSameClubOptions {
  // superadmin (gehört zu keinem Verein) darf jede Zielperson verwalten,
  // ohne Vereinsabgleich — z. B. das Zurücksetzen der
  // Zwei-Faktor-Anmeldung. Ohne diese Option wird superadmin wie jede
  // andere Nicht-Admin-Rolle abgewiesen.
  allowSuperadmin?: boolean;
}

// requireClubAdmin() plus: die Zielperson existiert und gehört zum
// selben Verein. Liefert den geladenen Datensatz der Zielperson zurück,
// damit der Aufrufer ihn nicht erneut laden muss. Eine unbekannte
// Zielperson ergibt UserNotFoundError (404), eine vereinsfremde die
// übergebene Fehlerklasse (403). Eine Zielperson ohne Verein (superadmin)
// gehört nie "zum selben Verein" eines admins, da dessen clubId nach
// requireClubAdmin() immer gesetzt ist.
export async function requireAdminOfSameClub(
  users: Pick<UserRepository, 'findById'>,
  requester: Requester,
  targetUserId: string,
  notAdminMessage: string,
  Forbidden: ErrorClass = ForbiddenError,
  options: AdminOfSameClubOptions = {},
): Promise<UserRecord> {
  const asSuperadmin = options.allowSuperadmin === true && requester.roles.includes('superadmin');
  if (!asSuperadmin) requireClubAdmin(requester, notAdminMessage, Forbidden);
  const targetUser = await users.findById(targetUserId);
  if (!targetUser) throw new UserNotFoundError();
  if (!asSuperadmin && targetUser.clubId !== requester.clubId) throw new Forbidden(NOT_SAME_CLUB_MESSAGE);
  return targetUser;
}

// Für Endpunkte, deren Ziel ein per clubId angegebener Verein ist (etwa
// /api/clubs/:id/...): jedes Mitglied des Vereins darf zugreifen,
// superadmin auf jeden Verein.
export function requireOwnClubOrSuperadmin(
  requester: Pick<Requester, 'roles' | 'clubId'>,
  clubId: string,
  message: string,
  Forbidden: ErrorClass = ForbiddenError,
): void {
  if (requester.roles.includes('superadmin')) return;
  if (requester.clubId !== clubId) throw new Forbidden(message);
}

// Wie requireOwnClubOrSuperadmin(), aber nur für admins des Vereins (plus
// superadmin für jeden Verein). Prüft die Rolle selbst, statt sich allein
// auf requireAnyRole() der Route zu verlassen.
export function requireClubAdminOrSuperadmin(
  requester: Pick<Requester, 'roles' | 'clubId'>,
  clubId: string,
  message: string,
  Forbidden: ErrorClass = ForbiddenError,
): void {
  if (requester.roles.includes('superadmin')) return;
  if (!requester.roles.includes('admin') || requester.clubId !== clubId) throw new Forbidden(message);
}

// Entfernt `deletedAt` aus einer API-Antwort — reine interne Buchhaltung
// des Soft-Deletes ohne legitimen Grund, sie auszuliefern
// (Datenminimierung).
export function withoutDeletedAt<T extends { deletedAt: unknown }>(row: T): Omit<T, 'deletedAt'> {
  const { deletedAt: _deletedAt, ...publicRow } = row;
  return publicRow;
}

// Lädt einen personenbezogenen Datensatz und stellt sicher, dass er der
// erwarteten Person gehört und nicht per Soft-Delete entfernt ist. Alle
// drei Fälle (unbekannt, fremd, gelöscht) ergeben bewusst denselben
// NotFound-Fehler — ein fremder Datensatz soll sich nicht von einem
// nicht existierenden unterscheiden lassen.
export async function findActiveOwnedOrThrow<T extends { userId: string; deletedAt: Date | null }>(
  repository: { findById(id: string): Promise<T | null> },
  ownerUserId: string,
  id: string,
  NotFound: new () => Error,
): Promise<T> {
  const existing = await repository.findById(id);
  if (!existing || existing.userId !== ownerUserId || existing.deletedAt) throw new NotFound();
  return existing;
}
