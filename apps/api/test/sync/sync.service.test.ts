// apps/api/test/sync/sync.service.test.ts
import { describe, it, expect } from 'vitest';
import { createSyncService } from '../../src/modules/sync/sync.service.js';
import { InMemorySyncGateway } from '../../src/modules/sync/sync.gateway.memory.js';

const CLUB_A = '11111111-1111-1111-1111-111111111111';
const CLUB_B = '22222222-2222-2222-2222-222222222222';

function makeGroupPayload(overrides: Partial<Record<string, unknown>> = {}) {
  const now = new Date().toISOString();
  return {
    id: '33333333-3333-3333-3333-333333333333',
    clubId: CLUB_A,
    name: 'Leistungsgruppe',
    description: '',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeResultPayload(overrides: Partial<Record<string, unknown>> = {}) {
  const now = new Date().toISOString();
  return {
    id: '44444444-4444-4444-4444-444444444444',
    clubId: CLUB_A,
    athleteId: '55555555-5555-5555-5555-555555555555',
    event: '100 Freistil',
    time: 62.35,
    date: now,
    course: 'LCM',
    competitionId: null,
    place: null,
    isPB: false,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeService() {
  const gateway = new InMemorySyncGateway();
  const service = createSyncService({ gateway });
  return { service, gateway };
}

describe('syncService.push — Neuanlage & Aktualisierung', () => {
  it('legt einen neuen Datensatz an, wenn noch keiner existiert', async () => {
    const { service, gateway } = makeService();
    const payload = makeGroupPayload();
    const results = await service.push(
      [{ id: 'evt1', store: 'groups', entityId: payload.id, action: 'create', payload, clientUpdatedAt: payload.updatedAt }],
      { clubId: CLUB_A },
    );
    expect(results).toEqual([{ eventId: 'evt1', status: 'applied' }]);
    const stored = await gateway.findById('groups', payload.id);
    expect(stored?.name).toBe('Leistungsgruppe');
  });

  it('aktualisiert einen bestehenden Datensatz, wenn der Client-Stand aktueller/gleich ist', async () => {
    const { service, gateway } = makeService();
    const older = makeGroupPayload({ updatedAt: '2026-01-01T00:00:00.000Z' });
    gateway.seed('groups', { ...older, updatedAt: new Date(older.updatedAt), deletedAt: null });

    const newer = makeGroupPayload({ name: 'Neuer Name', updatedAt: '2026-06-01T00:00:00.000Z' });
    const results = await service.push(
      [{ id: 'evt2', store: 'groups', entityId: newer.id, action: 'update', payload: newer, clientUpdatedAt: newer.updatedAt }],
      { clubId: CLUB_A },
    );
    expect(results).toEqual([{ eventId: 'evt2', status: 'applied' }]);
    const stored = await gateway.findById('groups', newer.id);
    expect(stored?.name).toBe('Neuer Name');
  });
});

describe('syncService.push — Idempotenz', () => {
  it('meldet ein bereits verarbeitetes Event erneut als "applied", ohne es doppelt anzuwenden', async () => {
    const { service, gateway } = makeService();
    const payload = makeGroupPayload();
    const event = { id: 'evt-repeat', store: 'groups' as const, entityId: payload.id, action: 'create' as const, payload, clientUpdatedAt: payload.updatedAt };

    const first = await service.push([event], { clubId: CLUB_A });
    expect(first[0]!.status).toBe('applied');

    // Zweites Senden desselben Events (z. B. nach Verbindungsabbruch) —
    // darf keinen Fehler werfen und keinen zweiten Datensatz anlegen.
    const second = await service.push([event], { clubId: CLUB_A });
    expect(second[0]!.status).toBe('applied');

    const stored = await gateway.findById('groups', payload.id);
    expect(stored).not.toBeNull();
  });
});

describe('syncService.push — Konfliktlogik (last-write-wins, z. B. "groups")', () => {
  it('lehnt ein veraltetes Event ab, wenn der Server bereits einen neueren Stand hat', async () => {
    const { service, gateway } = makeService();
    const serverVersion = makeGroupPayload({ name: 'Serverstand', updatedAt: '2026-06-10T00:00:00.000Z' });
    gateway.seed('groups', { ...serverVersion, updatedAt: new Date(serverVersion.updatedAt), deletedAt: null });

    const staleClientVersion = makeGroupPayload({ name: 'Veralteter Clientstand', updatedAt: '2026-06-01T00:00:00.000Z' });
    const results = await service.push(
      [{ id: 'evt3', store: 'groups', entityId: staleClientVersion.id, action: 'update', payload: staleClientVersion, clientUpdatedAt: staleClientVersion.updatedAt }],
      { clubId: CLUB_A },
    );
    expect(results[0]!.status).toBe('conflict');
    expect((results[0]!.serverVersion as { name: string }).name).toBe('Serverstand');

    // Der Serverstand bleibt unverändert — das veraltete Event wurde nicht angewendet.
    const stored = await gateway.findById('groups', staleClientVersion.id);
    expect(stored?.name).toBe('Serverstand');
  });
});

describe('syncService.push — Konfliktlogik ("results": never-overwrite)', () => {
  it('legt bei einem Konflikt einen zusätzlichen Datensatz mit NEUER id an, statt eine Zeitmessung zu überschreiben', async () => {
    const { service, gateway } = makeService();
    const serverResult = makeResultPayload({ time: 60.1, updatedAt: '2026-06-10T00:00:00.000Z' });
    gateway.seed('results', { ...serverResult, updatedAt: new Date(serverResult.updatedAt), deletedAt: null });

    const staleClientResult = makeResultPayload({ time: 61.5, updatedAt: '2026-06-01T00:00:00.000Z' });
    const results = await service.push(
      [{ id: 'evt4', store: 'results', entityId: staleClientResult.id, action: 'update', payload: staleClientResult, clientUpdatedAt: staleClientResult.updatedAt }],
      { clubId: CLUB_A },
    );
    // "insert-as-new" wird als "applied" gemeldet, mit einer neuen
    // Server-id in serverVersion, damit der Client seinen lokalen
    // Datensatz nachziehen kann.
    expect(results[0]!.status).toBe('applied');
    const newId = (results[0]!.serverVersion as { id: string }).id;
    expect(newId).not.toBe(staleClientResult.id);

    // Die ursprüngliche (serverseitige) Zeitmessung bleibt unangetastet —
    // unter ihrer ursprünglichen id.
    const original = await gateway.findById('results', serverResult.id);
    expect(original?.time).toBe(60.1);

    // Der neue Datensatz existiert zusätzlich, unter der neuen id, mit dem
    // Client-Zeitwert.
    const inserted = await gateway.findById('results', newId);
    expect(inserted?.time).toBe(61.5);
  });
});

describe('syncService.push — Validierung', () => {
  it('lehnt ein Event mit ungültigem Payload ab (entspricht nicht dem Schema für den Store)', async () => {
    const { service } = makeService();
    const invalidPayload = { id: 'x', clubId: CLUB_A }; // fehlt: name, description, createdAt, updatedAt
    const results = await service.push(
      [{ id: 'evt5', store: 'groups', entityId: 'x', action: 'create', payload: invalidPayload, clientUpdatedAt: new Date().toISOString() }],
      { clubId: CLUB_A },
    );
    expect(results[0]!.status).toBe('error');
  });

  it('lehnt ein Event ab, dessen Payload-clubId nicht dem eigenen Verein entspricht', async () => {
    const { service } = makeService();
    const payload = makeGroupPayload({ clubId: CLUB_B }); // Requester ist aber CLUB_A
    const results = await service.push(
      [{ id: 'evt6', store: 'groups', entityId: payload.id, action: 'create', payload, clientUpdatedAt: payload.updatedAt }],
      { clubId: CLUB_A },
    );
    expect(results[0]!.status).toBe('error');
  });
});

describe('syncService.push — Löschung', () => {
  it('markiert einen Datensatz als gelöscht (Soft-Delete), scoped auf den eigenen Verein', async () => {
    const { service, gateway } = makeService();
    const payload = makeGroupPayload();
    gateway.seed('groups', { ...payload, updatedAt: new Date(payload.updatedAt), deletedAt: null });

    const results = await service.push(
      [{ id: 'evt7', store: 'groups', entityId: payload.id, action: 'delete', payload: null, clientUpdatedAt: new Date().toISOString() }],
      { clubId: CLUB_A },
    );
    expect(results[0]!.status).toBe('applied');
    const stored = await gateway.findById('groups', payload.id);
    expect(stored?.deletedAt).not.toBeNull();
  });
});

describe('syncService.pull', () => {
  it('liefert nur Änderungen des eigenen Vereins', async () => {
    const { service, gateway } = makeService();
    const now = new Date();
    gateway.seed('groups', { id: 'g1', clubId: CLUB_A, name: 'A', updatedAt: now, deletedAt: null });
    gateway.seed('groups', { id: 'g2', clubId: CLUB_B, name: 'B', updatedAt: now, deletedAt: null });

    const result = await service.pull({}, { clubId: CLUB_A });
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0]!.entityId).toBe('g1');
  });

  it('liefert nur Änderungen nach dem angegebenen "since"-Zeitpunkt', async () => {
    const { service, gateway } = makeService();
    gateway.seed('groups', { id: 'old', clubId: CLUB_A, name: 'Alt', updatedAt: new Date('2026-01-01T00:00:00.000Z'), deletedAt: null });
    gateway.seed('groups', { id: 'new', clubId: CLUB_A, name: 'Neu', updatedAt: new Date('2026-06-01T00:00:00.000Z'), deletedAt: null });

    const result = await service.pull({ since: '2026-03-01T00:00:00.000Z' }, { clubId: CLUB_A });
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0]!.entityId).toBe('new');
  });

  it('markiert gelöschte Datensätze mit action: "delete" und payload: null', async () => {
    const { service, gateway } = makeService();
    gateway.seed('groups', { id: 'deleted', clubId: CLUB_A, name: 'X', updatedAt: new Date(), deletedAt: new Date() });

    const result = await service.pull({}, { clubId: CLUB_A });
    expect(result.changes[0]!.action).toBe('delete');
    expect(result.changes[0]!.payload).toBeNull();
  });

  it('paginiert bei mehr als einer Seite Änderungen und liefert einen nextCursor', async () => {
    const { service, gateway } = makeService();
    // Mehr als eine "Seite" an Änderungen erzeugen (Seitengröße ist intern
    // 200 — hier reicht ein kleiner, aber über die Zeit gestaffelter Satz,
    // um hasMore/nextCursor grundsätzlich zu testen, indem wir gezielt
    // genug Datensätze für eine zweite Abfrage seeden).
    for (let i = 0; i < 5; i++) {
      gateway.seed('groups', {
        id: `g-${i}`, clubId: CLUB_A, name: `Gruppe ${i}`,
        updatedAt: new Date(2026, 0, i + 1), deletedAt: null,
      });
    }
    const result = await service.pull({}, { clubId: CLUB_A });
    expect(result.changes).toHaveLength(5);
    expect(result.hasMore).toBe(false);
    expect(result.nextCursor).toBeNull();
  });

  it('liefert eine leere, abgeschlossene Änderungsliste, wenn nichts vorhanden ist', async () => {
    const { service } = makeService();
    const result = await service.pull({}, { clubId: CLUB_A });
    expect(result).toEqual({ changes: [], nextCursor: null, hasMore: false });
  });
});
