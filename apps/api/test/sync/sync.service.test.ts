// apps/api/test/sync/sync.service.test.ts
import { describe, it, expect } from 'vitest';
import { createSyncService, describeSyncError } from '../../src/modules/sync/sync.service.js';
import { InMemorySyncGateway } from '../../src/modules/sync/sync.gateway.memory.js';

const CLUB_A = '11111111-1111-1111-1111-111111111111';
const CLUB_B = '22222222-2222-2222-2222-222222222222';

// Bestehende Tests (vor der Rollen-Scopierung geschrieben) prüfen
// durchweg unrestringiertes Verhalten — dafür steht diese Requester-Form
// mit role "trainer" (unbetroffen von den neuen athlete-Beschränkungen).
// Die dedizierten athlete-Regressionstests weiter unten verwenden
// stattdessen explizit { clubId, role: 'athlete', athleteId }.
function asTrainer(clubId: string) {
  return { clubId, role: 'trainer' as const, athleteId: null };
}

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

function asAthlete(clubId: string, athleteId: string | null) {
  return { clubId, role: 'athlete' as const, athleteId };
}

function makeActionItemPayload(overrides: Partial<Record<string, unknown>> = {}) {
  const now = new Date().toISOString();
  return {
    id: '77777777-7777-7777-7777-777777777771',
    clubId: CLUB_A,
    athleteId: '55555555-5555-5555-5555-555555555555',
    title: 'Atemtechnik verbessern',
    description: '',
    category: 'technik',
    status: 'offen',
    createdDate: now,
    dueDate: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeSessionPayload(overrides: Partial<Record<string, unknown>> = {}) {
  const now = new Date().toISOString();
  return {
    id: '88888888-8888-8888-8888-888888888881',
    clubId: CLUB_A,
    date: now,
    groupId: null,
    planId: null,
    trainerNote: '',
    attendance: [
      { athleteId: '55555555-5555-5555-5555-555555555555', present: true, rpe: 7, note: 'eigene Notiz' },
      { athleteId: '66666666-6666-6666-6666-666666666661', present: true, rpe: 9, note: 'fremde Notiz' },
    ],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeExercisePayload(overrides: Partial<Record<string, unknown>> = {}) {
  const now = new Date().toISOString();
  return {
    id: '99999999-9999-9999-9999-999999999998',
    clubId: CLUB_A,
    name: 'Kraulbeine mit Brett',
    category: 'kick',
    stroke: 'Freistil',
    description: '',
    defaultDistance: 200,
    tags: [],
    equipment: [],
    comments: [],
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
      asTrainer(CLUB_A),
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
      asTrainer(CLUB_A),
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

    const first = await service.push([event], asTrainer(CLUB_A));
    expect(first[0]!.status).toBe('applied');

    // Zweites Senden desselben Events (z. B. nach Verbindungsabbruch) —
    // darf keinen Fehler werfen und keinen zweiten Datensatz anlegen.
    const second = await service.push([event], asTrainer(CLUB_A));
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
      asTrainer(CLUB_A),
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
      asTrainer(CLUB_A),
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
      asTrainer(CLUB_A),
    );
    expect(results[0]!.status).toBe('error');
  });

  it('lehnt ein Event ab, dessen Payload-clubId nicht dem eigenen Verein entspricht', async () => {
    const { service } = makeService();
    const payload = makeGroupPayload({ clubId: CLUB_B }); // Requester ist aber CLUB_A
    const results = await service.push(
      [{ id: 'evt6', store: 'groups', entityId: payload.id, action: 'create', payload, clientUpdatedAt: payload.updatedAt }],
      asTrainer(CLUB_A),
    );
    expect(results[0]!.status).toBe('error');
  });
});

describe('syncService.push — Mass-Assignment-Schutz (Sicherheitsregression, Patch #4)', () => {
  it('lehnt ein Event ab, dessen Payload ein im Schema unbekanntes Feld enthält (z. B. "deletedAt")', async () => {
    const { service } = makeService();
    const payload = { ...makeGroupPayload(), deletedAt: null };
    const results = await service.push(
      [{ id: 'evt-mass-1', store: 'groups', entityId: payload.id, action: 'create', payload, clientUpdatedAt: payload.updatedAt }],
      asTrainer(CLUB_A),
    );
    // Vorher (Sicherheitslücke): der rohe Payload inkl. "deletedAt" wurde
    // unvalidiert an Prisma weitergereicht. Jetzt: .strict() lässt das
    // Schema fehlschlagen -> "error", kein Schreibzugriff.
    expect(results[0]!.status).toBe('error');
  });

  it('speichert bei einem gültigen Update NUR die im Schema definierten Felder (validatedPayload statt rohem event.payload)', async () => {
    const { service, gateway } = makeService();
    const seedPayload = makeGroupPayload({ id: '66666666-6666-6666-6666-666666666666' });
    gateway.seed('groups', { ...seedPayload, updatedAt: new Date(seedPayload.updatedAt), createdAt: new Date(seedPayload.createdAt), deletedAt: null });

    // Ein manipulierter Client versucht, per unbekanntem Zusatzfeld
    // "extraField" beliebige Daten mitzuschicken.
    const maliciousPayload = {
      ...seedPayload,
      name: 'Neuer Name',
      updatedAt: new Date(Date.now() + 60_000).toISOString(),
      extraField: 'sollte niemals gespeichert werden',
    };
    const results = await service.push(
      [{ id: 'evt-mass-2', store: 'groups', entityId: seedPayload.id, action: 'update', payload: maliciousPayload, clientUpdatedAt: maliciousPayload.updatedAt }],
      asTrainer(CLUB_A),
    );

    // .strict() lehnt das unbekannte Feld ab -> das Update wird insgesamt
    // zurückgewiesen (kein teilweises/stillschweigendes Anwenden).
    expect(results[0]!.status).toBe('error');
    const stored = await gateway.findById('groups', seedPayload.id);
    expect(stored?.name).toBe(seedPayload.name); // unverändert
    expect((stored as Record<string, unknown>).extraField).toBeUndefined();
  });

  it('akzeptiert und speichert Kommentare an einer Übung im Übungskatalog (neues Feature)', async () => {
    const { service, gateway } = makeService();
    const payload = makeExercisePayload({
      comments: [{ id: 'c1', authorName: 'Jonas Beck', text: 'Auf Handstellung achten.', createdAt: new Date().toISOString() }],
    });
    const results = await service.push(
      [{ id: 'evt-exercise-comment', store: 'exercises', entityId: payload.id, action: 'create', payload, clientUpdatedAt: payload.updatedAt }],
      asTrainer(CLUB_A),
    );
    expect(results[0]!.status).toBe('applied');
    const stored = await gateway.findById('exercises', payload.id);
    expect((stored as Record<string, unknown>).comments).toEqual(payload.comments);
  });

  it('lehnt einen Kommentar mit einem im Schema unbekannten Feld ab (z. B. eine mitgeschickte "authorUserId")', async () => {
    const { service } = makeService();
    const payload = makeExercisePayload({
      comments: [{ id: 'c1', authorName: 'Jonas Beck', text: 'X', createdAt: new Date().toISOString(), authorUserId: 'sollte-nicht-erlaubt-sein' }],
    });
    const results = await service.push(
      [{ id: 'evt-exercise-bad-comment', store: 'exercises', entityId: payload.id, action: 'create', payload, clientUpdatedAt: payload.updatedAt }],
      asTrainer(CLUB_A),
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
      asTrainer(CLUB_A),
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

    const result = await service.pull({}, asTrainer(CLUB_A));
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0]!.entityId).toBe('g1');
  });

  it('liefert nur Änderungen nach dem angegebenen "since"-Zeitpunkt', async () => {
    const { service, gateway } = makeService();
    gateway.seed('groups', { id: 'old', clubId: CLUB_A, name: 'Alt', updatedAt: new Date('2026-01-01T00:00:00.000Z'), deletedAt: null });
    gateway.seed('groups', { id: 'new', clubId: CLUB_A, name: 'Neu', updatedAt: new Date('2026-06-01T00:00:00.000Z'), deletedAt: null });

    const result = await service.pull({ since: '2026-03-01T00:00:00.000Z' }, asTrainer(CLUB_A));
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0]!.entityId).toBe('new');
  });

  it('markiert gelöschte Datensätze mit action: "delete" und payload: null', async () => {
    const { service, gateway } = makeService();
    gateway.seed('groups', { id: 'deleted', clubId: CLUB_A, name: 'X', updatedAt: new Date(), deletedAt: new Date() });

    const result = await service.pull({}, asTrainer(CLUB_A));
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
    const result = await service.pull({}, asTrainer(CLUB_A));
    expect(result.changes).toHaveLength(5);
    expect(result.hasMore).toBe(false);
    expect(result.nextCursor).toBeNull();
  });

  it('liefert eine leere, abgeschlossene Änderungsliste, wenn nichts vorhanden ist', async () => {
    const { service } = makeService();
    const result = await service.pull({}, asTrainer(CLUB_A));
    expect(result).toEqual({ changes: [], nextCursor: null, hasMore: false });
  });
});

