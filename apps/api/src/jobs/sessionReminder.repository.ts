// Datenzugriff für jobs/notifyUpcomingSessions.ts — analog
// qualificationReminder.repository.ts: eine schlanke Gateway-Schnittstelle,
// zugeschnitten genau auf das, was der Job braucht.
import type { PrismaClient } from '@prisma/client';
import { findClubStaffUserIds } from '../db/clubStaff.js';

export interface UpcomingSessionCandidate {
  id: string;
  clubId: string;
  // athleteIds statt groupId: aus TrainingSession.attendance abgeleitet
  // (Code-Review-Korrektur) — die tatsächliche Teilnehmer:innen-Liste
  // dieser EINEN Einheit ist die genauere, verlässlichere Quelle für "wer
  // soll erinnert werden" als eine erneute Abfrage des AKTUELLEN
  // Gruppen-Rosters: Athletenrollen können sich zwischen Anlegen der
  // Einheit und Fälligkeit der Erinnerung ändern (siehe sessions.js:
  // attendanceFor() — die Anwesenheitsliste wird beim Anlegen aus dem
  // damaligen Gruppen-Stand befüllt, danach unabhängig davon gepflegt).
  // Erfasst zusätzlich Ad-hoc-Einheiten OHNE groupId, für die die
  // vorherige gruppenbasierte Abfrage überhaupt keine Athlet:innen fand.
  athleteIds: string[];
  date: Date;
}

export interface NotifyUpcomingSessionsGateway {
  // Nur Einheiten aus Vereinen, die das Modul 'sessions' gebucht haben,
  // innerhalb des Erinnerungsfensters, ohne bestehenden
  // SessionReminderLog-Eintrag (siehe schema.prisma: SessionReminderLog).
  findUpcomingSessionsNeedingReminder(now: Date, windowEnd: Date): Promise<UpcomingSessionCandidate[]>;
  // Konto-IDs der an dieser Einheit teilnehmenden Athlet:innen (siehe
  // UpcomingSessionCandidate.athleteIds-Kommentar) PLUS aller
  // trainer/admin-Konten des Vereins — eine gemeinsame Abfrage statt zwei
  // getrennter, da beide Empfänger:innen-Mengen dieselbe Benachrichtigung
  // bekommen.
  findRecipientUserIds(clubId: string, athleteIds: readonly string[]): Promise<string[]>;
  hasReminderBeenSent(sessionId: string): Promise<boolean>;
  recordReminderSent(sessionId: string): Promise<void>;
}

// TrainingSession.attendance ist ein ungetyptes Json-Feld (siehe
// AttendanceRecordSchema in packages/shared-types/src/entities.ts) — hier
// defensiv statt mit einem `as`-Cast gelesen, analog sync.athleteScope.ts.
function extractAthleteIds(attendance: unknown): string[] {
  if (!Array.isArray(attendance)) return [];
  return attendance
    .map((entry) => (entry as { athleteId?: unknown } | null)?.athleteId)
    .filter((id): id is string => typeof id === 'string');
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
      select: { id: true, clubId: true, attendance: true, date: true },
    });
    return rows.map((row) => ({ id: row.id, clubId: row.clubId, athleteIds: extractAthleteIds(row.attendance), date: row.date }));
  }

  async findRecipientUserIds(clubId: string, athleteIds: readonly string[]): Promise<string[]> {
    const [staffIds, athleteAccounts] = await Promise.all([
      findClubStaffUserIds(this.prisma, clubId),
      athleteIds.length > 0
        ? this.prisma.user.findMany({
            where: { clubId, deletedAt: null, athleteId: { in: [...athleteIds] } },
            select: { id: true },
          })
        : Promise.resolve([]),
    ]);
    return [...new Set([...staffIds, ...athleteAccounts.map((u) => u.id)])];
  }

  async hasReminderBeenSent(sessionId: string): Promise<boolean> {
    const existing = await this.prisma.sessionReminderLog.findUnique({ where: { sessionId } });
    return existing !== null;
  }

  async recordReminderSent(sessionId: string): Promise<void> {
    await this.prisma.sessionReminderLog.create({ data: { sessionId } });
  }
}
