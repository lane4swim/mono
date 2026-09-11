// In-Memory-Implementierung für Tests von jobs/notifyUpcomingSessions.ts
// ohne Datenbank — analog qualificationReminder.repository.memory.ts.
import type { NotifyUpcomingSessionsGateway, UpcomingSessionCandidate } from './sessionReminder.repository.js';

export class InMemoryNotifyUpcomingSessionsGateway implements NotifyUpcomingSessionsGateway {
  private sentLog = new Set<string>();

  constructor(
    private readonly sessions: UpcomingSessionCandidate[] = [],
    // Staff-Konten je Verein (trainer/admin) — bekommen JEDE Erinnerung
    // dieses Vereins, unabhängig von der Teilnehmer:innen-Liste.
    private readonly staffByClub: Map<string, string[]> = new Map(),
    // athleteId -> Konto-ID, analog dem echten User.athleteId-Fremdschlüssel.
    private readonly userIdByAthleteId: Map<string, string> = new Map(),
  ) {}

  async findUpcomingSessionsNeedingReminder(now: Date, windowEnd: Date): Promise<UpcomingSessionCandidate[]> {
    return this.sessions.filter(
      (s) => s.date.getTime() >= now.getTime() && s.date.getTime() <= windowEnd.getTime() && !this.sentLog.has(s.id),
    );
  }

  async findRecipientUserIds(clubId: string, athleteIds: readonly string[]): Promise<string[]> {
    const staff = this.staffByClub.get(clubId) ?? [];
    const athleteUsers = athleteIds.map((id) => this.userIdByAthleteId.get(id)).filter((id): id is string => !!id);
    return [...new Set([...staff, ...athleteUsers])];
  }

  async hasReminderBeenSent(sessionId: string): Promise<boolean> {
    return this.sentLog.has(sessionId);
  }

  async recordReminderSent(sessionId: string): Promise<void> {
    this.sentLog.add(sessionId);
  }
}
