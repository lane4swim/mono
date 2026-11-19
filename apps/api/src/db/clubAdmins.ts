// "Kein Verein ohne Admin": gemeinsame Prüfung für jede Schreiboperation,
// die einer Person die admin-Rolle nehmen oder sie deaktivieren kann
// (Rollenänderung, Selbstlöschung). Muss INNERHALB der Transaktion laufen,
// die anschließend schreibt.
//
// Die Vereinszeile wird zuerst gesperrt und dient so als Mutex je Verein:
// zwei solcher Transaktionen für denselben Verein laufen nacheinander, und
// die Zählung danach sieht (READ COMMITTED, neuer Snapshot je Anweisung)
// das Ergebnis der jeweils vorher abgeschlossenen. FOR NO KEY UPDATE statt
// FOR UPDATE, damit gleichzeitige Inserts mit Fremdschlüssel auf den Verein
// (neue Mitglieder, Gruppen, …) nicht blockiert werden.
import { LastAdminError } from '../modules/shared/errors.js';

export interface ClubAdminTx {
  $queryRaw(query: TemplateStringsArray, ...values: unknown[]): Promise<unknown>;
  user: { count(args: { where: Record<string, unknown> }): Promise<number> };
}

export async function lockClubForAdminChange(tx: ClubAdminTx, clubId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM "clubs" WHERE id = ${clubId} FOR NO KEY UPDATE`;
}

// Erwartet, dass lockClubForAdminChange() in derselben Transaktion bereits
// gelaufen ist.
export async function assertAnotherAdminRemains(tx: ClubAdminTx, clubId: string, userId: string): Promise<void> {
  const others = await tx.user.count({
    where: { clubId, deletedAt: null, roles: { has: 'admin' }, NOT: { id: userId } },
  });
  if (others === 0) throw new LastAdminError();
}
