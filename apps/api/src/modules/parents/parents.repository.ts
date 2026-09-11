// Repository-Pattern für die Eltern-Kind-Verknüpfung (ParentLink, Phase 2,
// Abschnitt 4.2 — docs/Plans/phase2-plan.md).
import type { PrismaClient } from '@prisma/client';

export interface ParentLinkRecord {
  id: string;
  userId: string;
  athleteId: string;
  createdAt: Date;
}

export interface ParentLinkRepository {
  create(userId: string, athleteId: string): Promise<ParentLinkRecord>;
  listByUser(userId: string): Promise<ParentLinkRecord[]>;
  remove(userId: string, athleteId: string): Promise<void>;
}

export class PrismaParentLinkRepository implements ParentLinkRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(userId: string, athleteId: string): Promise<ParentLinkRecord> {
    // upsert statt create: acceptInvitation() (auth.service.ts) UND die
    // Admin-Verknüpfungsverwaltung (parents.route.ts) können auf dieselbe
    // (userId, athleteId)-Kombination treffen (z. B. wenn ein Admin eine
    // bereits per Einladung entstandene Verknüpfung erneut anlegt) — ein
    // reines create() würde dann am @@unique-Constraint scheitern, obwohl
    // fachlich nichts Neues passiert.
    return this.prisma.parentLink.upsert({
      where: { userId_athleteId: { userId, athleteId } },
      create: { userId, athleteId },
      update: {},
    });
  }

  async listByUser(userId: string): Promise<ParentLinkRecord[]> {
    return this.prisma.parentLink.findMany({ where: { userId } });
  }

  async remove(userId: string, athleteId: string): Promise<void> {
    await this.prisma.parentLink.deleteMany({ where: { userId, athleteId } });
  }
}

// Erfüllt ParentsAthleteLookup (parents.service.ts) — eigene, schlanke
// Implementierung statt invitations.repository.ts: PrismaAthleteRepository
// wiederzuverwenden, da diese nur { id, clubId } liefert (für die
// Fremdschlüssel-Prüfung dort ausreichend); parents.service.ts braucht
// zusätzlich firstName/lastName für die Admin-Verknüpfungsübersicht.
export class PrismaParentsAthleteLookup {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: string) {
    return this.prisma.athlete.findUnique({
      where: { id },
      select: { id: true, clubId: true, firstName: true, lastName: true },
    });
  }
}
