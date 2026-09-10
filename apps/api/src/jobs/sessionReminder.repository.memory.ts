// In-Memory-Implementierung für Tests von jobs/notifyUpcomingSessions.ts
// ohne Datenbank — analog qualificationReminder.repository.memory.ts.
import type { NotifyUpcomingSessionsGateway, UpcomingSessionCandidate } from './sessionReminder.repository.js';

export class InMemoryNotifyUpcomingSessionsGateway implements NotifyUpcomingSessionsGateway {
  private sentLog = new Set<string>();

  constructor(
    private readonly sessions: UpcomingSessionCandidate[] = [],
    private readonly recipientsByClubAndGroup: Map<string, string[]> = new Map(),
  ) {}

  async findUpcomingSessionsNeedingReminder(now: Date, windowEnd: Date): Promise<UpcomingSessionCandidate[]> {
    return this.sessions.filter(
      (s) => s.date.getTime() >= now.getTime() && s.date.getTime() <= windowEnd.getTime() && !this.sentLog.has(s.id),
    );
  }

  async findRecipientUserIds(clubId: string, groupId: string | null): Promise<string[]> {
    return this.recipientsByClubAndGroup.get(`${clubId}:${groupId ?? ''}`) ?? [];
  }

  async hasReminderBeenSent(sessionId: string): Promise<boolean> {
    return this.sentLog.has(sessionId);
  }

  async recordReminderSent(sessionId: string): Promise<void> {
    this.sentLog.add(sessionId);
  }
}