describe('syncService.pull — Tombstones (Löschmarkierungen für endgültig entfernte Daten)', () => {
  it('meldet eine Löschung anhand eines Tombstones, obwohl die Zeile nie im Server-Stand existierte', async () => {
    // Simuliert genau den Grenzfall "Gerät war länger offline als die
    // Aufbewahrungsfrist": der Server-Stand kennt den Datensatz gar nicht
    // (er wurde bereits endgültig gelöscht) — nur der Tombstone existiert.
    const tombstones = [{ clubId: CLUB_A, store: 'athletes' as const, entityId: 'ath-1', deletedAt: new Date('2026-07-01T00:00:00.000Z') }];
    const gateway = new InMemorySyncGateway(tombstones);
    const service = createSyncService({ gateway });

    const result = await service.pull({}, asTrainer(CLUB_A));
    expect(result.changes).toEqual([
      { store: 'athletes', entityId: 'ath-1', action: 'delete', payload: null, updatedAt: '2026-07-01T00:00:00.000Z' },
    ]);
  });

  it('berücksichtigt "since" auch für Tombstones', async () => {
    const tombstones = [
      { clubId: CLUB_A, store: 'athletes' as const, entityId: 'alt', deletedAt: new Date('2026-01-01T00:00:00.000Z') },
      { clubId: CLUB_A, store: 'athletes' as const, entityId: 'neu', deletedAt: new Date('2026-06-01T00:00:00.000Z') },
    ];
    const gateway = new InMemorySyncGateway(tombstones);
    const service = createSyncService({ gateway });

    const result = await service.pull({ since: '2026-03-01T00:00:00.000Z' }, asTrainer(CLUB_A));
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0]!.entityId).toBe('neu');
  });

  it('meldet Tombstones nur für den eigenen Verein', async () => {
    const tombstones = [
      { clubId: CLUB_A, store: 'athletes' as const, entityId: 'a1', deletedAt: new Date() },
      { clubId: CLUB_B, store: 'athletes' as const, entityId: 'b1', deletedAt: new Date() },
    ];
    const gateway = new InMemorySyncGateway(tombstones);
    const service = createSyncService({ gateway });

    const result = await service.pull({}, asTrainer(CLUB_A));
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0]!.entityId).toBe('a1');
  });
});

