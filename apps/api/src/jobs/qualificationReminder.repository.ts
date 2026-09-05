// apps/api/src/jobs/qualificationReminder.repository.ts
//
// Datenzugriff für den Erinnerungsjob (jobs/notifyExpiringQualifications.ts)
// — analog erasure.repository.ts: eine schlanke Gateway-Schnittstelle statt
// der vollen qualifications.repository.ts-Interfaces, zugeschnitten genau
// auf das, was der Job braucht (bündelt mehrere Tabellen/Joins statt eines
// einzelnen Modells, siehe auch profile.repository.ts für dasselbe Prinzip
// bei Querschnittsfunktionen).
import type { PrismaClient } from '@prisma/client';

export interface QualificationReminderCandidate {
  id: string;
  userId: string;
  userEmail: string;
  userName: string;
  userLocale: string;
  clubId: string;
  type: string;
  expiresOn: Date;
  renewalCourseOrganizedOn: Date | null;
}

export interface AdminContact {
  email: string;
  name: string;
  locale: string;
}

export interface NotifyExpiringQualificationsGateway {
  // Nur Zeilen aus Vereinen, die das Modul 'qualifications' gebucht haben
  // (siehe docs/nutzer-qualifikationen-plan.md, Abschnitt 5 — ein Verein,
  // der das Modul nachträglich deaktiviert, soll keine Erinnerungen mehr
  // auslösen, auch wenn die Datenzeilen bestehen bleiben), mit `expiresOn`
  // gesetzt (unbefristete Qualifikationen sind nie Kandidaten).
  findActiveQualificationsForModuleClubs(): Promise<QualificationReminderCandidate[]>;
  // Key `${clubId}:${type}` -> konfigurierte Schwellen (Tage vor
  // expiresOn) — ALLE Vereine auf einmal (siehe QualificationReminderSettingRepository.
  // listAll()-Kommentar in qualifications.repository.ts).
  findThresholdsByClubAndType(): Promise<Map<string, number[]>>;
  findAdminsForClub(clubId: string): Promise<AdminContact[]>;
  hasReminderBeenSent(qualificationId: string, thresholdDays: number): Promise<boolean>;
  recordReminderSent(qualificationId: string, thresholdDays: number): Promise<void>;
}

export class PrismaNotifyExpiringQualificationsGateway implements NotifyExpiringQualificationsGateway {
  constructor(private readonly prisma: PrismaClient) {}

  async findActiveQualificationsForModuleClubs(): Promise<QualificationReminderCandidate[]> {
    const rows = await this.prisma.userQualification.findMany({
      where: {
        deletedAt: null,
        expiresOn: { not: null },
        user: { clubId: { not: null }, club: { enabledModules: { has: 'qualifications' } } },
      },
      include: { user: { select: { id: true, email: true, name: true, locale: true, clubId: true } } },
    });
    return rows.map((row) => ({
      id: row.id,
      userId: row.user.id,
      userEmail: row.user.email,
      userName: row.user.name,
      userLocale: row.user.locale,
      // Non-null durch den `user.clubId: { not: null }`-Filter oben —
      // Prisma kann das im generierten Typ nicht ausdrücken.
      clubId: row.user.clubId as string,
      type: row.type,
      // Non-null durch den `expiresOn: { not: null }`-Filter oben.
      expiresOn: row.expiresOn as Date,
      renewalCourseOrganizedOn: row.renewalCourseOrganizedOn,
    }));
  }

  async findThresholdsByClubAndType(): Promise<Map<string, number[]>> {
    const rows = await this.prisma.clubQualificationReminderSetting.findMany();
    return new Map(rows.map((row) => [`${row.clubId}:${row.type}`, row.thresholdsDays]));
  }

  // docs/kampfrichter-modul-plan.md, Abschnitt 1: prüft die tatsächliche
  // Mehrfachrollen-Spalte ("has: 'admin'"), nicht mehr die transitionelle
  // Einzelrollen-Spalte — eine Person mit z. B. roles: ['athlete','admin']
  // bekäme über die alte Spalte (dort nur roles[0], hier 'athlete')
  // fälschlich KEINE Erinnerungs-Mail, obwohl sie admin ist.
  async findAdminsForClub(clubId: string): Promise<AdminContact[]> {
    return this.prisma.user.findMany({
      where: { clubId, roles: { has: 'admin' }, deletedAt: null },
      select: { email: true, name: true, locale: true },
    });
  }

  async hasReminderBeenSent(qualificationId: string, thresholdDays: number): Promise<boolean> {
    const existing = await this.prisma.qualificationReminderLog.findUnique({
      where: { qualificationId_thresholdDays: { qualificationId, thresholdDays } },
    });
    return existing !== null;
  }

  async recordReminderSent(qualificationId: string, thresholdDays: number): Promise<void> {
    await this.prisma.qualificationReminderLog.create({ data: { qualificationId, thresholdDays } });
  }
}
