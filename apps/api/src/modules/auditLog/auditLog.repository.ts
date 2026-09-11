// Repository-Pattern (wie überall sonst im Backend) — auditLog.service.ts
// hängt nur von diesem Interface ab, nie direkt von Prisma.
import type { PrismaClient, Prisma } from '@prisma/client';

export interface AuditLogEntryRecord {
  id: string;
  clubId: string | null;
  actorId: string | null;
  actorLabel: string;
  action: string;
  targetId: string | null;
  targetLabel: string;
  metadata: unknown;
  createdAt: Date;
}

export interface CreateAuditLogEntryInput {
  clubId: string | null;
  actorId: string | null;
  actorLabel: string;
  action: string;
  targetId: string | null;
  targetLabel: string;
  metadata: Record<string, unknown>;
}

export interface ListAuditLogOptions {
  // undefined: keine Vereinsfilterung (nur für superadmin, siehe
  // auditLog.service.ts: list()).
  clubId?: string;
  // Cursor-Paginierung über createdAt (analog sync.gateway.ts-Prinzip
  // "neuester zuerst") — before liefert nur Einträge VOR diesem Zeitpunkt.
  before?: Date;
  limit: number;
}

export interface AuditLogRepository {
  create(input: CreateAuditLogEntryInput): Promise<AuditLogEntryRecord>;
  list(options: ListAuditLogOptions): Promise<AuditLogEntryRecord[]>;
}

export class PrismaAuditLogRepository implements AuditLogRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: CreateAuditLogEntryInput): Promise<AuditLogEntryRecord> {
    // Cast statt eines strengeren Interface-Typs (siehe CreateAuditLogEntryInput-
    // Kommentar): das Repository-Interface soll Prisma.InputJsonValue nicht in
    // auditLog.service.ts durchreichen — nur diese konkrete Implementierung
    // kennt Prisma überhaupt.
    return this.prisma.auditLogEntry.create({ data: { ...input, metadata: input.metadata as Prisma.InputJsonValue } });
  }

  async list(options: ListAuditLogOptions): Promise<AuditLogEntryRecord[]> {
    return this.prisma.auditLogEntry.findMany({
      where: {
        ...(options.clubId ? { clubId: options.clubId } : {}),
        ...(options.before ? { createdAt: { lt: options.before } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: options.limit,
    });
  }
}
