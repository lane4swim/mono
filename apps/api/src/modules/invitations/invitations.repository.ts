// apps/api/src/modules/invitations/invitations.repository.ts
//
// Repository-Pattern (wie schon in modules/auth) — die Service-Logik hängt
// nur von diesen Interfaces ab, nie direkt von Prisma. Ermöglicht
// vollständig datenbankfreie Tests der Autorisierungs- und Ablauflogik.
import type { PrismaClient } from '@prisma/client';

export interface ClubRecord {
  id: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateClubInput {
  name: string;
}

export interface ClubMemberCounts {
  admin: number;
  trainer: number;
  athlete: number;
}

export interface ClubRepository {
  create(input: CreateClubInput): Promise<ClubRecord>;
  findById(id: string): Promise<ClubRecord | null>;
  list(): Promise<ClubRecord[]>;
  // Für die Superadmin-Oberfläche ("/admin"): Anzahl aktiver (nicht
  // gelöschter) Mitglieder je Rolle, für mehrere Vereine auf einmal
  // (vermeidet N+1-Abfragen bei der Vereinsliste).
  countMembersForClubs(clubIds: string[]): Promise<Map<string, ClubMemberCounts>>;
}

export interface InvitationRecord {
  id: string;
  tokenHash: string;
  email: string;
  role: string; // 'admin' | 'trainer' | 'athlete'
  clubId: string | null;
  athleteId: string | null;
  // null nur, wenn das einladende Konto zwischenzeitlich selbst gelöscht
  // wurde (siehe schema.prisma: Invitation.invitedById, onDelete: SetNull).
  invitedById: string | null;
  expiresAt: Date;
  usedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

export interface CreateInvitationInput {
  tokenHash: string;
  email: string;
  role: string;
  clubId: string | null;
  athleteId: string | null;
  invitedById: string;
  expiresAt: Date;
}

export interface InvitationRepository {
  create(input: CreateInvitationInput): Promise<InvitationRecord>;
  findByTokenHash(tokenHash: string): Promise<InvitationRecord | null>;
  findById(id: string): Promise<InvitationRecord | null>;
  listByClub(clubId: string): Promise<InvitationRecord[]>;
  listAll(): Promise<InvitationRecord[]>;
  markUsed(id: string): Promise<void>;
  revoke(id: string): Promise<void>;
}

// Minimale, athletenbezogene Nachschlagemöglichkeit — wird ausschließlich
// gebraucht, um bei createInvitation() zu prüfen, dass eine mitgeschickte
// athleteId tatsächlich zum Zielverein gehört (siehe Sicherheitsreview,
// Punkt 3: ohne diese Prüfung könnte ein Admin ein neues Konto an das
// Athletenprofil eines FREMDEN Vereins koppeln). Bewusst kein volles
// AthleteRepository (mit allen CRUD-Operationen) — die Einladungslogik
// braucht nur `clubId` des referenzierten Athletenprofils.
export interface AthleteLookup {
  id: string;
  clubId: string;
}

export interface AthleteRepository {
  findById(id: string): Promise<AthleteLookup | null>;
}

// ---- Prisma-Implementierungen (Produktionsbetrieb) ------------------------

export class PrismaClubRepository implements ClubRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: CreateClubInput): Promise<ClubRecord> {
    return this.prisma.club.create({ data: { name: input.name } });
  }
  async findById(id: string): Promise<ClubRecord | null> {
    return this.prisma.club.findUnique({ where: { id } });
  }
  async list(): Promise<ClubRecord[]> {
    return this.prisma.club.findMany({ orderBy: { name: 'asc' } });
  }

  async countMembersForClubs(clubIds: string[]): Promise<Map<string, ClubMemberCounts>> {
    const result = new Map<string, ClubMemberCounts>();
    for (const clubId of clubIds) result.set(clubId, { admin: 0, trainer: 0, athlete: 0 });
    if (clubIds.length === 0) return result;

    const rows = await this.prisma.user.groupBy({
      by: ['clubId', 'role'],
      where: { clubId: { in: clubIds }, deletedAt: null },
      _count: { _all: true },
    });
    for (const row of rows) {
      if (!row.clubId) continue;
      const counts = result.get(row.clubId);
      if (!counts) continue;
      switch (row.role) {
        case 'admin': counts.admin = row._count._all; break;
        case 'trainer': counts.trainer = row._count._all; break;
        case 'athlete': counts.athlete = row._count._all; break;
        default: break; // unbekannte/zukünftige Rolle (z. B. "superadmin") wird nicht gezählt
      }
    }
    return result;
  }
}

export class PrismaInvitationRepository implements InvitationRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: CreateInvitationInput): Promise<InvitationRecord> {
    return this.prisma.invitation.create({ data: input });
  }
  async findByTokenHash(tokenHash: string): Promise<InvitationRecord | null> {
    return this.prisma.invitation.findUnique({ where: { tokenHash } });
  }
  async findById(id: string): Promise<InvitationRecord | null> {
    return this.prisma.invitation.findUnique({ where: { id } });
  }
  async listByClub(clubId: string): Promise<InvitationRecord[]> {
    return this.prisma.invitation.findMany({ where: { clubId }, orderBy: { createdAt: 'desc' } });
  }
  async listAll(): Promise<InvitationRecord[]> {
    return this.prisma.invitation.findMany({ orderBy: { createdAt: 'desc' } });
  }
  async markUsed(id: string): Promise<void> {
    await this.prisma.invitation.update({ where: { id }, data: { usedAt: new Date() } });
  }
  async revoke(id: string): Promise<void> {
    await this.prisma.invitation.update({ where: { id }, data: { revokedAt: new Date() } });
  }
}

export class PrismaAthleteRepository implements AthleteRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: string): Promise<AthleteLookup | null> {
    const athlete = await this.prisma.athlete.findUnique({ where: { id }, select: { id: true, clubId: true } });
    return athlete;
  }
}
