// Datenzugriff für jobs/notifyUpcomingSessions.ts — analog
// qualificationReminder.repository.ts: eine schlanke Gateway-Schnittstelle,
// zugeschnitten genau auf das, was der Job braucht.
import type { PrismaClient } from '@prisma/client';

export interface UpcomingSessionCandidate {
  id: string;
  clubId: string;
  groupId: string | null;
  date: Date;
}

export interface NotifyUpcomingSessionsGateway {
  // Nur Einheiten aus Vereinen, die das Modul 'sessions' gebucht haben,
  // innerhalb des Erinnerungsfensters, ohne bestehenden
  // SessionReminderLog-Eintrag (siehe schema.prisma: SessionReminderLog).
  findUpcomingSessionsNeedingReminder(now: Date, windowEnd: Date): Promise<UpcomingSessionCandidate[]>;
  // Konto-IDs der Athlet:innen einer Gruppe PLUS aller trainer/admin-Konten
  // des Vereins — eine gemeinsame Abfrage statt zwei getrennter, da beide
  // Empfänger:innen-Mengen dieselbe Benachrichtigung bekommen.
  findRecipientUserIds(clubId: string, groupId: string | null): Promise<string[]>;
  hasReminderBeenSent(sessionId: string): Promise<boolean>;
  recordReminderSent(sessionId: string): Promise<void>;
}

export class PrismaNotifyUpcomingSessionsGateway implements NotifyUpcomingSessionsGateway {
  constructor(private readonly prisma: PrismaClient) {}

  async findUpcomingSessionsNeedingReminder(now: Date, windowEnd: Date): Promise<UpcomingSessionCandidate[]> {
    const rows = await this.prisma.trainingSession.findMany({
      where: {
        deletedAt: null,
        date: { gte: now, lte: windowEnd },
        club: { enabledModules: { has: 'sessions' } },
        reminderLog: null,
      },
      select: { id: true, clubId: true, groupId: true, date: true },
    });
    return rows;
  }

  async findRecipientUserIds(clubId: string, groupId: string | null): Promise<string[]> {
    const [staff, athleteAccounts] = await Promise.all([
      this.prisma.user.findMany({
        where: { clubId, deletedAt: null, OR: [{ roles: { has: 'trainer' } }, { roles: { has: 'admin' } }] },
        select: { id: true },
      }),
      groupId
        ? this.prisma.user.findMany({
            where: { clubId, deletedAt: null, athlete: { groupId, deletedAt: null } },
            select: { id: true },
          })
        : Promise.resolve([]),
    ]);
    return [...new Set([...staff, ...athleteAccounts].map((u) => u.id))];
  }

  async hasReminderBeenSent(sessionId: string): Promise<boolean> {
    const existing = await this.prisma.sessionReminderLog.findUnique({ where: { sessionId } });
    return existing !== null;
  }

  async recordReminderSent(sessionId: string): Promise<void> {
    await this.prisma.sessionReminderLog.create({ data: { sessionId } });
  }
}
