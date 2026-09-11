// Gemeinsame Abfrage "trainer/admin-Konten eines Vereins" — Code-Review-
// Korrektur: stand zuvor als fast wortgleiche Kopie in
// modules/sync/announcementRecipients.repository.ts UND
// jobs/sessionReminder.repository.ts, beide Push-Auslöser, die dieselbe
// Empfänger:innen-Regel ("Staff bekommt jede Benachrichtigung ihres
// Vereins, unabhängig von der übrigen Teilnehmer:innen-/Gruppen-Auswahl")
// teilen. Eine künftige Änderung an dieser Regel (z. B. eine weitere
// Team-Rolle) muss dadurch nur noch an einer Stelle gepflegt werden.
import type { PrismaClient } from '@prisma/client';

export async function findClubStaffUserIds(prisma: PrismaClient, clubId: string): Promise<string[]> {
  const staff = await prisma.user.findMany({
    where: { clubId, deletedAt: null, OR: [{ roles: { has: 'trainer' } }, { roles: { has: 'admin' } }] },
    select: { id: true },
  });
  return staff.map((u) => u.id);
}
