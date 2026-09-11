import { describe, it, expect, beforeEach } from 'vitest';
import { createAuditLogService, ClubIdRequiredError, type AuditLogService } from '../../src/modules/auditLog/auditLog.service.js';
import { InMemoryAuditLogRepository } from '../../src/modules/auditLog/auditLog.repository.memory.js';

const CLUB_A = '11111111-1111-1111-1111-111111111111';
const CLUB_B = '22222222-2222-2222-2222-222222222222';

function buildFixture() {
  const entries = new InMemoryAuditLogRepository();
  const service = createAuditLogService({ entries });
  return { service, entries };
}

let fixture: ReturnType<typeof buildFixture>;
let service: AuditLogService;

beforeEach(() => {
  fixture = buildFixture();
  service = fixture.service;
});

describe('record()', () => {
  it('schreibt einen Eintrag mit den übergebenen Feldern', async () => {
    await service.record({
      clubId: CLUB_A,
      actorId: 'admin-1',
      actorLabel: 'Admina Musterfrau <admin@a.de>',
      action: 'invitation.created',
      targetId: 'inv-1',
      targetLabel: 'neu@example.org',
      metadata: { role: 'trainer' },
    });
    const [entry] = await fixture.entries.list({ clubId: CLUB_A, limit: 10 });
    expect(entry).toMatchObject({
      clubId: CLUB_A,
      actorId: 'admin-1',
      action: 'invitation.created',
      targetId: 'inv-1',
      metadata: { role: 'trainer' },
    });
  });

  it('setzt metadata standardmäßig auf ein leeres Objekt, wenn keins übergeben wird', async () => {
    await service.record({ clubId: CLUB_A, actorId: 'admin-1', actorLabel: 'x', action: 'user.deletionRequested', targetId: 'user-1', targetLabel: 'x' });
    const [entry] = await fixture.entries.list({ clubId: CLUB_A, limit: 10 });
    expect(entry!.metadata).toEqual({});
  });
});

describe('list()', () => {
  it('admin sieht nur Einträge des eigenen Vereins', async () => {
    await service.record({ clubId: CLUB_A, actorId: 'a', actorLabel: 'a', action: 'invitation.created', targetId: '1', targetLabel: '1' });
    await service.record({ clubId: CLUB_B, actorId: 'b', actorLabel: 'b', action: 'invitation.created', targetId: '2', targetLabel: '2' });

    const result = await service.list({ roles: ['admin'], clubId: CLUB_A });
    expect(result).toHaveLength(1);
    expect(result[0]!.clubId).toBe(CLUB_A);
  });

  it('admin ohne clubId löst ClubIdRequiredError aus', async () => {
    await expect(service.list({ roles: ['admin'], clubId: null })).rejects.toBeInstanceOf(ClubIdRequiredError);
  });

  it('superadmin sieht Einträge aller Vereine', async () => {
    await service.record({ clubId: CLUB_A, actorId: 'a', actorLabel: 'a', action: 'invitation.created', targetId: '1', targetLabel: '1' });
    await service.record({ clubId: CLUB_B, actorId: 'b', actorLabel: 'b', action: 'invitation.created', targetId: '2', targetLabel: '2' });

    const result = await service.list({ roles: ['superadmin'], clubId: null });
    expect(result).toHaveLength(2);
  });

  it('superadmin kann optional nach clubId filtern', async () => {
    await service.record({ clubId: CLUB_A, actorId: 'a', actorLabel: 'a', action: 'invitation.created', targetId: '1', targetLabel: '1' });
    await service.record({ clubId: CLUB_B, actorId: 'b', actorLabel: 'b', action: 'invitation.created', targetId: '2', targetLabel: '2' });

    const result = await service.list({ roles: ['superadmin'], clubId: null }, { clubId: CLUB_B });
    expect(result).toHaveLength(1);
    expect(result[0]!.clubId).toBe(CLUB_B);
  });

  it('liefert die neuesten Einträge zuerst', async () => {
    await service.record({ clubId: CLUB_A, actorId: 'a', actorLabel: 'a', action: 'invitation.created', targetId: '1', targetLabel: 'first' });
    await new Promise((resolve) => setTimeout(resolve, 2));
    await service.record({ clubId: CLUB_A, actorId: 'a', actorLabel: 'a', action: 'invitation.created', targetId: '2', targetLabel: 'second' });

    const result = await service.list({ roles: ['admin'], clubId: CLUB_A });
    expect(result.map((e) => e.targetLabel)).toEqual(['second', 'first']);
  });

  it('begrenzt die Trefferzahl auf das maximale Limit (200)', async () => {
    for (let i = 0; i < 5; i++) {
      await service.record({ clubId: CLUB_A, actorId: 'a', actorLabel: 'a', action: 'invitation.created', targetId: String(i), targetLabel: String(i) });
    }
    const result = await service.list({ roles: ['admin'], clubId: CLUB_A }, { limit: 2 });
    expect(result).toHaveLength(2);
  });
});
