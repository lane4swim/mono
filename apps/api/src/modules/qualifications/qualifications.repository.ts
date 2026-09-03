// apps/api/src/modules/qualifications/qualifications.repository.ts
//
// Repository-Pattern (wie überall sonst im Backend) — qualifications.service.ts
// hängt nur von diesen Interfaces ab, nie direkt von Prisma. Zwei getrennte
// Repositories in derselben Datei (analog invitations.repository.ts, das
// ClubRepository/InvitationRepository/AthleteRepository bündelt): beide
// gehören fachlich zum selben Modul, aber zu unterschiedlichen Tabellen.
import type { PrismaClient } from '@prisma/client';

export interface UserQualificationRecord {
  id: string;
  userId: string;
  type: string;
  note: string;
  acquiredOn: Date;
  expiresOn: Date | null;
  renewalCourseOrganizedOn: Date | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface CreateUserQualificationInput {
  userId: string;
  type: string;
  note: string;
  acquiredOn: Date;
  expiresOn: Date | null;
  renewalCourseOrganizedOn: Date | null;
}

export interface UpdateUserQualificationInput {
  type?: string;
  note?: string;
  acquiredOn?: Date;
  expiresOn?: Date | null;
  renewalCourseOrganizedOn?: Date | null;
}

export interface UserQualificationRepository {
  create(input: CreateUserQualificationInput): Promise<UserQualificationRecord>;
  findById(id: string): Promise<UserQualificationRecord | null>;
  // Liefert bewusst nur aktive (nicht per Soft-Delete entfernte) Zeilen —
  // analog Athlete/Group/... im Sync-Layer.
  listByUser(userId: string): Promise<UserQualificationRecord[]>;
  update(id: string, input: UpdateUserQualificationInput): Promise<UserQualificationRecord>;
  softDelete(id: string): Promise<void>;
}

export interface ClubQualificationReminderSettingRecord {
  id: string;
  clubId: string;
  type: string;
  thresholdsDays: number[];
  createdAt: Date;
  updatedAt: Date;
}

export interface QualificationReminderSettingRepository {
  listByClub(clubId: string): Promise<ClubQualificationReminderSettingRecord[]>;
  // Erinnerungsjob (jobs/notifyExpiringQualifications.ts) braucht die
  // Schwellen ALLER Vereine auf einmal, nicht je Verein einzeln — vermeidet
  // eine Abfrage pro Verein bei jedem täglichen Lauf.
  listAll(): Promise<ClubQualificationReminderSettingRecord[]>;
  upsert(clubId: string, type: string, thresholdsDays: number[]): Promise<ClubQualificationReminderSettingRecord>;
}

export class PrismaUserQualificationRepository implements UserQualificationRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: CreateUserQualificationInput): Promise<UserQualificationRecord> {
    return this.prisma.userQualification.create({ data: input });
  }
  async findById(id: string): Promise<UserQualificationRecord | null> {
    return this.prisma.userQualification.findUnique({ where: { id } });
  }
  async listByUser(userId: string): Promise<UserQualificationRecord[]> {
    return this.prisma.userQualification.findMany({
      where: { userId, deletedAt: null },
      orderBy: { acquiredOn: 'desc' },
    });
  }
  async update(id: string, input: UpdateUserQualificationInput): Promise<UserQualificationRecord> {
    return this.prisma.userQualification.update({ where: { id }, data: input });
  }
  async softDelete(id: string): Promise<void> {
    await this.prisma.userQualification.update({ where: { id }, data: { deletedAt: new Date() } });
  }
}

export class PrismaQualificationReminderSettingRepository implements QualificationReminderSettingRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async listByClub(clubId: string): Promise<ClubQualificationReminderSettingRecord[]> {
    return this.prisma.clubQualificationReminderSetting.findMany({ where: { clubId } });
  }
  async listAll(): Promise<ClubQualificationReminderSettingRecord[]> {
    return this.prisma.clubQualificationReminderSetting.findMany();
  }
  async upsert(clubId: string, type: string, thresholdsDays: number[]): Promise<ClubQualificationReminderSettingRecord> {
    return this.prisma.clubQualificationReminderSetting.upsert({
      where: { clubId_type: { clubId, type } },
      create: { clubId, type, thresholdsDays },
      update: { thresholdsDays },
    });
  }
}
