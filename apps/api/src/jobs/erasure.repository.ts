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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await this.prisma.$transaction(async (tx: any) => {
      await tx.refreshToken.deleteMany({ where: { userId } });

      if (user.athleteId) {
        await tx.result.deleteMany({ where: { athleteId: user.athleteId } });
        await tx.startlistEntry.deleteMany({ where: { athleteId: user.athleteId } });
        await tx.actionItem.deleteMany({ where: { athleteId: user.athleteId } });

        // Anwesenheits-Einträge sind Teil eines JSON-Arrays je
        // Trainingseinheit (kein eigenes Tabellen-Feld) — daher: alle
        // Einheiten des Vereins laden, den Eintrag dieser Person
        // herausfiltern, nur geänderte Zeilen zurückschreiben.
        const sessions = await tx.trainingSession.findMany({ where: { clubId: user.clubId ?? undefined } });
        for (const session of sessions) {
          const attendance = session.attendance as Array<{ athleteId?: string }>;
          const filtered = attendance.filter((a) => a.athleteId !== user.athleteId);
          if (filtered.length !== attendance.length) {
            await tx.trainingSession.update({ where: { id: session.id }, data: { attendance: filtered } });
          }
        }

        await tx.athlete.delete({ where: { id: user.athleteId } });
      }

      // Löscht in derselben Transaktion auch den zugehörigen
      // DataDeletionRequest-Datensatz (onDelete: Cascade im Schema).
      await tx.user.delete({ where: { id: userId } });
    });
  }
}
