// Datenzugriff für den Push-Auslöse-Hook bei einem neuen Announcement
// (sync.route.ts: notifyAnnouncementCreated(), Phase 2, Abschnitt 2.4 —
// docs/Plans/phase2-plan.md). Eigene, schlanke Gateway-Schnittstelle statt
// der vollen sync.gateway.ts-Interfaces — analog zu
// jobs/sessionReminder.repository.ts.
import type { PrismaClient } from '@prisma/client';

export interface AnnouncementRecipientsGateway {
  // null groupId = an den gesamten Verein gerichtet -> ALLE aktiven
  // Konten des Vereins; gesetzte groupId = nur trainer/admin (die auch
  // gruppenübergreifend zuständig bleiben) PLUS die athletenseitig
  // verknüpften Konten dieser einen Gruppe. `excludeUserId` blendet die
  // verfassende Person selbst aus (kein Push an die eigene Ankündigung).
  findRecipientUserIds(clubId: string, groupId: string | null, excludeUserId: string): Promise<string[]>;
}

export class PrismaAnnouncementRecipientsGateway implements AnnouncementRecipientsGateway {
  constructor(private readonly prisma: PrismaClient) {}

  async findRecipientUserIds(clubId: string, groupId: string | null, excludeUserId: string): Promise<string[]> {
    if (!groupId) {
      const rows = await this.prisma.user.findMany({ where: { clubId, deletedAt: null }, select: { id: true } });
      return rows.map((r) => r.id).filter((id) => id !== excludeUserId);
    }
    const [staff, athleteAccounts] = await Promise.all([
      this.prisma.user.findMany({
        where: { clubId, deletedAt: null, OR: [{ roles: { has: 'trainer' } }, { roles: { has: 'admin' } }] },
        select: { id: true },
      }),
      this.prisma.user.findMany({
        where: { clubId, deletedAt: null, athlete: { groupId, deletedAt: null } },
        select: { id: true },
      }),
    ]);
    return [...new Set([...staff, ...athleteAccounts].map((u) => u.id))].filter((id) => id !== excludeUserId);
  }
}
