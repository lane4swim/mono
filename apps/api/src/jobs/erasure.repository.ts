// apps/api/src/jobs/erasure.repository.ts
//
// Zweite Hälfte des DSGVO-Löschprozesses (Art. 17): während
// modules/profile/profile.repository.ts die SOFORTIGE Reaktion auf eine
// Löschanfrage übernimmt (Soft-Delete + DataDeletionRequest anlegen),
// kümmert sich dieses Gateway um den zeitversetzten, UNWIDERRUFLICHEN
// Hard-Purge, sobald die Aufbewahrungsfrist (purgeAfter) abgelaufen ist —
// ausgeführt über scripts/purgeDeletedData.ts (per Cron) und
// orchestriert von jobs/purgeExpiredDeletions.ts.
import type { PrismaClient } from '@prisma/client';

export interface DueErasureRequest {
  id: string;
  userId: string;
}

export interface ErasureJobGateway {
  findDuePendingRequests(now: Date): Promise<DueErasureRequest[]>;
  // Löscht UNWIDERRUFLICH: RefreshTokens, (falls verknüpft) Athlet:innen-
  // Profil inkl. Ergebnisse/Startlisteneinträge/Handlungsfelder, entfernt
  // die Anwesenheits-Einträge dieser Person aus allen Trainingseinheiten
  // des Vereins, löscht zuletzt den User-Datensatz selbst (was per
  // onDelete: Cascade auch den DataDeletionRequest-Datensatz entfernt).
  purgeUserAndDependents(userId: string): Promise<void>;
}

export class PrismaErasureJobGateway implements ErasureJobGateway {
  constructor(private readonly prisma: PrismaClient) {}

  async findDuePendingRequests(now: Date): Promise<DueErasureRequest[]> {
    const rows = await this.prisma.dataDeletionRequest.findMany({
      where: { status: 'pending', purgeAfter: { lte: now } },
      select: { id: true, userId: true },
    });
    return rows;
  }

  async purgeUserAndDependents(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) return; // bereits gelöscht (z. B. durch einen vorherigen, abgebrochenen Lauf)

    // Sicherheitskorrektur (Code-Review, Befund C4): `timeout`/`maxWait`
    // explizit über Prismas Standardwerte (5 s bzw. 2 s) hinaus angehoben —
    // zusätzliche Sicherheitsmarge zu der unten beschriebenen strukturellen
    // Korrektur (ein einzelnes UPDATE-Statement statt einer Schleife), rein
    // defensiv für einen selten laufenden Hintergrund-Job ohne
    // Nutzer:innen-Wartezeit-Anforderung. `maxWait` deckt die Wartezeit auf
    // einen freien Connection-Pool-Slot ab (relevant, wenn der Cron-Lauf
    // mehrere fällige Löschanfragen nacheinander abarbeitet), `timeout` die
    // eigentliche Transaktionslaufzeit.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await this.prisma.$transaction(async (tx: any) => {
      await tx.refreshToken.deleteMany({ where: { userId } });