describe('syncService.push — verständliche Fehlermeldung bei endgültig gelöschten Referenzen', () => {
  it('übersetzt einen Push-Versuch für eine bereits endgültig gelöschte (tombstoned) Person in eine klare Meldung', async () => {
    const ATHLETE_ID = '55555555-5555-5555-5555-555555555555';
    const tombstones = [{ clubId: CLUB_A, store: 'athletes' as const, entityId: ATHLETE_ID, deletedAt: new Date() }];
    const gateway = new InMemorySyncGateway(tombstones);
    const service = createSyncService({ gateway });

    const now = new Date().toISOString();
    const payload = {
      id: '66666666-6666-6666-6666-666666666666', clubId: CLUB_A, athleteId: ATHLETE_ID,
      event: '100 Freistil', time: 60, date: now, course: 'LCM', competitionId: null, place: null, isPB: false,
      createdAt: now, updatedAt: now,
    };
    const results = await service.push(
      [{ id: 'evt-x', store: 'results', entityId: payload.id, action: 'create', payload, clientUpdatedAt: payload.updatedAt }],
      asTrainer(CLUB_A),
    );

    expect(results[0]!.status).toBe('error');
    expect(results[0]!.message).toContain('existiert nicht mehr');
  });
});

describe('syncService.push — Vereins-Scoping bei UPDATE eines bestehenden fremden Datensatzes (Sicherheitsregression)', () => {
  it('darf einen bestehenden Datensatz eines FREMDEN Vereins nicht überschreiben, selbst wenn die Payload-clubId dem eigenen Verein entspricht', async () => {
    const { service, gateway } = makeService();
    const foreignId = '77777777-7777-7777-7777-777777777777';
    const originalUpdatedAt = new Date('2026-01-01T00:00:00.000Z');
    // Bestehender Datensatz gehört CLUB_B.
    gateway.seed('groups', {
      id: foreignId,
      clubId: CLUB_B,
      name: 'Original (Verein B)',
      updatedAt: originalUpdatedAt,
      deletedAt: null,
    });

    // Angreifer aus CLUB_A versucht, unter der bekannten fremden entityId
    // ein Update mit eigener clubId im Payload einzuschleusen.
    const maliciousPayload = makeGroupPayload({
      id: foreignId,
      clubId: CLUB_A, // Payload-clubId ist "korrekt" (die eigene) — die Lücke lag in der fehlenden Prüfung von existing.clubId.
      name: 'Übernommen von Verein A',
      updatedAt: new Date('2026-06-01T00:00:00.000Z').toISOString(),
    });

    const results = await service.push(
      [{ id: 'evt-cross-update', store: 'groups', entityId: foreignId, action: 'update', payload: maliciousPayload, clientUpdatedAt: maliciousPayload.updatedAt as string }],
      asTrainer(CLUB_A),
    );

    // Der Versuch muss fehlschlagen (id-Kollision mit fremdem Datensatz),
    // NICHT still als "applied" durchgehen.
    expect(results[0]!.status).toBe('error');

    // Der fremde Datensatz muss in jedem Fall unverändert (Verein B,
    // Originalname) bleiben — das ist die eigentliche Sicherheitsaussage.
    const stillForeign = await gateway.findById('groups', foreignId);
    expect(stillForeign?.clubId).toBe(CLUB_B);
    expect(stillForeign?.name).toBe('Original (Verein B)');
  });

  it('lässt einen scoped findById()-Aufruf einen Datensatz eines fremden Vereins nicht mehr finden (verhindert Infoleak über Konfliktergebnisse)', async () => {
    const { gateway } = makeService();
    const foreignId = '88888888-8888-8888-8888-888888888888';
    gateway.seed('groups', { id: foreignId, clubId: CLUB_B, name: 'Geheim (Verein B)', updatedAt: new Date(), deletedAt: null });

    // Ungescoped (z. B. für interne/Test-Zwecke) weiterhin auffindbar …
    expect(await gateway.findById('groups', foreignId)).not.toBeNull();
    // … aber mit der clubId des anfragenden (fremden) Vereins gescoped: nicht auffindbar.
    expect(await gateway.findById('groups', foreignId, CLUB_A)).toBeNull();
  });

  it('meldet keinen "conflict" mit fremder serverVersion, wenn der bestehende Datensatz einem anderen Verein gehört', async () => {
    const { service, gateway } = makeService();
    const foreignId = '99999999-9999-9999-9999-999999999999';
    gateway.seed('groups', { id: foreignId, clubId: CLUB_B, name: 'Geheim (Verein B)', updatedAt: new Date('2026-06-01T00:00:00.000Z'), deletedAt: null });

    const payload = makeGroupPayload({ id: foreignId, clubId: CLUB_A, updatedAt: new Date('2026-01-01T00:00:00.000Z').toISOString() });
    const results = await service.push(
      [{ id: 'evt-leak-attempt', store: 'groups', entityId: foreignId, action: 'update', payload, clientUpdatedAt: payload.updatedAt as string }],
      asTrainer(CLUB_A),
    );

    // Vorher (Sicherheitslücke): status "conflict" mit serverVersion, die
    // den kompletten fremden Datensatz enthielt. Jetzt: kein Leak über
    // diesen Pfad — der fremde Datensatz gilt als nicht existent.
    expect(results[0]!.status).not.toBe('conflict');
    expect(JSON.stringify(results[0])).not.toContain('Geheim (Verein B)');
  });
});

