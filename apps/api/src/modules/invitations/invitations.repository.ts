// apps/api/src/modules/invitations/invitations.repository.ts
//
// Repository-Pattern (wie schon in modules/auth) — die Service-Logik hängt
// nur von diesen Interfaces ab, nie direkt von Prisma. Ermöglicht
// vollständig datenbankfreie Tests der Autorisierungs- und Ablauflogik.
import type { PrismaClient } from '@prisma/client';
import { MODULE_KEYS } from '@lane1/shared-types';

export interface ClubRecord {
  id: string;
  name: string;
  // Modul-Pakete, die dieser Verein gebucht hat — siehe
  // packages/shared-types/src/modules.ts: MODULE_PACKAGES.
  enabledModules: string[];
  // Externe Vereinskennung für den Ergebnisimport (DSV7/Lenex) — siehe
  // invitations.service.ts: updateClubIdentity().
  nationalID: string | null;
  nationalIDType: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateClubInput {
  name: string;
  // Optional (statt Pflichtfeld): der HTTP-Layer (CreateClubRequestSchema)
  // liefert es immer explizit (Default dort: alle Module), aber Tests, die
  // ClubRepository direkt ansprechen und sich nicht für Modul-Gating
  // interessieren, sollen es weglassen dürfen — beide Implementierungen
  // unten füllen dann MODULE_KEYS (alle Module) als Default.
  enabledModules?: string[];
}

export interface ClubMemberCounts {
  admin: number;
  trainer: number;
  athlete: number;
  referee: number;
}

export interface ClubRepository {
  create(input: CreateClubInput): Promise<ClubRecord>;
  // Legt einen Verein UND dessen erste Admin-Einladung ATOMAR an (siehe
  // createClub() in invitations.service.ts). Vormals zwei unabhängige
  // Aufrufe (club.create(), danach invitations.create()) — schlug der
  // zweite fehl (z. B. kurzzeitiger DB-Fehler), blieb ein Verein OHNE
  // jede Einladung zurück: für niemanden erreichbar, nicht über die API
  // reparierbar (siehe Code-Review). `buildInvitation` bekommt den bereits
  // angelegten Verein (für dessen id als clubId) — die Einladung kann
  // erst NACH dem Verein konstruiert werden, deren tokenHash/expiresAt
  // liegen aber schon vorher fest (siehe Aufrufer).
  createWithAdminInvitation(
    club: CreateClubInput,
    buildInvitation: (club: ClubRecord) => CreateInvitationInput,
  ): Promise<{ club: ClubRecord; invitation: InvitationRecord }>;
  findById(id: string): Promise<ClubRecord | null>;
  list(): Promise<ClubRecord[]>;
  // Für die Superadmin-Oberfläche ("/admin"): Anzahl aktiver (nicht
  // gelöschter) Mitglieder je Rolle, für mehrere Vereine auf einmal
  // (vermeidet N+1-Abfragen bei der Vereinsliste).
  countMembersForClubs(clubIds: string[]): Promise<Map<string, ClubMemberCounts>>;
  // Ändert NUR die gebuchten Module eines bestehenden Vereins (Superadmin-
  // Bearbeiten-Ansicht, siehe invitations.service.ts: updateClubModules()).
  // Wirft, wenn clubId nicht existiert — Aufrufer prüft das nicht separat.
  updateEnabledModules(clubId: string, enabledModules: string[]): Promise<ClubRecord>;
  // Ändert NUR die externe Vereinskennung (siehe invitations.service.ts:
  // updateClubIdentity()). Wirft, wenn clubId nicht existiert.
  updateIdentity(clubId: string, identity: { nationalID: string | null; nationalIDType: string | null }): Promise<ClubRecord>;
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
    return this.prisma.club.create({ data: { name: input.name, enabledModules: input.enabledModules ?? [...MODULE_KEYS] } });
  }

  async createWithAdminInvitation(
    club: CreateClubInput,
    buildInvitation: (club: ClubRecord) => CreateInvitationInput,
  ): Promise<{ club: ClubRecord; invitation: InvitationRecord }> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return this.prisma.$transaction(async (tx: any) => {
      const createdClub: ClubRecord = await tx.club.create({ data: { name: club.name, enabledModules: club.enabledModules ?? [...MODULE_KEYS] } });
      const invitation: InvitationRecord = await tx.invitation.create({ data: buildInvitation(createdClub) });
      return { club: createdClub, invitation };
    });
  }

  async findById(id: string): Promise<ClubRecord | null> {
    return this.prisma.club.findUnique({ where: { id } });
  }
  async list(): Promise<ClubRecord[]> {
    return this.prisma.club.findMany({ orderBy: { name: 'asc' } });
  }

  async updateEnabledModules(clubId: string, enabledModules: string[]): Promise<ClubRecord> {
    return this.prisma.club.update({ where: { id: clubId }, data: { enabledModules } });
  }

  async updateIdentity(clubId: string, identity: { nationalID: string | null; nationalIDType: string | null }): Promise<ClubRecord> {
    return this.prisma.club.update({ where: { id: clubId }, data: identity });
  }

  // docs/kampfrichter-modul-plan.md, Abschnitt 2: `roles` ist eine
  // Array-Spalte — ein einzelnes `groupBy(['clubId', 'role'])` (frühere
  // Fassung, gegen die inzwischen nur noch transitionell mitgepflegte
  // Einzelrollen-Spalte) zählt eine Person NUR unter ihrer "primären"
  // Rolle und würde z. B. eine Person mit `roles: ['trainer','referee']`
  // fälschlich nicht als Kampfrichter:in mitzählen. Stattdessen EIN
  // `findMany()` über alle angefragten Vereine (kein N+1 über
  // Rolle×Verein), Zählung je Rolle in JS — ein Konto mit mehreren Rollen
  // erhöht dadurch bewusst JEDEN passenden Zähler (die Rollen sind seit
  // Phase A nicht mehr gegenseitig ausschließend, siehe UserRolesSchema).
  async countMembersForClubs(clubIds: string[]): Promise<Map<string, ClubMemberCounts>> {
    const result = new Map<string, ClubMemberCounts>();
    for (const clubId of clubIds) result.set(clubId, { admin: 0, trainer: 0, athlete: 0, referee: 0 });
    if (clubIds.length === 0) return result;

    const users = await this.prisma.user.findMany({
      where: { clubId: { in: clubIds }, deletedAt: null },
      select: { clubId: true, roles: true },
    });
    for (const user of users) {
      if (!user.clubId) continue;
      const counts = result.get(user.clubId);
      if (!counts) continue;
      for (const role of user.roles) {
        switch (role) {
          case 'admin': counts.admin += 1; break;
          case 'trainer': counts.trainer += 1; break;
          case 'athlete': counts.athlete += 1; break;
          case 'referee': counts.referee += 1; break;
          default: break; // "superadmin" gehört zu keinem Verein, wird hier nie gezählt
        }
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
