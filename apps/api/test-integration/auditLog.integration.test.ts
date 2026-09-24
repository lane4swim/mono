// Prüft PrismaAuditLogRepository.deleteOlderThan() (Aufbewahrungsfrist,
// Issue #96) gegen eine echte Datenbank.
import { describe, it, expect, afterEach, afterAll } from 'vitest';
import { PrismaAuditLogRepository } from '../src/modules/auditLog/auditLog.repository.js';
import { purgeAuditLog } from '../src/jobs/purgeAuditLog.js';
import { getTestPrisma, closeTestPrisma, truncateAll, createTestClub } from './helpers.js';

const prisma = getTestPrisma();
const repo = new PrismaAuditLogRepository(prisma);

afterEach(async () => {
  await truncateAll();
});
afterAll(async () => {
  await closeTestPrisma();
});

describe('purgeAuditLog() mit PrismaAuditLogRepository', () => {
  it('löscht nur Einträge älter als die Frist', async () => {
    const club = await createTestClub();
    const now = new Date('2026-09-24T03:00:00.000Z');
    const base = { clubId: club.id, actorId: null, actorLabel: 'System', action: 'auth.refreshTokenReuse', targetId: null, targetLabel: '' };
    await prisma.auditLogEntry.create({ data: { ...base, createdAt: new Date('2025-09-01T00:00:00.000Z') } });
    const recent = await prisma.auditLogEntry.create({ data: { ...base, createdAt: new Date('2026-01-01T00:00:00.000Z') } });

    const deleted = await purgeAuditLog(repo, 365, now);

    expect(deleted).toBe(1);
    expect((await prisma.auditLogEntry.findMany()).map((e) => e.id)).toEqual([recent.id]);
  });
});
