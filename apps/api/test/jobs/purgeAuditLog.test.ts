// Issue #96: Audit-Log-Einträge werden nach der Aufbewahrungsfrist gelöscht.
import { describe, it, expect } from 'vitest';
import { purgeAuditLog } from '../../src/jobs/purgeAuditLog.js';
import { InMemoryAuditLogRepository } from '../../src/modules/auditLog/auditLog.repository.memory.js';

describe('purgeAuditLog()', () => {
  it('löscht nur Einträge, die älter als die Frist sind', async () => {
    const entries = new InMemoryAuditLogRepository();
    const now = new Date('2026-09-24T03:00:00.000Z');
    const old = await entries.create({ clubId: 'c', actorId: null, actorLabel: 'x', action: 'auth.loginFailed', targetId: 'u', targetLabel: 'x', metadata: {} });
    const recent = await entries.create({ clubId: 'c', actorId: null, actorLabel: 'x', action: 'auth.loginFailed', targetId: 'u', targetLabel: 'x', metadata: {} });
    old.createdAt = new Date('2025-09-23T00:00:00.000Z'); // älter als 365 Tage
    recent.createdAt = new Date('2025-09-25T00:00:00.000Z'); // jünger als 365 Tage

    const deleted = await purgeAuditLog(entries, 365, now);

    expect(deleted).toBe(1);
    expect((await entries.list({ limit: 10 })).map((e) => e.id)).toEqual([recent.id]);
  });
});