describe('syncService — Rollen-Scopierung für "athlete" (Sicherheitsregression, Patch #6)', () => {
  it('lehnt einen PUSH auf "actionItems" durch die Rolle "athlete" ab (create)', async () => {
    const { service } = makeService();
    const payload = makeActionItemPayload();
    const results = await service.push(
      [{ id: 'evt-athlete-write-1', store: 'actionItems', entityId: payload.id, action: 'create', payload, clientUpdatedAt: payload.updatedAt }],
      asAthlete(CLUB_A, payload.athleteId as string),
    );
    expect(results[0]!.status).toBe('error');
  });

  it('lehnt einen PUSH auf "sessions" durch die Rolle "athlete" ab (update), selbst wenn nur die eigene Zeile geändert würde', async () => {
    const { service, gateway } = makeService();
    const payload = makeSessionPayload();
    gateway.seed('sessions', { ...payload, updatedAt: new Date(payload.updatedAt), createdAt: new Date(payload.createdAt), deletedAt: null });
    const updated = { ...payload, updatedAt: new Date(Date.now() + 60_000).toISOString() };
    const results = await service.push(
      [{ id: 'evt-athlete-write-2', store: 'sessions', entityId: payload.id, action: 'update', payload: updated, clientUpdatedAt: updated.updatedAt }],
      asAthlete(CLUB_A, '55555555-5555-5555-5555-555555555555'),
    );
    expect(results[0]!.status).toBe('error');
  });

  it('lehnt auch einen DELETE auf "sessions"/"actionItems" durch die Rolle "athlete" ab', async () => {
    const { service, gateway } = makeService();
    const payload = makeActionItemPayload();
    gateway.seed('actionItems', { ...payload, updatedAt: new Date(payload.updatedAt), createdAt: new Date(payload.createdAt), createdDate: new Date(payload.createdDate), deletedAt: null });
    const results = await service.push(
      [{ id: 'evt-athlete-write-3', store: 'actionItems', entityId: payload.id, action: 'delete', payload: null, clientUpdatedAt: new Date().toISOString() }],
      asAthlete(CLUB_A, payload.athleteId as string),
    );
    expect(results[0]!.status).toBe('error');
  });

  it('trainer/admin sind von der Schreibsperre NICHT betroffen — dürfen "actionItems"/"sessions" weiterhin verändern', async () => {
    const { service } = makeService();
    const payload = makeActionItemPayload();
    const results = await service.push(
      [{ id: 'evt-trainer-write', store: 'actionItems', entityId: payload.id, action: 'create', payload, clientUpdatedAt: payload.updatedAt }],
      asTrainer(CLUB_A),
    );
    expect(results[0]!.status).toBe('applied');
  });

  it('PULL für Rolle "athlete": "actionItems" werden auf die eigenen Einträge gefiltert', async () => {
    const { service, gateway } = makeService();
    const mine = makeActionItemPayload({ id: 'ai-mine', athleteId: '55555555-5555-5555-5555-555555555555' });
    const foreign = makeActionItemPayload({ id: 'ai-foreign', athleteId: '66666666-6666-6666-6666-666666666661' });
    gateway.seed('actionItems', { ...mine, updatedAt: new Date(mine.updatedAt), createdAt: new Date(mine.createdAt), createdDate: new Date(mine.createdDate), deletedAt: null });
    gateway.seed('actionItems', { ...foreign, updatedAt: new Date(foreign.updatedAt), createdAt: new Date(foreign.createdAt), createdDate: new Date(foreign.createdDate), deletedAt: null });

    const result = await service.pull({}, asAthlete(CLUB_A, '55555555-5555-5555-5555-555555555555'));
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0]!.entityId).toBe('ai-mine');
  });

  it('PULL für Rolle "athlete": "sessions" werden auf die eigene attendance-Zeile reduziert; fremde Notiz/RPE werden entfernt', async () => {
    const { service, gateway } = makeService();
    const payload = makeSessionPayload();
    gateway.seed('sessions', { ...payload, updatedAt: new Date(payload.updatedAt), createdAt: new Date(payload.createdAt), deletedAt: null });

    const result = await service.pull({}, asAthlete(CLUB_A, '55555555-5555-5555-5555-555555555555'));
    expect(result.changes).toHaveLength(1);
    const attendance = (result.changes[0]!.payload as { attendance: Array<Record<string, unknown>> }).attendance;
    expect(attendance).toHaveLength(1);
    expect(attendance[0]!.athleteId).toBe('55555555-5555-5555-5555-555555555555');
    expect(JSON.stringify(result.changes[0])).not.toContain('fremde Notiz');
  });

  it('PULL für Rolle "athlete": eine "sessions"-Einheit, an der die Person gar nicht teilnahm, wird komplett ausgeblendet', async () => {
    const { service, gateway } = makeService();
    const payload = makeSessionPayload({
      id: 'session-ohne-mich',
      attendance: [{ athleteId: '66666666-6666-6666-6666-666666666661', present: true, rpe: 5, note: 'nur fremd' }],
    });
    gateway.seed('sessions', { ...payload, updatedAt: new Date(payload.updatedAt), createdAt: new Date(payload.createdAt), deletedAt: null });

    const result = await service.pull({}, asAthlete(CLUB_A, '55555555-5555-5555-5555-555555555555'));
    expect(result.changes).toHaveLength(0);
  });

  it('PULL für Rolle "athlete": Tombstones (Löschungen) werden unverändert durchgereicht', async () => {
    const tombstones = [{ clubId: CLUB_A, store: 'actionItems' as const, entityId: 'ai-deleted', deletedAt: new Date() }];
    const gateway = new InMemorySyncGateway(tombstones);
    const service = createSyncService({ gateway });

    const result = await service.pull({}, asAthlete(CLUB_A, '55555555-5555-5555-5555-555555555555'));
    expect(result.changes).toEqual([
      { store: 'actionItems', entityId: 'ai-deleted', action: 'delete', payload: null, updatedAt: tombstones[0]!.deletedAt.toISOString() },
    ]);
  });

  it('PULL für Rolle "athlete": andere Stores ("groups", "results", "plans") bleiben unrestringiert (entspricht der bewusst geteilten Team-Ansicht)', async () => {
    const { service, gateway } = makeService();
    const group = makeGroupPayload();
    gateway.seed('groups', { ...group, updatedAt: new Date(group.updatedAt), createdAt: new Date(group.createdAt), deletedAt: null });
    const foreignResult = makeResultPayload({ athleteId: '66666666-6666-6666-6666-666666666661' });
    gateway.seed('results', { ...foreignResult, updatedAt: new Date(foreignResult.updatedAt), date: new Date(foreignResult.date), createdAt: new Date(foreignResult.createdAt), deletedAt: null });

    const result = await service.pull({}, asAthlete(CLUB_A, '55555555-5555-5555-5555-555555555555'));
    const stores = result.changes.map((c) => c.store).sort();
    expect(stores).toEqual(['groups', 'results']);
  });

  it('trainer/admin sind vom PULL-Filter NICHT betroffen — sehen weiterhin alle "actionItems"/"sessions" des Vereins', async () => {
    const { service, gateway } = makeService();
    const foreign = makeActionItemPayload({ id: 'ai-foreign-2', athleteId: '66666666-6666-6666-6666-666666666661' });
    gateway.seed('actionItems', { ...foreign, updatedAt: new Date(foreign.updatedAt), createdAt: new Date(foreign.createdAt), createdDate: new Date(foreign.createdDate), deletedAt: null });

    const result = await service.pull({}, asTrainer(CLUB_A));
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0]!.entityId).toBe('ai-foreign-2');
  });
});