      if (user.athleteId) {
        const [results, entries, actionItems] = await Promise.all([
          tx.result.findMany({ where: { athleteId: user.athleteId }, select: { id: true } }),
          tx.startlistEntry.findMany({ where: { athleteId: user.athleteId }, select: { id: true } }),
          tx.actionItem.findMany({ where: { athleteId: user.athleteId }, select: { id: true } }),
        ]);

        // Verbesserung "Tombstones": bevor die Zeilen unwiderruflich
        // gelöscht werden, je eine schlanke Löschmarkierung (nur id +
        // Zeitpunkt, keine Personendaten) anlegen. So kann die Sync-API
        // (siehe sync.gateway.ts: listChangedSince()) die Löschung auch
        // Geräten melden, die die gesamte Aufbewahrungsfrist verpasst
        // haben und sonst nie ein "delete"-Signal für diese Zeilen
        // bekommen hätten (die Zeile ist ja physisch weg).
        const now = new Date();
        const tombstones = [
          ...results.map((r: { id: string }) => ({ clubId: user.clubId!, store: 'results', entityId: r.id, deletedAt: now })),
          ...entries.map((e: { id: string }) => ({ clubId: user.clubId!, store: 'entries', entityId: e.id, deletedAt: now })),
          ...actionItems.map((a: { id: string }) => ({ clubId: user.clubId!, store: 'actionItems', entityId: a.id, deletedAt: now })),
          { clubId: user.clubId!, store: 'athletes', entityId: user.athleteId, deletedAt: now },
        ];
        await tx.syncTombstone.createMany({ data: tombstones, skipDuplicates: true });

        await tx.result.deleteMany({ where: { athleteId: user.athleteId } });
        await tx.startlistEntry.deleteMany({ where: { athleteId: user.athleteId } });
        await tx.actionItem.deleteMany({ where: { athleteId: user.athleteId } });

        // Anwesenheits-Einträge sind Teil eines JSON-Arrays je
        // Trainingseinheit (kein eigenes Tabellen-Feld), daher kein
        // schlichtes `deleteMany`/`updateMany` mit einer Feld-Bedingung.
        //
        // Sicherheitskorrektur (Code-Review, Befund C4): vormals wurden
        // ALLE Trainingseinheiten des VEREINS geladen (nicht nur die, an
        // denen diese Person überhaupt teilnahm) und einzeln per
        // JS-Schleife gefiltert + zurückgeschrieben — bei einem Verein mit
        // mehrjähriger Trainingshistorie (Tausende Zeilen) konnte allein
        // das die Laufzeit dieser interaktiven Transaktion über Prismas
        // Standard-Timeout (5 s) treiben. Da eine fehlgeschlagene
        // Transaktion die Löschanfrage unverändert "pending" belässt (siehe
        // purgeExpiredDeletions.ts), hätte ein einmal zu großer Verein
        // NIEMALS erfolgreich purgen können — bei jedem Cron-Lauf erneut
        // derselbe Timeout, obwohl der Anwendung bereits ein konkretes
        // Löschdatum zugesagt wurde (DSGVO-Konformitätsrisiko).
        //
        // Ersetzt durch EIN einzelnes SQL-UPDATE, das per JSONB-
        // Containment (`@>`) direkt nur die Zeilen trifft, die den Eintrag
        // dieser Person tatsächlich enthalten — alle anderen Einheiten des
        // Vereins werden weder gelesen noch geschrieben, unabhängig von der
        // Gesamtgröße des Vereins. `elem->>'athleteId' IS DISTINCT FROM`
        // statt `!=` behandelt einen (im Schema nicht vorgesehenen, aber
        // defensiv abgedeckten) fehlenden `athleteId`-Schlüssel NULL-sicher.
        // `COALESCE(..., '[]'::jsonb)`: entfernt das Filtern den EINZIGEN
        // Eintrag einer Zeile, liefert `jsonb_agg` über eine leere
        // Ergebnismenge `NULL` statt eines leeren Arrays — ohne COALESCE
        // würde die Spalte fälschlich auf SQL NULL gesetzt, obwohl
        // `attendance` laut Schema stets ein (ggf. leeres) Array ist.
        // `"updatedAt" = now()` von Hand gesetzt, weil ein rohes SQL-UPDATE
        // (anders als Prismas eigene update()-Methoden) das `@updatedAt`-
        // Verhalten aus schema.prisma NICHT automatisch auslöst — ohne
        // diese Zeile bliebe der Sync-Pull-Cursor (sync.gateway.ts:
        // listChangedSince() sortiert/filtert exakt nach diesem Feld) auf
        // dem alten Stand, und Geräte, die die Einheit bereits vor dem
        // Purge gepullt hatten, bekämen die bereinigte Fassung nie
        // zugestellt — die gelöschte Person bliebe für sie sichtbar.
        if (user.clubId) {
          await tx.$executeRaw`
            UPDATE "sessions"
            SET
              "attendance" = COALESCE(
                (
                  SELECT jsonb_agg(elem)
                  FROM jsonb_array_elements("attendance") AS elem
                  WHERE elem->>'athleteId' IS DISTINCT FROM ${user.athleteId}
                ),
                '[]'::jsonb
              ),
              "updatedAt" = now()
            WHERE "clubId" = ${user.clubId}
              AND "attendance" @> ${JSON.stringify([{ athleteId: user.athleteId }])}::jsonb
          `;
        }

        await tx.athlete.delete({ where: { id: user.athleteId } });
      }

      // Löscht in derselben Transaktion auch den zugehörigen
      // DataDeletionRequest-Datensatz (onDelete: Cascade im Schema).
      await tx.user.delete({ where: { id: userId } });
    }, { timeout: 30_000, maxWait: 10_000 });
  }
}
