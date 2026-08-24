// apps/api/test-integration/syncGateway.integration.test.ts
//
// Prüft PrismaSyncGateway gegen eine echte Datenbank (siehe
// vitest.integration.config.ts). Genau hier sitzt das sicherheitskritische
// Vereins-Scoping ("where: { id, clubId }") — kein In-Memory-Double kann
// verlässlich abbilden, ob eine WHERE-Klausel bei einer echten SQL-Abfrage
// tatsächlich greift (siehe z. B. update()/softDelete(): ein clubId-
// Mismatch führt bei Postgres zu Prismas "P2025" (Record not found), das
// InMemorySyncGateway.update() dagegen still schweigend als No-Op
// behandelt — beide sind aus Sicherheitssicht gleichwertig sicher
// (kein Schreibzugriff auf fremde Daten), aber nur dieser Test beweist
// es für den tatsächlichen Produktionscodepfad).
import { describe, it, expect, afterEach, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { PrismaSyncGateway } from '../src/modules/sync/sync.gateway.js';
import { getTestPrisma, closeTestPrisma, truncateAll, createTestClub } from './helpers.js';

const prisma = getTestPrisma();
const gateway = new PrismaSyncGateway(prisma);

afterEach(async () => {
  await truncateAll();
});
afterAll(async () => {
  await closeTestPrisma();
});

function groupPayload(clubId: string, overrides: Partial<Record<string, unknown>> = {}) {
  return { id: randomUUID(), clubId, name: 'Leistungsgruppe', description: '', ...overrides };
}

describe('PrismaSyncGateway.create()/findById()', () => {
  it('legt einen Datensatz an und findet ihn anschließend club-gescoped', async () => {
    const club = await createTestClub();
    const payload = groupPayload(club.id);
    await gateway.create('groups', payload);

    const found = await gateway.findById('groups', payload.id, club.id);
    expect(found?.id).toBe(payload.id);
    expect(found?.name).toBe('Leistungsgruppe');
  });

  it('liefert null, wenn der Datensatz zu einem ANDEREN Verein gehört (Vereins-Scoping)', async () => {
    const clubA = await createTestClub(prisma, 'Verein A');
    const clubB = await createTestClub(prisma, 'Verein B');
    const payload = groupPayload(clubA.id);
    await gateway.create('groups', payload);

    expect(await gateway.findById('groups', payload.id, clubB.id)).toBeNull();
    // Ungescoped (kein clubId-Argument) findet ihn weiterhin — genutzt von
    // internen/administrativen Aufrufern (siehe SyncGateway-Interface).
    expect((await gateway.findById('groups', payload.id))?.id).toBe(payload.id);
  });
});

describe('PrismaSyncGateway.update()', () => {
  it('aktualisiert einen Datensatz des EIGENEN Vereins', async () => {
    const club = await createTestClub();
    const payload = groupPayload(club.id);
    await gateway.create('groups', payload);

    await gateway.update('groups', payload.id, club.id, { name: 'Neuer Name' });
    const found = await gateway.findById('groups', payload.id, club.id);
    expect(found?.name).toBe('Neuer Name');
  });

  // Sicherheitsregression: ein manipuliertes Event mit einer fremden
  // entityId, aber der eigenen clubId im Push-Aufruf, darf einen
  // Datensatz eines FREMDEN Vereins nicht überschreiben. Die where-Klausel
  // { id, clubId } trifft dann nicht -> Prisma wirft "P2025", statt den
  // fremden Datensatz stillschweigend zu verändern.
  it('wirft "P2025", wenn die id einem ANDEREN Verein gehört, statt den fremden Datensatz zu überschreiben', async () => {
    const clubA = await createTestClub(prisma, 'Verein A');
    const clubB = await createTestClub(prisma, 'Verein B');
    const payload = groupPayload(clubA.id, { name: 'Geheim (Verein A)' });
    await gateway.create('groups', payload);

    await expect(gateway.update('groups', payload.id, clubB.id, { name: 'Übernommen' })).rejects.toMatchObject({ code: 'P2025' });

    // Der Originaldatensatz bleibt unverändert.
    const stillOriginal = await gateway.findById('groups', payload.id, clubA.id);
    expect(stillOriginal?.name).toBe('Geheim (Verein A)');
  });
});

describe('PrismaSyncGateway.softDelete()', () => {
  it('markiert einen Datensatz des eigenen Vereins als gelöscht', async () => {
    const club = await createTestClub();
    const payload = groupPayload(club.id);
    await gateway.create('groups', payload);

    await gateway.softDelete('groups', payload.id, club.id);
    const raw = await prisma.group.findUnique({ where: { id: payload.id } });
    expect(raw?.deletedAt).not.toBeNull();
  });

  it('wirft "P2025" bei einem clubId-Mismatch, statt einen fremden Datensatz zu löschen', async () => {
    const clubA = await createTestClub(prisma, 'Verein A');
    const clubB = await createTestClub(prisma, 'Verein B');
    const payload = groupPayload(clubA.id);
    await gateway.create('groups', payload);

    await expect(gateway.softDelete('groups', payload.id, clubB.id)).rejects.toMatchObject({ code: 'P2025' });
    const raw = await prisma.group.findUnique({ where: { id: payload.id } });
    expect(raw?.deletedAt).toBeNull();
  });
});

describe('PrismaSyncGateway.listChangedSince()', () => {
  it('liefert nur Änderungen des eigenen Vereins, aufsteigend nach updatedAt sortiert', async () => {
    const clubA = await createTestClub(prisma, 'Verein A');
    const clubB = await createTestClub(prisma, 'Verein B');
    // Bewusst in absteigender Zeit-Reihenfolge angelegt, um die Sortierung
    // tatsächlich zu prüfen (nicht nur zufällig durch die Anlage-
    // Reihenfolge zu bestätigen).
    const older = await prisma.group.create({ data: { clubId: clubA.id, name: 'Älter', updatedAt: new Date('2026-01-01T00:00:00.000Z') } });
    const newer = await prisma.group.create({ data: { clubId: clubA.id, name: 'Neuer', updatedAt: new Date('2026-06-01T00:00:00.000Z') } });
    await prisma.group.create({ data: { clubId: clubB.id, name: 'Fremder Verein' } });

    const changes = await gateway.listChangedSince(clubA.id, null, 100);
    expect(changes.map((c) => c.entityId)).toEqual([older.id, newer.id]);
  });

  it('berücksichtigt "since" (nur Änderungen NACH dem Zeitpunkt)', async () => {
    const club = await createTestClub();
    await prisma.group.create({ data: { clubId: club.id, name: 'Alt', updatedAt: new Date('2026-01-01T00:00:00.000Z') } });
    const recent = await prisma.group.create({ data: { clubId: club.id, name: 'Neu', updatedAt: new Date('2026-06-01T00:00:00.000Z') } });

    const changes = await gateway.listChangedSince(club.id, new Date('2026-03-01T00:00:00.000Z'), 100);
    expect(changes.map((c) => c.entityId)).toEqual([recent.id]);
  });

  it('meldet einen soft-gelöschten Datensatz als action: "delete" mit payload: null', async () => {
    const club = await createTestClub();
    const row = await prisma.group.create({ data: { clubId: club.id, name: 'Wird gelöscht', deletedAt: new Date() } });

    const changes = await gateway.listChangedSince(club.id, null, 100);
    expect(changes).toEqual([expect.objectContaining({ entityId: row.id, action: 'delete', payload: null })]);
  });

  it('mischt Tombstones fremd-gelöschter Zeilen korrekt nach updatedAt in die Änderungsliste ein', async () => {
    const club = await createTestClub();
    const stillExisting = await prisma.group.create({ data: { clubId: club.id, name: 'Lebt noch', updatedAt: new Date('2026-01-01T00:00:00.000Z') } });
    await prisma.syncTombstone.create({
      data: { clubId: club.id, store: 'athletes', entityId: 'purged-athlete', deletedAt: new Date('2026-06-01T00:00:00.000Z') },
    });

    const changes = await gateway.listChangedSince(club.id, null, 100);
    expect(changes.map((c) => c.entityId)).toEqual([stillExisting.id, 'purged-athlete']);
    expect(changes[1]).toMatchObject({ store: 'athletes', action: 'delete', payload: null });
  });
});

describe('PrismaSyncGateway.findClubIdForUser()', () => {
  it('liefert die clubId eines existierenden Nutzers', async () => {
    const club = await createTestClub();
    const user = await prisma.user.create({
      data: { clubId: club.id, name: 'Trainer:in', email: `t-${randomUUID()}@example.org`, passwordHash: 'hash', role: 'trainer' },
    });
    expect(await gateway.findClubIdForUser(user.id)).toBe(club.id);
  });

  it('liefert null für eine unbekannte userId', async () => {
    expect(await gateway.findClubIdForUser(randomUUID())).toBeNull();
  });

  it('liefert null für superadmin (clubId ist dort null)', async () => {
    const user = await prisma.user.create({
      data: { clubId: null, name: 'Super', email: `s-${randomUUID()}@example.org`, passwordHash: 'hash', role: 'superadmin' },
    });
    expect(await gateway.findClubIdForUser(user.id)).toBeNull();
  });
});

describe('PrismaSyncGateway.isEventProcessed()/markEventProcessed()', () => {
  it('meldet ein noch nicht verarbeitetes Event als nicht verarbeitet, danach als verarbeitet', async () => {
    const club = await createTestClub();
    const eventId = randomUUID();
    expect(await gateway.isEventProcessed(eventId)).toBe(false);

    await gateway.markEventProcessed(eventId, club.id, 'groups', 'create');
    expect(await gateway.isEventProcessed(eventId)).toBe(true);
  });
});