describe('describeSyncError()', () => {
  it('übersetzt einen Fehler mit Prisma-Code "P2003" (Fremdschlüssel-Verletzung) in eine verständliche deutsche Meldung', () => {
    const fakeError = { code: 'P2003', message: 'Foreign key constraint failed on the field: `athleteId`' };
    expect(describeSyncError(fakeError)).toBe(
      'Die referenzierte Person oder der referenzierte Datensatz existiert nicht mehr (wurde vermutlich zwischenzeitlich endgültig gelöscht).',
    );
  });

  it('gibt die Original-Fehlermeldung für einen normalen Error unverändert zurück', () => {
    expect(describeSyncError(new Error('Etwas anderes ist schiefgelaufen'))).toBe('Etwas anderes ist schiefgelaufen');
  });

  it('liefert einen generischen Text für Fehler ohne erkennbare Form', () => {
    expect(describeSyncError('nur ein String')).toBe('Unbekannter Fehler.');
    expect(describeSyncError(undefined)).toBe('Unbekannter Fehler.');
  });

  it('behandelt einen Fehler mit anderem Code nicht als Fremdschlüssel-Verletzung', () => {
    const fakeError = { code: 'P2002', message: 'Unique constraint failed' };
    expect(describeSyncError(fakeError)).toBe('Unbekannter Fehler.');
  });
});
