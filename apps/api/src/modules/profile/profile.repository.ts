// apps/api/src/modules/profile/profile.repository.ts
//
// DSGVO-Selbstbedienung: Auskunft (Art. 15) und Löschung (Art. 17) für das
// EIGENE Konto. Bewusst als eigenes, schlankes Gateway statt eines
// Repositories je fachlicher Tabelle (Athlete/Result/StartlistEntry/…) —
// diese Operationen sind Querschnittsfunktionen über mehrere Tabellen
// hinweg, für die eine Aufteilung in Einzel-Repositories keinen Mehrwert
// böte (siehe auch Phase 2, die aus demselben Grund bewusst auf
// Einzel-Repositories je fachlicher Tabelle verzichtet hat).
import type { PrismaClient } from '@prisma/client';

export interface PersonalDataExport {
  exportedAt: string;
  format: 'lane1-user-data-export-v1';
  user: Record<string, unknown>;
  athlete: Record<string, unknown> | null;
  results: Array<Record<string, unknown>>;
  entries: Array<Record<string, unknown>>;
  actionItems: Array<Record<string, unknown>>;
  attendance: Array<Record<string, unknown>>;
}

export interface ErasureRequestRecord {
  id: string;
  userId: string;
  requestedAt: Date;
  purgeAfter: Date;
  purgedAt: Date | null;
  status: 'pending' | 'purged';
}

export interface ProfileDataGateway {
  exportUserData(userId: string): Promise<PersonalDataExport>;
  // Sofortmaßnahme bei einer Löschanfrage: Soft-Delete von User + (falls
  // verknüpft) Athlet:innen-Profil sowie dessen Ergebnisse/Startlisten-
  // einträge/Handlungsfelder, plus Anlage eines DataDeletionRequest mit
  // `purgeAfter`. Der tatsächliche, unwiderrufliche Hard-Purge erfolgt
  // zeitversetzt über jobs/purgeExpiredDeletions.ts.
  requestErasure(userId: string, retentionDays: number): Promise<ErasureRequestRecord>;
}

export class UserNotFoundForExportError extends Error {
  constructor() {
    super('Nutzer:in wurde nicht gefunden.');
  }
}

export class ErasureAlreadyRequestedError extends Error {
  constructor() {
    super('Für dieses Konto liegt bereits eine Löschanfrage vor.');
  }
}

export class PrismaProfileDataGateway implements ProfileDataGateway {
  constructor(private readonly prisma: PrismaClient) {}

  async exportUserData(userId: string): Promise<PersonalDataExport> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UserNotFoundForExportError();
    const { passwordHash: _passwordHash, ...publicUser } = user;

    let athlete: Record<string, unknown> | null = null;
    let results: Array<Record<string, unknown>> = [];
    let entries: Array<Record<string, unknown>> = [];
    let actionItems: Array<Record<string, unknown>> = [];
    let attendance: Array<Record<string, unknown>> = [];

    if (user.athleteId) {
      const [athleteRow, resultRows, entryRows, actionItemRows, sessionRows] = await Promise.all([
        this.prisma.athlete.findUnique({ where: { id: user.athleteId } }),
        this.prisma.result.findMany({ where: { athleteId: user.athleteId } }),
        this.prisma.startlistEntry.findMany({ where: { athleteId: user.athleteId } }),
        this.prisma.actionItem.findMany({ where: { athleteId: user.athleteId } }),
        this.prisma.trainingSession.findMany({ where: { clubId: user.clubId ?? undefined } }),
      ]);
      athlete = athleteRow;
      results = resultRows;
      entries = entryRows;
      actionItems = actionItemRows;
      attendance = (sessionRows as Array<{ id: string; date: Date; attendance: Array<Record<string, unknown>> }>)
        .map((session): Record<string, unknown> | null => {
          const record = session.attendance.find((a) => a.athleteId === user.athleteId);
          return record ? { sessionId: session.id, date: session.date, ...record } : null;
        })
        .filter((x): x is Record<string, unknown> => x !== null);
    }

    return {
      exportedAt: new Date().toISOString(),
      format: 'lane1-user-data-export-v1',
      user: publicUser,
      athlete,
      results,
      entries,
      actionItems,
      attendance,
    };
  }

  async requestErasure(userId: string, retentionDays: number): Promise<ErasureRequestRecord> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UserNotFoundForExportError();

    const existingRequest = await this.prisma.dataDeletionRequest.findUnique({ where: { userId } });
    if (existingRequest) throw new ErasureAlreadyRequestedError();

    const now = new Date();
    const purgeAfter = new Date(now.getTime() + retentionDays * 24 * 60 * 60 * 1000);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await this.prisma.$transaction(async (tx: any) => {
      await tx.user.update({ where: { id: userId }, data: { deletedAt: now } });
      if (user.athleteId) {
        await tx.athlete.update({ where: { id: user.athleteId }, data: { deletedAt: now } });
        await tx.result.updateMany({ where: { athleteId: user.athleteId }, data: { deletedAt: now } });
        await tx.startlistEntry.updateMany({ where: { athleteId: user.athleteId }, data: { deletedAt: now } });
        await tx.actionItem.updateMany({ where: { athleteId: user.athleteId }, data: { deletedAt: now } });
      }
    });

    const created = await this.prisma.dataDeletionRequest.create({
      data: { userId, requestedAt: now, purgeAfter, status: 'pending' },
    });
    // 'status' ist im Schema eine einfache String-Spalte (kein Prisma-
    // Enum), Prisma leitet ihren Typ daher als generisches 'string' ab —
    // breiter als unser 'pending' | 'purged'. Das Objekt wird deshalb
    // explizit konstruiert statt das Create-Ergebnis direkt
    // zurückzugeben; unmittelbar nach der Anlage ist der Status
    // garantiert 'pending' (entspricht auch dem Schema-Default).
    return {
      id: created.id,
      userId: created.userId,
      requestedAt: created.requestedAt,
      purgeAfter: created.purgeAfter,
      purgedAt: created.purgedAt,
      status: 'pending',
    };
  }
}
