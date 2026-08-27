// apps/api/src/jobs/erasure.repository.memory.ts
import { ANONYMIZED_INVITATION_EMAIL, type ErasureJobGateway, type DueErasureRequest } from './erasure.repository.js';
import type { TombstoneRecord } from '../modules/sync/sync.gateway.js';
import { anonymizePlanCommentAuthors, anonymizeExerciseCommentAuthors, anonymizeTemplateCommentAuthors } from './commentAnonymization.js';

export interface InMemoryErasureDatabase {
  users: Array<{ id: string; clubId: string | null; athleteId: string | null; [key: string]: unknown }>;
  athletes: Array<{ id: string; [key: string]: unknown }>;
  results: Array<{ id: string; athleteId: string; [key: string]: unknown }>;
  entries: Array<{ id: string; athleteId: string; [key: string]: unknown }>;
  actionItems: Array<{ id: string; athleteId: string; [key: string]: unknown }>;
  sessions: Array<{ id: string; clubId: string; attendance: Array<{ athleteId?: string; [key: string]: unknown }> }>;
  // Optional (Sicherheitsreview 2026-08, Befund N5) — nicht jeder
  // bestehende Test braucht diese Stores, siehe commentAnonymization.ts.
  plans?: Array<{ id: string; clubId: string; comments: unknown; days: unknown }>;
  exercises?: Array<{ id: string; clubId: string; comments: unknown }>;
  templates?: Array<{ id: string; clubId: string; sets: unknown }>;
  // Optional (Sicherheitsreview 2026-08-27, Befund M1) — siehe
  // erasure.repository.ts (Prisma-Pendant) für die ausführliche
  // Begründung.
  invitations?: Array<{ email: string; athleteId?: string | null; [key: string]: unknown }>;
  refreshTokens: Array<{ id: string; userId: string }>;
  // Kein `status`/`purgedAt` mehr (Code-Review, Befund R8) — analog zur
  // Prisma-Implementierung ist jede noch VORHANDENE Zeile implizit
  // "pending"; eine abgearbeitete wird unten (wie onDelete: Cascade)
  // schlicht aus dem Array entfernt.
  deletionRequests: Array<{ id: string; userId: string; purgeAfter: Date }>;
  // Dieselbe Array-Referenz kann in Tests auch an InMemorySyncGateway
  // übergeben werden — so lässt sich end-to-end nachstellen, dass eine
  // vom Purge-Job geschriebene Löschmarkierung anschließend über
  // sync.service.ts's pull() sichtbar wird. Optional, da nicht jeder Test
  // diese Verzahnung braucht.
  tombstones?: TombstoneRecord[];
}

export class InMemoryErasureJobGateway implements ErasureJobGateway {
  constructor(private readonly db: InMemoryErasureDatabase) {}

  async findDuePendingRequests(now: Date): Promise<DueErasureRequest[]> {
    return this.db.deletionRequests
      .filter((r) => r.purgeAfter.getTime() <= now.getTime())
      .map((r) => ({ id: r.id, userId: r.userId }));
  }

  async purgeUserAndDependents(userId: string): Promise<void> {
    const user = this.db.users.find((u) => u.id === userId);
    if (!user) return;

    this.db.refreshTokens = this.db.refreshTokens.filter((t) => t.userId !== userId);

    if (user.athleteId) {
      const now = new Date();
      const clubId = (user.clubId ?? '') as string;
      const purgedResults = this.db.results.filter((r) => r.athleteId === user.athleteId);
      const purgedEntries = this.db.entries.filter((e) => e.athleteId === user.athleteId);
      const purgedActionItems = this.db.actionItems.filter((a) => a.athleteId === user.athleteId);

      if (this.db.tombstones) {
        this.db.tombstones.push(
          ...purgedResults.map((r): TombstoneRecord => ({ clubId, store: 'results', entityId: r.id, deletedAt: now })),
          ...purgedEntries.map((e): TombstoneRecord => ({ clubId, store: 'entries', entityId: e.id, deletedAt: now })),
          ...purgedActionItems.map((a): TombstoneRecord => ({ clubId, store: 'actionItems', entityId: a.id, deletedAt: now })),
          { clubId, store: 'athletes', entityId: user.athleteId, deletedAt: now },
        );
      }

      this.db.results = this.db.results.filter((r) => r.athleteId !== user.athleteId);
      this.db.entries = this.db.entries.filter((e) => e.athleteId !== user.athleteId);
      this.db.actionItems = this.db.actionItems.filter((a) => a.athleteId !== user.athleteId);
      this.db.sessions
        .filter((s) => s.clubId === user.clubId)
        .forEach((s) => { s.attendance = s.attendance.filter((a) => a.athleteId !== user.athleteId); });
      this.db.athletes = this.db.athletes.filter((a) => a.id !== user.athleteId);
    }

    // Sicherheitskorrektur (Sicherheitsreview 2026-08, Befund N5) — siehe
    // ausführliche Begründung in erasure.repository.ts (Prisma-Pendant)
    // bzw. commentAnonymization.ts. Bewusst NICHT an `user.athleteId`
    // gekoppelt (anders als der Block oben), da Kommentare ebenso von
    // Trainer:innen/Admins ohne athleteId stammen.
    if (user.clubId && typeof user.name === 'string') {
      const clubId = user.clubId;
      const authorName = user.name;
      for (const plan of this.db.plans ?? []) {
        if (plan.clubId !== clubId) continue;
        const { changed, comments, days } = anonymizePlanCommentAuthors(plan, authorName);
        if (changed) { plan.comments = comments; plan.days = days; }
      }
      for (const exercise of this.db.exercises ?? []) {
        if (exercise.clubId !== clubId) continue;
        const { changed, comments } = anonymizeExerciseCommentAuthors(exercise, authorName);
        if (changed) exercise.comments = comments;
      }
      for (const template of this.db.templates ?? []) {
        if (template.clubId !== clubId) continue;
        const { changed, sets } = anonymizeTemplateCommentAuthors(template, authorName);
        if (changed) template.sets = sets;
      }
    }

    // Sicherheitsreview 2026-08-27, Befund M1 — siehe ausführliche
    // Begründung im Prisma-Pendant (erasure.repository.ts).
    if (typeof user.email === 'string') {
      for (const invitation of this.db.invitations ?? []) {
        if (invitation.email === user.email) {
          invitation.email = ANONYMIZED_INVITATION_EMAIL;
          invitation.athleteId = null;
        }
      }
    }

    this.db.users = this.db.users.filter((u) => u.id !== userId);
    // onDelete: Cascade-Äquivalent — der Deletion-Request verschwindet mit.
    this.db.deletionRequests = this.db.deletionRequests.filter((r) => r.userId !== userId);
  }
}
