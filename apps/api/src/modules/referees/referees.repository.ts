// apps/api/src/modules/referees/referees.repository.ts
//
// Repository-Pattern (wie überall sonst im Backend, siehe
// modules/qualifications/qualifications.repository.ts als direktes
// Vorbild) — referees.service.ts hängt nur von diesem Interface ab, nie
// direkt von Prisma.
import type { PrismaClient } from '@prisma/client';

export interface RefereeAssignmentRecord {
  id: string;
  userId: string;
  clubId: string;
  competitionName: string;
  competitionPlace: string;
  competitionId: string | null;
  date: Date;
  function: string;
  note: string;
  createdByAdminId: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface CreateRefereeAssignmentInput {
  userId: string;
  clubId: string;
  competitionName: string;
  competitionPlace: string;
  competitionId: string | null;
  date: Date;
  function: string;
  note: string;
  // null bei Selbsterfassung, sonst die id der erfassenden admin-Person
  // (docs/kampfrichter-modul-plan.md, Abschnitt 5.5).
  createdByAdminId: string | null;
}

export interface UpdateRefereeAssignmentInput {
  competitionName?: string;
  competitionPlace?: string;
  competitionId?: string | null;
  date?: Date;
  function?: string;
  note?: string;
  // Nur bei einer admin-seitigen Bearbeitung gesetzt (referees.service.ts:
  // updateForMember()) — eine Selbstbearbeitung durch die Kampfrichter:in
  // lässt dieses Feld unverändert stehen (reines Herkunfts-Audit, siehe
  // Plan Abschnitt 5.5).
  createdByAdminId?: string | null;
}

export interface RefereeAssignmentRepository {
  create(input: CreateRefereeAssignmentInput): Promise<RefereeAssignmentRecord>;
  findById(id: string): Promise<RefereeAssignmentRecord | null>;
  // Liefert bewusst nur aktive (nicht per Soft-Delete entfernte) Zeilen —
  // analog UserQualification.
  listByUser(userId: string): Promise<RefereeAssignmentRecord[]>;
  update(id: string, input: UpdateRefereeAssignmentInput): Promise<RefereeAssignmentRecord>;
  softDelete(id: string): Promise<void>;
}

export class PrismaRefereeAssignmentRepository implements RefereeAssignmentRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: CreateRefereeAssignmentInput): Promise<RefereeAssignmentRecord> {
    return this.prisma.refereeAssignment.create({ data: input });
  }
  async findById(id: string): Promise<RefereeAssignmentRecord | null> {
    return this.prisma.refereeAssignment.findUnique({ where: { id } });
  }
  async listByUser(userId: string): Promise<RefereeAssignmentRecord[]> {
    return this.prisma.refereeAssignment.findMany({
      where: { userId, deletedAt: null },
      orderBy: { date: 'desc' },
    });
  }
  async update(id: string, input: UpdateRefereeAssignmentInput): Promise<RefereeAssignmentRecord> {
    return this.prisma.refereeAssignment.update({ where: { id }, data: input });
  }
  async softDelete(id: string): Promise<void> {
    await this.prisma.refereeAssignment.update({ where: { id }, data: { deletedAt: new Date() } });
  }
}

// Minimale, für dieses Modul ausreichende Nachschlagemöglichkeit für einen
// referenzierten Competition-Datensatz — braucht nur dessen clubId, um
// referees.service.ts prüfen zu lassen, dass ein mitgeschicktes
// competitionId zum eigenen Verein gehört (Plan Abschnitt 5.5). Bewusst
// kein volles CompetitionRepository, analog AthleteLookup in
// invitations.repository.ts.
export interface CompetitionLookup {
  id: string;
  clubId: string;
}

export interface CompetitionRepository {
  findById(id: string): Promise<CompetitionLookup | null>;
}

export class PrismaCompetitionRepository implements CompetitionRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: string): Promise<CompetitionLookup | null> {
    return this.prisma.competition.findUnique({ where: { id }, select: { id: true, clubId: true } });
  }
}
