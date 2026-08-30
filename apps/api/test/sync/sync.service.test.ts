// apps/api/test/sync/sync.service.test.ts
import { describe, it, expect, vi } from 'vitest';
import { createSyncService } from '../../src/modules/sync/sync.service.js';
import { describeSyncError } from '../../src/modules/sync/sync.errors.js';
import { splitAtSafeTimestampBoundary } from '../../src/modules/sync/sync.pagination.js';
import { InMemorySyncGateway } from '../../src/modules/sync/sync.gateway.memory.js';
import type { ChangedRecord } from '../../src/modules/sync/sync.gateway.js';
import { MODULE_KEYS } from '@lane1/shared-types';

const CLUB_A = '11111111-1111-1111-1111-111111111111';
const CLUB_B = '22222222-2222-2222-2222-222222222222';

// Feste userId je Rollen-Helfer (Sicherheitsreview 2026-08-27, Befund
// M2) — SyncRequester.userId wird u. a. für die Autor:innen-Prüfung
// eingebetteter Kommentare gebraucht (siehe sync.commentAuthorship.ts).
// Als eigene Konstanten exportiert, damit die dedizierten M2-Tests weiter
// unten Kommentare mit einer passenden bzw. bewusst abweichenden
// authorId konstruieren können.
export const TRAINER_USER_ID = '77777777-0000-0000-0000-000000000001';
export const ATHLETE_USER_ID = '77777777-0000-0000-0000-000000000002';
export const ADMIN_USER_ID = '77777777-0000-0000-0000-000000000003';

// Bestehende Tests (vor der Rollen-Scopierung geschrieben) prüfen
// durchweg unrestringiertes Verhalten — dafür steht diese Requester-Form
// mit role "trainer" (unbetroffen von den neuen athlete-Beschränkungen).
// Die dedizierten athlete-Regressionstests weiter unten verwenden
// stattdessen explizit { clubId, role: 'athlete', athleteId }. Alle drei
// Requester-Helfer geben `enabledModules: MODULE_KEYS` mit (alle Module
// gebucht) — diese Suite testet Rollen-/FK-/Konflikt-Verhalten, nicht das
// Modul-Gating selbst (siehe sync.permissions.test.ts dafür).
function asTrainer(clubId: string) {
  return { userId: TRAINER_USER_ID, clubId, role: 'trainer' as const, athleteId: null, enabledModules: MODULE_KEYS };
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
  return { userId: ATHLETE_USER_ID, clubId, role: 'athlete' as const, athleteId, enabledModules: MODULE_KEYS };
}

// "athletes" ist seit der Access-Konsistenz-Korrektur (siehe STORE_PERMISSIONS)
// das einzige Store, für das "trainer" NICHT dieselben Schreibrechte wie
// "admin" hat — daher braucht der Store-übergreifende asTrainer()-Helfer
// hier oben ein eigenes admin-Pendant für Tests, die ausschließlich die
// Fremdschlüssel-/Feld-Logik prüfen wollen, unabhängig von der Rollensperre.
function asAdmin(clubId: string) {
  return { userId: ADMIN_USER_ID, clubId, role: 'admin' as const, athleteId: null, enabledModules: MODULE_KEYS };
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
    assignedTrainerId: null,
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

function makeAthletePayload(overrides: Partial<Record<string, unknown>> = {}) {
  const now = new Date().toISOString();
  return {
    id: '55555555-5555-5555-5555-555555555555',
    clubId: CLUB_A,
    firstName: 'Mara',
    lastName: 'Vogel',
    birthdate: '2009-03-14T00:00:00.000Z',
    gender: 'w',
    groupId: null,
    joinDate: '2019-08-01T00:00:00.000Z',
    active: true,
    notes: '',
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
    // Fremdschlüssel-Eigentümerprüfung (siehe sync.service.ts:
    // assertForeignKeysWithinClub()) verlangt jetzt, dass die
    // referenzierte athleteId tatsächlich im eigenen Verein existiert.
    const athlete = makeAthletePayload();
    gateway.seed('athletes', { ...athlete, birthdate: new Date(athlete.birthdate), joinDate: new Date(athlete.joinDate), updatedAt: new Date(athlete.updatedAt), createdAt: new Date(athlete.createdAt), deletedAt: null });
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

// Code-Review, Befund C3: create()/update()/softDelete() und
// markEventProcessed() liefen bislang als zwei getrennte Aufrufe statt
// atomar in einer Transaktion — siehe applyAndMarkProcessed() in
// sync.gateway.ts für die eigentliche Korrektur sowie
// test-integration/syncGateway.integration.test.ts für den daraus
// resultierenden Race-Condition-Schutz gegen ECHTES Postgres (ein
// In-Memory-Double kann das mangels echter Nebenläufigkeit nicht
// abbilden). Dieser Block prüft ausschließlich, dass sync.service.ts den
// 'already-processed'-Ausgang von applyAndMarkProcessed() korrekt in eine
// Antwort ohne Phantom-serverVersion übersetzt.
describe('syncService.push — Umgang mit einem gleichzeitig gewonnenen Ledger-Eintrag (Code-Review, Befund C3)', () => {
  it('insert-as-new: meldet "applied" OHNE serverVersion, wenn applyAndMarkProcessed() "already-processed" liefert', async () => {
    // Erzwingt genau den Ausgang, den ein ECHTER gleichzeitiger Versuch
    // liefern würde (siehe Integrationstest oben) — InMemorySyncGateway
    // selbst kann diese Nebenläufigkeit nicht herstellen (Node ist
    // single-threaded), daher hier direkt überschrieben, um ausschließlich
    // sync.service.ts' EIGENE Behandlung dieses Ausgangs zu prüfen.
    class ForcedAlreadyProcessedGateway extends InMemorySyncGateway {
      async applyAndMarkProcessed(): Promise<'applied' | 'already-processed'> {
        return 'already-processed';
      }
    }
    const gateway = new ForcedAlreadyProcessedGateway();
    const service = createSyncService({ gateway });

    const athlete = makeAthletePayload();
    gateway.seed('athletes', { ...athlete, birthdate: new Date(athlete.birthdate), joinDate: new Date(athlete.joinDate), updatedAt: new Date(athlete.updatedAt), createdAt: new Date(athlete.createdAt), deletedAt: null });
    const serverResult = makeResultPayload({ time: 60.1, updatedAt: '2026-06-10T00:00:00.000Z' });
    gateway.seed('results', { ...serverResult, updatedAt: new Date(serverResult.updatedAt), deletedAt: null });

    const staleClientResult = makeResultPayload({ time: 61.5, updatedAt: '2026-06-01T00:00:00.000Z' });
    const results = await service.push(
      [{ id: 'evt-race', store: 'results', entityId: staleClientResult.id, action: 'update', payload: staleClientResult, clientUpdatedAt: staleClientResult.updatedAt }],
      asTrainer(CLUB_A),
    );

    // Weiterhin "applied" (aus Client-Sicht ist das Event längst
    // angewendet — nur eben von der anderen, gewinnenden Anfrage) — aber
    // OHNE serverVersion: die von DIESEM Aufruf lokal erzeugte newId
    // wurde nie tatsächlich geschrieben, sie in serverVersion zu melden
    // wäre eine Phantom-id.
    expect(results[0]!.status).toBe('applied');
    expect(results[0]!.serverVersion).toBeUndefined();
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
      comments: [{ id: 'c1', authorId: TRAINER_USER_ID, authorName: 'Jonas Beck', text: 'Auf Handstellung achten.', createdAt: new Date().toISOString() }],
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
      comments: [{ id: 'c1', authorId: TRAINER_USER_ID, authorName: 'Jonas Beck', text: 'X', createdAt: new Date().toISOString(), authorUserId: 'sollte-nicht-erlaubt-sein' }],
    });
    const results = await service.push(
      [{ id: 'evt-exercise-bad-comment', store: 'exercises', entityId: payload.id, action: 'create', payload, clientUpdatedAt: payload.updatedAt }],
      asTrainer(CLUB_A),
    );
    expect(results[0]!.status).toBe('error');
  });
});

describe('syncService.push — serverseitige Zeitstempel-Hoheit (Sicherheitskorrektur, kritischer Befund 2)', () => {
  it('ignoriert ein client-geliefertes "updatedAt" beim Anlegen und setzt stattdessen die eigene Serverzeit', async () => {
    const { service, gateway } = makeService();
    // Weit in der Vergangenheit — würde diese Zeitmarke persistiert, wäre
    // der Datensatz für jeden Client, dessen Sync-Cursor bereits danach
    // liegt, dauerhaft unsichtbar (stiller Datenverlust beim Pull).
    const spoofedPast = '2000-01-01T00:00:00.000Z';
    const payload = makeGroupPayload({ createdAt: spoofedPast, updatedAt: spoofedPast });

    const before = Date.now();
    const results = await service.push(
      [{ id: 'evt-timestamp-spoof-create', store: 'groups', entityId: payload.id, action: 'create', payload, clientUpdatedAt: spoofedPast }],
      asTrainer(CLUB_A),
    );
    expect(results[0]!.status).toBe('applied');

    const stored = await gateway.findById('groups', payload.id);
    expect(stored?.updatedAt.getTime()).toBeGreaterThanOrEqual(before);
    expect((stored as Record<string, unknown> | null)?.createdAt).toBeInstanceOf(Date);
    expect(((stored as Record<string, unknown>).createdAt as Date).getTime()).toBeGreaterThanOrEqual(before);
  });

  it('ignoriert ein client-geliefertes "updatedAt" beim Aktualisieren und setzt stattdessen die eigene Serverzeit', async () => {
    const { service, gateway } = makeService();
    const original = makeGroupPayload({ id: '77777777-7777-7777-7777-777777777777' });
    gateway.seed('groups', { ...original, updatedAt: new Date(original.updatedAt), createdAt: new Date(original.createdAt), deletedAt: null });

    // Weit in der Zukunft — würde diese Zeitmarke persistiert, erschiene der
    // Datensatz gegenüber jedem echten, gleichzeitig eintreffenden Update
    // permanent als "der neueste Stand".
    const spoofedFuture = '2099-01-01T00:00:00.000Z';
    const payload = { ...original, name: 'Geänderter Name', updatedAt: spoofedFuture };

    const before = Date.now();
    const results = await service.push(
      [{ id: 'evt-timestamp-spoof-update', store: 'groups', entityId: payload.id, action: 'update', payload, clientUpdatedAt: original.updatedAt }],
      asTrainer(CLUB_A),
    );
    expect(results[0]!.status).toBe('applied');

    const stored = await gateway.findById('groups', payload.id);
    expect(stored?.name).toBe('Geänderter Name');
    expect(stored?.updatedAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(stored?.updatedAt.toISOString()).not.toBe(spoofedFuture);
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

  // Sicherheitskorrektur (Code-Review, kritischer Befund 1): vormals wurde
  // `nextCursor` nur zurückgegeben, wenn `hasMore` gesetzt war — auf der
  // (hier einzigen) letzten Seite eines Sync-Zyklus blieb er fälschlich
  // `null`. Der Client (syncClient.js: pull()) persistiert einen Cursor
  // aber nur, wenn er nicht `null` ist — jeder automatische
  // Hintergrund-Sync zog dadurch dauerhaft den kompletten Vereinsbestand
  // erneut, statt seit dem letzten Mal fortzusetzen.
  it('liefert einen nextCursor auch dann, wenn alle Änderungen in eine einzige Seite passen (hasMore: false)', async () => {
    const { service, gateway } = makeService();
    for (let i = 0; i < 5; i++) {
      gateway.seed('groups', {
        id: `g-${i}`, clubId: CLUB_A, name: `Gruppe ${i}`,
        updatedAt: new Date(2026, 0, i + 1), deletedAt: null,
      });
    }
    const result = await service.pull({}, asTrainer(CLUB_A));
    expect(result.changes).toHaveLength(5);
    expect(result.hasMore).toBe(false);
    // Letzte Zeile ist "g-4" (2026-01-05) — der Cursor zeigt auf sie, nicht
    // auf `null`.
    expect(result.nextCursor).toBe(new Date(2026, 0, 5).toISOString());
  });

  it('liefert eine leere, abgeschlossene Änderungsliste, wenn nichts vorhanden ist', async () => {
    const { service } = makeService();
    const result = await service.pull({}, asTrainer(CLUB_A));
    expect(result).toEqual({ changes: [], nextCursor: null, hasMore: false });
  });

  // Echter Mehrseiten-Test (die Seitengröße ist intern 200, siehe
  // PULL_PAGE_SIZE in sync.service.ts): mehr Änderungen als in eine Seite
  // passen, jede mit eindeutigem Zeitstempel — deckt ab, dass eine zweite
  // Pull-Runde mit dem zurückgegebenen Cursor tatsächlich genau den Rest
  // liefert, ohne Überschneidung oder Lücke.
  it('paginiert bei mehr als 200 Änderungen über zwei Pull-Runden vollständig und ohne Überschneidung', async () => {
    const { service, gateway } = makeService();
    const TOTAL = 205;
    for (let i = 0; i < TOTAL; i++) {
      gateway.seed('groups', {
        id: `g-${i}`, clubId: CLUB_A, name: `Gruppe ${i}`,
        updatedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, 0, i)), deletedAt: null,
      });
    }

    const first = await service.pull({}, asTrainer(CLUB_A));
    expect(first.changes).toHaveLength(200);
    expect(first.hasMore).toBe(true);
    expect(first.nextCursor).not.toBeNull();

    const second = await service.pull({ cursor: first.nextCursor! }, asTrainer(CLUB_A));
    expect(second.changes).toHaveLength(5);
    expect(second.hasMore).toBe(false);

    const allIds = [...first.changes, ...second.changes].map((c) => c.entityId).sort();
    const expectedIds = Array.from({ length: TOTAL }, (_, i) => `g-${i}`).sort();
    expect(allIds).toEqual(expectedIds);
  });

  // Sicherheitskorrektur (Code-Review, kritischer Befund 3): mehrere Zeilen
  // mit EXAKT demselben Zeitstempel dürfen nicht mitten durch die
  // Seitengrenze geschnitten werden — sonst würde die "zweite Hälfte" der
  // Gruppe beim nächsten Pull mit `updatedAt > cursor` (strikt) auf ewig
  // übersprungen. Hier: 200 Zeilen mit fortlaufenden Zeitstempeln (füllen
  // exakt die erste Seite) plus 3 weitere, die sich alle den letzten
  // dieser Zeitstempel teilen — die Grenze liegt damit genau in der
  // Kollisionsgruppe.
  it('teilt eine Seite nicht mitten durch mehrere Zeilen mit exakt demselben Zeitstempel', async () => {
    const { service, gateway } = makeService();
    for (let i = 0; i < 199; i++) {
      gateway.seed('groups', {
        id: `g-${i}`, clubId: CLUB_A, name: `Gruppe ${i}`,
        updatedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, 0, i)), deletedAt: null,
      });
    }
    const tiedAt = new Date(Date.UTC(2026, 0, 1, 0, 0, 0, 199));
    for (let i = 0; i < 4; i++) {
      gateway.seed('groups', { id: `tied-${i}`, clubId: CLUB_A, name: `Kollision ${i}`, updatedAt: tiedAt, deletedAt: null });
    }
    // Insgesamt 199 + 4 = 203 Zeilen; die ersten 199 haben je einen eigenen
    // Zeitstempel, die letzten 4 teilen sich exakt tiedAt — die
    // Seitengrenze (200) liegt damit mitten in dieser 4er-Gruppe.

    const first = await service.pull({}, asTrainer(CLUB_A));
    // Keine der 4 kollidierenden Zeilen darf isoliert (ohne die übrigen)
    // auf dieser Seite landen.
    const tiedOnFirstPage = first.changes.filter((c) => c.entityId.startsWith('tied-'));
    expect(tiedOnFirstPage.length === 0 || tiedOnFirstPage.length === 4).toBe(true);
    expect(first.hasMore).toBe(true);

    const second = await service.pull({ cursor: first.nextCursor! }, asTrainer(CLUB_A));
    const allIds = new Set([...first.changes, ...second.changes].map((c) => c.entityId));
    for (let i = 0; i < 4; i++) expect(allIds.has(`tied-${i}`)).toBe(true);
    for (let i = 0; i < 199; i++) expect(allIds.has(`g-${i}`)).toBe(true);
    // Keine Zeile darf doppelt geliefert worden sein.
    expect(allIds.size).toBe(203);
  });

  // Extremfall von splitAtSafeTimestampBoundary(): MEHR als PULL_PAGE_SIZE+1
  // Zeilen teilen sich allesamt exakt denselben Zeitstempel — innerhalb des
  // Blickfensters gibt es keine sichere Grenze, pull() muss auf die
  // gezielte Nachfrage (Sicherheits-Deckel) ausweichen, um sie vollständig
  // in einer Runde aufzulösen, statt denselben Sprung endlos zu wiederholen.
  it('löst eine Kollisionsgruppe auf, die größer als die Seitengröße ist, vollständig über die gezielte Nachfrage', async () => {
    const { service, gateway } = makeService();
    const TOTAL = 205;
    const tiedAt = new Date('2026-01-01T00:00:00.000Z');
    for (let i = 0; i < TOTAL; i++) {
      gateway.seed('groups', { id: `tied-${i}`, clubId: CLUB_A, name: `Kollision ${i}`, updatedAt: tiedAt, deletedAt: null });
    }

    const first = await service.pull({}, asTrainer(CLUB_A));
    expect(first.changes).toHaveLength(TOTAL);
    expect(new Set(first.changes.map((c) => c.entityId)).size).toBe(TOTAL);
    expect(first.nextCursor).toBe(tiedAt.toISOString());

    // Ein Folge-Pull mit diesem Cursor liefert korrekt nichts mehr — die
    // Kollisionsgruppe wurde bereits vollständig ausgeliefert.
    const second = await service.pull({ cursor: first.nextCursor! }, asTrainer(CLUB_A));
    expect(second.changes).toHaveLength(0);
    expect(second.hasMore).toBe(false);
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

describe('syncService.push — Fremdschlüssel-Eigentümerprüfung (Sicherheitsreview, Nachtrag)', () => {
  it('lehnt ein "results"-Event mit einer athleteId eines FREMDEN Vereins ab, obwohl clubId korrekt der eigene Verein ist', async () => {
    const { service, gateway } = makeService();
    const foreignAthlete = makeAthletePayload({ id: '55555555-5555-5555-5555-555555555555', clubId: CLUB_B });
    gateway.seed('athletes', { ...foreignAthlete, birthdate: new Date(foreignAthlete.birthdate), joinDate: new Date(foreignAthlete.joinDate), updatedAt: new Date(foreignAthlete.updatedAt), createdAt: new Date(foreignAthlete.createdAt), deletedAt: null });

    const payload = makeResultPayload(); // athleteId zeigt auf die soeben angelegte, fremde Athletin.
    const results = await service.push(
      [{ id: 'evt-fk-foreign-athlete', store: 'results', entityId: payload.id, action: 'create', payload, clientUpdatedAt: payload.updatedAt }],
      asTrainer(CLUB_A),
    );
    expect(results[0]!.status).toBe('error');
    // Dieselbe Meldung wie bei einer gar nicht existierenden Referenz —
    // schließt das Existenz-Orakel (siehe FOREIGN_ENTITY_ERROR).
    expect(results[0]!.message).toContain('existiert nicht mehr');

    // Es darf tatsächlich kein Ergebnis-Datensatz entstanden sein.
    const stored = await gateway.findById('results', payload.id);
    expect(stored).toBeNull();
  });

  it('lehnt ein "results"-Event mit einer athleteId ab, die gar nicht existiert (identische Meldung wie beim fremden Verein)', async () => {
    const { service } = makeService();
    const payload = makeResultPayload(); // athleteId wurde nirgends geseedet.
    const results = await service.push(
      [{ id: 'evt-fk-missing-athlete', store: 'results', entityId: payload.id, action: 'create', payload, clientUpdatedAt: payload.updatedAt }],
      asTrainer(CLUB_A),
    );
    expect(results[0]!.status).toBe('error');
    expect(results[0]!.message).toContain('existiert nicht mehr');
  });

  it('lehnt ein "actionItems"-Event mit einer assignedTrainerId eines Users aus einem FREMDEN Verein ab', async () => {
    const { service, gateway } = makeService();
    const athlete = makeAthletePayload();
    gateway.seed('athletes', { ...athlete, birthdate: new Date(athlete.birthdate), joinDate: new Date(athlete.joinDate), updatedAt: new Date(athlete.updatedAt), createdAt: new Date(athlete.createdAt), deletedAt: null });
    const foreignTrainerId = 'aaaaaaaa-0000-0000-0000-000000000001';
    gateway.seedUser(foreignTrainerId, CLUB_B);

    const payload = makeActionItemPayload({ assignedTrainerId: foreignTrainerId });
    const results = await service.push(
      [{ id: 'evt-fk-foreign-trainer', store: 'actionItems', entityId: payload.id, action: 'create', payload, clientUpdatedAt: payload.updatedAt }],
      asTrainer(CLUB_A),
    );
    expect(results[0]!.status).toBe('error');
  });

  it('akzeptiert eine assignedTrainerId, die zu einem User des EIGENEN Vereins gehört', async () => {
    const { service, gateway } = makeService();
    const athlete = makeAthletePayload();
    gateway.seed('athletes', { ...athlete, birthdate: new Date(athlete.birthdate), joinDate: new Date(athlete.joinDate), updatedAt: new Date(athlete.updatedAt), createdAt: new Date(athlete.createdAt), deletedAt: null });
    const ownTrainerId = 'aaaaaaaa-0000-0000-0000-000000000002';
    gateway.seedUser(ownTrainerId, CLUB_A);

    const payload = makeActionItemPayload({ assignedTrainerId: ownTrainerId });
    const results = await service.push(
      [{ id: 'evt-fk-own-trainer', store: 'actionItems', entityId: payload.id, action: 'create', payload, clientUpdatedAt: payload.updatedAt }],
      asTrainer(CLUB_A),
    );
    expect(results[0]!.status).toBe('applied');
  });

  it('lehnt ein "athletes"-Event mit einer groupId eines FREMDEN Vereins ab', async () => {
    const { service, gateway } = makeService();
    const foreignGroupId = 'bbbbbbbb-0000-0000-0000-000000000001';
    gateway.seed('groups', { id: foreignGroupId, clubId: CLUB_B, name: 'Fremde Gruppe', updatedAt: new Date(), deletedAt: null });

    const payload = makeAthletePayload({ groupId: foreignGroupId });
    // asAdmin() statt asTrainer(): "athletes" ist inzwischen adminVerwaltet
    // (siehe STORE_PERMISSIONS) — mit asTrainer() würde dieser Test bereits
    // an der Rollensperre scheitern und gar nicht mehr die hier eigentlich
    // geprüfte Fremdschlüssel-Logik erreichen.
    const results = await service.push(
      [{ id: 'evt-fk-foreign-group', store: 'athletes', entityId: payload.id, action: 'create', payload, clientUpdatedAt: payload.updatedAt }],
      asAdmin(CLUB_A),
    );
    expect(results[0]!.status).toBe('error');
  });

  it('akzeptiert eine groupId, die zu einer Gruppe des EIGENEN Vereins gehört', async () => {
    const { service, gateway } = makeService();
    const ownGroupId = 'bbbbbbbb-0000-0000-0000-000000000002';
    gateway.seed('groups', { id: ownGroupId, clubId: CLUB_A, name: 'Eigene Gruppe', updatedAt: new Date(), deletedAt: null });

    const payload = makeAthletePayload({ groupId: ownGroupId });
    const results = await service.push(
      [{ id: 'evt-fk-own-group', store: 'athletes', entityId: payload.id, action: 'create', payload, clientUpdatedAt: payload.updatedAt }],
      asAdmin(CLUB_A),
    );
    expect(results[0]!.status).toBe('applied');
  });

  it('lässt eine null-Referenz (z. B. "groupId": null) unbeanstandet — nichts zu prüfen', async () => {
    const { service } = makeService();
    const payload = makeAthletePayload({ groupId: null });
    const results = await service.push(
      [{ id: 'evt-fk-null-ref', store: 'athletes', entityId: payload.id, action: 'create', payload, clientUpdatedAt: payload.updatedAt }],
      asAdmin(CLUB_A),
    );
    expect(results[0]!.status).toBe('applied');
  });

  it.each(['templates', 'plans'] as const)(
    'lehnt ein "%s"-Event mit einer exerciseId eines FREMDEN Vereins ab, verschachtelt in sets[]/days[].sets[] (Access-Konsistenz-Korrektur)',
    async (store) => {
      const { service, gateway } = makeService();
      const foreignExerciseId = 'cccccccc-0000-0000-0000-000000000001';
      gateway.seed('exercises', {
        id: foreignExerciseId, clubId: CLUB_B, name: 'Fremde Übung', category: 'kick', stroke: null,
        description: '', defaultDistance: null, tags: [], equipment: [], comments: [], updatedAt: new Date(), deletedAt: null,
      });
      const now = new Date().toISOString();
      const plainSet = { kind: 'set' as const, id: 'set-1', description: '', distance: null, reps: 1, intensity: '', restSec: 0, exerciseId: foreignExerciseId, comments: [] };
      // Für "templates" steckt exerciseId direkt in `sets[]`; für "plans" eine Ebene
      // tiefer in `days[].sets[]` — zusätzlich innerhalb eines RepeatBlocks
      // ("kind: 'block'"), um auch die verschachtelte Block-Struktur abzudecken.
      const payload =
        store === 'templates'
          ? { id: '99999999-8888-8888-8888-888888888881', clubId: CLUB_A, name: 'Vorlage', description: '', tags: [], sets: [{ kind: 'block', id: 'block-1', label: '', repeatCount: 2, sets: [plainSet] }], createdAt: now, updatedAt: now }
          : { id: '99999999-8888-8888-8888-888888888882', clubId: CLUB_A, name: 'Plan', weekStart: now, groupId: null, status: 'aktiv', days: [{ date: now, sets: [plainSet] }], comments: [], createdAt: now, updatedAt: now };
      const results = await service.push(
        [{ id: `evt-fk-foreign-exercise-${store}`, store, entityId: payload.id, action: 'create', payload, clientUpdatedAt: now }],
        store === 'templates' ? asTrainer(CLUB_A) : asAthlete(CLUB_A, '55555555-5555-5555-5555-555555555555'),
      );
      expect(results[0]!.status).toBe('error');
      const stored = await gateway.findById(store, payload.id);
      expect(stored).toBeNull();
    },
  );

  it('lehnt ein "templates"-Event mit einer exerciseId eines FREMDEN Vereins ab, verschachtelt in einem Abschnitt (sets[].entries[], auch innerhalb eines Blocks darin)', async () => {
    const { service, gateway } = makeService();
    const foreignExerciseId = 'cccccccc-0000-0000-0000-000000000003';
    gateway.seed('exercises', {
      id: foreignExerciseId, clubId: CLUB_B, name: 'Fremde Übung', category: 'kick', stroke: null,
      description: '', defaultDistance: null, tags: [], equipment: [], comments: [], updatedAt: new Date(), deletedAt: null,
    });
    const now = new Date().toISOString();
    const plainSet = { kind: 'set' as const, id: 'set-1', description: '', distance: null, reps: 1, intensity: '', restSec: 0, exerciseId: foreignExerciseId, comments: [] };
    const payload = {
      id: '99999999-8888-8888-8888-888888888884', clubId: CLUB_A, name: 'Vorlage', description: '', tags: [],
      sets: [{ kind: 'section' as const, id: 'section-1', heading: 'Hauptteil', entries: [{ kind: 'block' as const, id: 'block-1', label: '', repeatCount: 2, sets: [plainSet] }] }],
      createdAt: now, updatedAt: now,
    };
    const results = await service.push(
      [{ id: 'evt-fk-foreign-exercise-section', store: 'templates', entityId: payload.id, action: 'create', payload, clientUpdatedAt: now }],
      asTrainer(CLUB_A),
    );
    expect(results[0]!.status).toBe('error');
    const stored = await gateway.findById('templates', payload.id);
    expect(stored).toBeNull();
  });

  it('akzeptiert eine exerciseId, die zu einer Übung des EIGENEN Vereins gehört (verschachtelt in "templates".sets[])', async () => {
    const { service, gateway } = makeService();
    const ownExerciseId = 'cccccccc-0000-0000-0000-000000000002';
    gateway.seed('exercises', {
      id: ownExerciseId, clubId: CLUB_A, name: 'Eigene Übung', category: 'kick', stroke: null,
      description: '', defaultDistance: null, tags: [], equipment: [], comments: [], updatedAt: new Date(), deletedAt: null,
    });
    const now = new Date().toISOString();
    const payload = {
      id: '99999999-8888-8888-8888-888888888883', clubId: CLUB_A, name: 'Vorlage', description: '', tags: [],
      sets: [{ kind: 'set' as const, id: 'set-1', description: '', distance: null, reps: 1, intensity: '', restSec: 0, exerciseId: ownExerciseId, comments: [] }],
      createdAt: now, updatedAt: now,
    };
    const results = await service.push(
      [{ id: 'evt-fk-own-exercise-templates', store: 'templates', entityId: payload.id, action: 'create', payload, clientUpdatedAt: now }],
      asTrainer(CLUB_A),
    );
    expect(results[0]!.status).toBe('applied');
  });

  // Ineffizienz-Korrektur (Fremdschlüsselprüfung gebündelt statt seriell,
  // siehe sync.foreignKeys.ts): die Prüfung stellt je Zielstore GENAU EINE
  // Existenzabfrage, unabhängig davon, wie viele — und wie oft dieselben —
  // Referenzen im Payload stecken. Zuvor war es eine eigene, nacheinander
  // laufende Abfrage je einzelnem Vorkommen.
  it('stellt für viele (teils wiederholte) exerciseId-Referenzen nur EINE Existenzabfrage je Store', async () => {
    const { service, gateway } = makeService();
    const ownExerciseIds = [
      'cccccccc-0000-0000-0000-00000000000a',
      'cccccccc-0000-0000-0000-00000000000b',
      'cccccccc-0000-0000-0000-00000000000c',
    ];
    for (const id of ownExerciseIds) {
      gateway.seed('exercises', {
        id, clubId: CLUB_A, name: 'Eigene Übung', category: 'kick', stroke: null,
        description: '', defaultDistance: null, tags: [], equipment: [], comments: [], updatedAt: new Date(), deletedAt: null,
      });
    }
    const lookupSpy = vi.spyOn(gateway, 'findExistingIdsInClub');

    const now = new Date().toISOString();
    // 30 Sätze, die reihum dieselben drei Übungen referenzieren.
    const sets = Array.from({ length: 30 }, (_, i) => ({
      kind: 'set' as const, id: `set-${i}`, description: '', distance: null, reps: 1,
      intensity: '', restSec: 0, exerciseId: ownExerciseIds[i % ownExerciseIds.length]!, comments: [],
    }));
    const payload = {
      id: '99999999-8888-8888-8888-88888888888a', clubId: CLUB_A, name: 'Vorlage', description: '', tags: [],
      sets, createdAt: now, updatedAt: now,
    };
    const results = await service.push(
      [{ id: 'evt-fk-batched-exercises', store: 'templates', entityId: payload.id, action: 'create', payload, clientUpdatedAt: now }],
      asTrainer(CLUB_A),
    );

    expect(results[0]!.status).toBe('applied');
    expect(lookupSpy).toHaveBeenCalledTimes(1);
    // Entdoppelt: die drei verschiedenen ids, nicht 30 Vorkommen.
    const [, requestedIds, requestedClubId] = lookupSpy.mock.calls[0]!;
    expect([...requestedIds].sort()).toEqual([...ownExerciseIds].sort());
    expect(requestedClubId).toBe(CLUB_A);
  });

  // Fail-closed trotz Bündelung: EINE ungültige Referenz unter vielen
  // gültigen weist das gesamte Event ab — die Entdopplung darf keine zu
  // prüfende id verschlucken.
  it('lehnt das Event ab, wenn unter vielen gültigen exerciseIds eine einzige fremde steckt', async () => {
    const { service, gateway } = makeService();
    const ownExerciseIds = ['cccccccc-0000-0000-0000-00000000001a', 'cccccccc-0000-0000-0000-00000000001b'];
    for (const id of ownExerciseIds) {
      gateway.seed('exercises', {
        id, clubId: CLUB_A, name: 'Eigene Übung', category: 'kick', stroke: null,
        description: '', defaultDistance: null, tags: [], equipment: [], comments: [], updatedAt: new Date(), deletedAt: null,
      });
    }
    const foreignExerciseId = 'cccccccc-0000-0000-0000-00000000001f';
    gateway.seed('exercises', {
      id: foreignExerciseId, clubId: CLUB_B, name: 'Fremde Übung', category: 'kick', stroke: null,
      description: '', defaultDistance: null, tags: [], equipment: [], comments: [], updatedAt: new Date(), deletedAt: null,
    });

    const now = new Date().toISOString();
    const allIds = [...ownExerciseIds, ...ownExerciseIds, foreignExerciseId, ...ownExerciseIds];
    const payload = {
      id: '99999999-8888-8888-8888-88888888888b', clubId: CLUB_A, name: 'Vorlage', description: '', tags: [],
      sets: allIds.map((exerciseId, i) => ({
        kind: 'set' as const, id: `set-${i}`, description: '', distance: null, reps: 1,
        intensity: '', restSec: 0, exerciseId, comments: [],
      })),
      createdAt: now, updatedAt: now,
    };
    const results = await service.push(
      [{ id: 'evt-fk-one-foreign-among-many', store: 'templates', entityId: payload.id, action: 'create', payload, clientUpdatedAt: now }],
      asTrainer(CLUB_A),
    );

    expect(results[0]!.status).toBe('error');
    expect(results[0]!.message).toContain('existiert nicht mehr');
    expect(await gateway.findById('templates', payload.id)).toBeNull();
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
    const { service, gateway } = makeService();
    // Fremdschlüssel-Eigentümerprüfung verlangt eine im eigenen Verein
    // existierende athleteId (siehe Test oben bei "results").
    const athlete = makeAthletePayload();
    gateway.seed('athletes', { ...athlete, birthdate: new Date(athlete.birthdate), joinDate: new Date(athlete.joinDate), updatedAt: new Date(athlete.updatedAt), createdAt: new Date(athlete.createdAt), deletedAt: null });
    const payload = makeActionItemPayload();
    const results = await service.push(
      [{ id: 'evt-trainer-write', store: 'actionItems', entityId: payload.id, action: 'create', payload, clientUpdatedAt: payload.updatedAt }],
      asTrainer(CLUB_A),
    );
    expect(results[0]!.status).toBe('applied');
  });

  it.each([
    ['athletes', () => makeAthletePayload({ id: '55555555-5555-5555-5555-555555555556' })],
    ['groups', () => makeGroupPayload({ id: '99999999-1111-1111-1111-111111111111' })],
    ['exercises', () => makeExercisePayload({ id: '99999999-2222-2222-2222-222222222222' })],
    ['templates', () => ({
      id: '99999999-3333-3333-3333-333333333333', clubId: CLUB_A, name: 'Vorlage', description: '', tags: [], sets: [],
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    })],
    ['competitions', () => ({
      id: '99999999-4444-4444-4444-444444444444', clubId: CLUB_A, name: 'Vereinsmeisterschaft', date: new Date().toISOString(),
      location: '', course: 'LCM', notes: '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    })],
  ] as const)(
    'lehnt einen PUSH (create) auf "%s" durch die Rolle "athlete" ab — nur in der UI versteckt, nicht serverseitig durchgesetzt war die eigentliche Lücke',
    async (store, makePayload) => {
      const { service } = makeService();
      const payload = makePayload();
      const results = await service.push(
        [{ id: `evt-athlete-write-${store}`, store, entityId: payload.id, action: 'create', payload, clientUpdatedAt: payload.updatedAt }],
        asAthlete(CLUB_A, '55555555-5555-5555-5555-555555555555'),
      );
      expect(results[0]!.status).toBe('error');
    },
  );

  it('lehnt einen PUSH (create) auf "entries" durch die Rolle "athlete" ab', async () => {
    const { service, gateway } = makeService();
    const athlete = makeAthletePayload();
    gateway.seed('athletes', { ...athlete, birthdate: new Date(athlete.birthdate), joinDate: new Date(athlete.joinDate), updatedAt: new Date(athlete.updatedAt), createdAt: new Date(athlete.createdAt), deletedAt: null });
    const now = new Date().toISOString();
    const payload = {
      id: '99999999-5555-5555-5555-555555555555', clubId: CLUB_A, competitionId: '99999999-4444-4444-4444-444444444444',
      athleteId: athlete.id, event: '50 Freistil', eventNumber: '', heat: null, lane: null, seedTime: null,
      createdAt: now, updatedAt: now,
    };
    const results = await service.push(
      [{ id: 'evt-athlete-write-entries', store: 'entries', entityId: payload.id, action: 'create', payload, clientUpdatedAt: now }],
      asAthlete(CLUB_A, athlete.id),
    );
    expect(results[0]!.status).toBe('error');
  });

  it('trainer/admin sind von der erweiterten Schreibsperre NICHT betroffen — dürfen "groups"/"exercises"/"templates"/"competitions" weiterhin verändern (anders als "athletes", siehe adminVerwaltet-Tests oben)', async () => {
    const { service } = makeService();
    const payload = makeGroupPayload({ id: '99999999-6666-6666-6666-666666666666' });
    const results = await service.push(
      [{ id: 'evt-trainer-write-group', store: 'groups', entityId: payload.id, action: 'create', payload, clientUpdatedAt: payload.updatedAt }],
      asTrainer(CLUB_A),
    );
    expect(results[0]!.status).toBe('applied');
  });

  it.each(['results', 'plans'] as const)(
    'STORE_PERMISSIONS "geteilt": die Rolle "athlete" darf "%s" weiterhin lesen UND schreiben (times.js/plans.js zeigen/bearbeiten das team-weit)',
    async (store) => {
      const { service, gateway } = makeService();
      const athlete = makeAthletePayload();
      gateway.seed('athletes', { ...athlete, birthdate: new Date(athlete.birthdate), joinDate: new Date(athlete.joinDate), updatedAt: new Date(athlete.updatedAt), createdAt: new Date(athlete.createdAt), deletedAt: null });
      const now = new Date().toISOString();
      const payload =
        store === 'results'
          ? { id: '99999999-7777-7777-7777-777777777771', clubId: CLUB_A, athleteId: athlete.id, event: '100 Freistil', time: 61.2, date: now, course: 'LCM', competitionId: null, place: null, isPB: false, createdAt: now, updatedAt: now }
          : { id: '99999999-7777-7777-7777-777777777772', clubId: CLUB_A, name: 'Eigener Plan', weekStart: now, groupId: null, status: 'aktiv', days: [], comments: [], createdAt: now, updatedAt: now };
      const results = await service.push(
        [{ id: `evt-athlete-shared-write-${store}`, store, entityId: payload.id, action: 'create', payload, clientUpdatedAt: now }],
        asAthlete(CLUB_A, athlete.id),
      );
      expect(results[0]!.status).toBe('applied');
    },
  );

  describe('syncService.push — Zeilenscoping für "results" bei Rolle "athlete" (Sicherheitsreview 2026-08, Befund N1)', () => {
    const OWN_ATHLETE_ID = '55555555-5555-5555-5555-555555555555';
    const FOREIGN_ATHLETE_ID = '66666666-6666-6666-6666-666666666661';

    function seedBothAthletes(gateway: InMemorySyncGateway) {
      const own = makeAthletePayload({ id: OWN_ATHLETE_ID });
      const foreign = makeAthletePayload({ id: FOREIGN_ATHLETE_ID, firstName: 'Lea', lastName: 'Neumann' });
      for (const a of [own, foreign]) {
        gateway.seed('athletes', { ...a, birthdate: new Date(a.birthdate), joinDate: new Date(a.joinDate), updatedAt: new Date(a.updatedAt), createdAt: new Date(a.createdAt), deletedAt: null });
      }
    }

    it('lehnt CREATE eines "results"-Events mit fremder athleteId im Payload ab', async () => {
      const { service, gateway } = makeService();
      seedBothAthletes(gateway);
      const payload = makeResultPayload({ athleteId: FOREIGN_ATHLETE_ID });
      const results = await service.push(
        [{ id: 'evt-n1-create-foreign', store: 'results', entityId: payload.id, action: 'create', payload, clientUpdatedAt: payload.updatedAt }],
        asAthlete(CLUB_A, OWN_ATHLETE_ID),
      );
      expect(results[0]!.status).toBe('error');
      expect(results[0]!.message).toContain('eigene Ergebnisse');
      expect(await gateway.findById('results', payload.id)).toBeNull();
    });

    it('lehnt UPDATE und DELETE eines fremden "results"-Datensatzes ab, selbst wenn das Payload die eigene athleteId trägt', async () => {
      const { service, gateway } = makeService();
      seedBothAthletes(gateway);
      const foreignResult = makeResultPayload({ athleteId: FOREIGN_ATHLETE_ID });
      gateway.seed('results', { ...foreignResult, updatedAt: new Date(foreignResult.updatedAt), date: new Date(foreignResult.date), createdAt: new Date(foreignResult.createdAt), deletedAt: null });

      // Versuch, den fremden Datensatz zu "übernehmen" — eigene athleteId
      // im Payload, aber die bestehende Zeile (dieselbe id) gehört
      // jemand anderem.
      const takeoverPayload = { ...foreignResult, athleteId: OWN_ATHLETE_ID, updatedAt: new Date(Date.now() + 1000).toISOString() };
      const updateResults = await service.push(
        [{ id: 'evt-n1-update-foreign', store: 'results', entityId: foreignResult.id, action: 'update', payload: takeoverPayload, clientUpdatedAt: takeoverPayload.updatedAt }],
        asAthlete(CLUB_A, OWN_ATHLETE_ID),
      );
      expect(updateResults[0]!.status).toBe('error');

      const deleteResults = await service.push(
        [{ id: 'evt-n1-delete-foreign', store: 'results', entityId: foreignResult.id, action: 'delete', payload: null, clientUpdatedAt: new Date().toISOString() }],
        asAthlete(CLUB_A, OWN_ATHLETE_ID),
      );
      expect(deleteResults[0]!.status).toBe('error');

      const stillThere = await gateway.findById('results', foreignResult.id);
      expect(stillThere?.athleteId).toBe(FOREIGN_ATHLETE_ID);
    });

    it('erlaubt weiterhin CREATE/UPDATE/DELETE der EIGENEN Ergebnisse', async () => {
      const { service, gateway } = makeService();
      seedBothAthletes(gateway);
      const ownResult = makeResultPayload({ athleteId: OWN_ATHLETE_ID });
      gateway.seed('results', { ...ownResult, updatedAt: new Date(ownResult.updatedAt), date: new Date(ownResult.date), createdAt: new Date(ownResult.createdAt), deletedAt: null });

      const updatePayload = { ...ownResult, time: 59.9, updatedAt: new Date(Date.now() + 1000).toISOString() };
      const updateResults = await service.push(
        [{ id: 'evt-n1-update-own', store: 'results', entityId: ownResult.id, action: 'update', payload: updatePayload, clientUpdatedAt: updatePayload.updatedAt }],
        asAthlete(CLUB_A, OWN_ATHLETE_ID),
      );
      expect(updateResults[0]!.status).toBe('applied');

      const deleteResults = await service.push(
        [{ id: 'evt-n1-delete-own', store: 'results', entityId: ownResult.id, action: 'delete', payload: null, clientUpdatedAt: new Date().toISOString() }],
        asAthlete(CLUB_A, OWN_ATHLETE_ID),
      );
      expect(deleteResults[0]!.status).toBe('applied');
    });

    it('trainer/admin bleiben von der Zeilen-Verengung unberührt — dürfen weiterhin fremde Ergebnisse schreiben', async () => {
      const { service, gateway } = makeService();
      seedBothAthletes(gateway);
      const payload = makeResultPayload({ athleteId: FOREIGN_ATHLETE_ID, id: '44444444-4444-4444-4444-444444444445' });
      const results = await service.push(
        [{ id: 'evt-n1-trainer-foreign', store: 'results', entityId: payload.id, action: 'create', payload, clientUpdatedAt: payload.updatedAt }],
        asTrainer(CLUB_A),
      );
      expect(results[0]!.status).toBe('applied');
    });
  });

  it('PUSH: ein Event mit einem laut STORE_PERMISSIONS unbekannten Store (z. B. "users") wird sauber als "error" gemeldet, statt die Anfrage abstürzen zu lassen', async () => {
    const { service } = makeService();
    const now = new Date().toISOString();
    const results = await service.push(
      [{ id: 'evt-unknown-store', store: 'users', entityId: 'irgendeine-id', action: 'create', payload: { foo: 'bar' }, clientUpdatedAt: now }],
      asTrainer(CLUB_A),
    );
    expect(results[0]!.status).toBe('error');
    expect(results[0]!.message).toContain('Unbekannter Store');
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

  // Sicherheitsregression (Sicherheitsreview 2026-08, Befund M1):
  // "trainerNote" ist ein freies, coach-internes Notizfeld (siehe
  // apps/web/js/modules/sessions.js) und wurde bislang unverändert an
  // Rolle "athlete" ausgeliefert, obwohl kein athletenseitiges Modul es
  // je anzeigt.
  it('PULL für Rolle "athlete": "trainerNote" wird redigiert, auch wenn die Person selbst an der Einheit teilnahm', async () => {
    const { service, gateway } = makeService();
    const payload = makeSessionPayload({ trainerNote: 'GEHEIM: Elterngespräch nötig' });
    gateway.seed('sessions', { ...payload, updatedAt: new Date(payload.updatedAt), createdAt: new Date(payload.createdAt), deletedAt: null });

    const result = await service.pull({}, asAthlete(CLUB_A, '55555555-5555-5555-5555-555555555555'));
    expect(result.changes).toHaveLength(1);
    expect((result.changes[0]!.payload as Record<string, unknown>).trainerNote).toBe('');
    expect(JSON.stringify(result.changes[0])).not.toContain('Elterngespräch');
  });

  it('trainer/admin sehen "trainerNote" weiterhin unredigiert', async () => {
    const { service, gateway } = makeService();
    const payload = makeSessionPayload({ trainerNote: 'Gute Energie heute' });
    gateway.seed('sessions', { ...payload, updatedAt: new Date(payload.updatedAt), createdAt: new Date(payload.createdAt), deletedAt: null });

    const result = await service.pull({}, asTrainer(CLUB_A));
    expect((result.changes[0]!.payload as Record<string, unknown>).trainerNote).toBe('Gute Energie heute');
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

describe('syncService — "Athlete.notes"-Redaktion für Rolle "athlete" (Sicherheitsregression, Patch #7)', () => {
  it('PULL: "notes" wird für Rolle "athlete" redigiert — auch am eigenen Datensatz', async () => {
    const { service, gateway } = makeService();
    const own = makeAthletePayload({ id: '55555555-5555-5555-5555-555555555555', notes: 'Sehr sensible Coaching-Notiz zu mir selbst' });
    const foreign = makeAthletePayload({ id: '66666666-6666-6666-6666-666666666661', notes: 'Sensible Notiz über eine andere Person' });
    gateway.seed('athletes', { ...own, birthdate: new Date(own.birthdate), joinDate: new Date(own.joinDate), updatedAt: new Date(own.updatedAt), createdAt: new Date(own.createdAt), deletedAt: null });
    gateway.seed('athletes', { ...foreign, birthdate: new Date(foreign.birthdate), joinDate: new Date(foreign.joinDate), updatedAt: new Date(foreign.updatedAt), createdAt: new Date(foreign.createdAt), deletedAt: null });

    const result = await service.pull({}, asAthlete(CLUB_A, '55555555-5555-5555-5555-555555555555'));
    expect(result.changes).toHaveLength(2);
    // Eigener Datensatz: "notes" explizit redigiert (leerer String, Feld
    // bleibt vorhanden), der Rest (Name, Gruppe, …) bleibt sichtbar.
    const ownChange = result.changes.find((c) => c.entityId === own.id);
    expect((ownChange!.payload as Record<string, unknown>).notes).toBe('');
    expect((ownChange!.payload as Record<string, unknown>).firstName).toBe('Mara');
    // Fremder Datensatz: "notes" ist gar nicht erst Teil der Allowlist
    // (siehe TEAM_VISIBLE_ATHLETE_FIELDS in sync.athleteScope.ts) — das
    // Feld fehlt komplett, statt nur geleert zu sein.
    const foreignChange = result.changes.find((c) => c.entityId === foreign.id);
    expect(foreignChange!.payload).not.toHaveProperty('notes');
    expect(JSON.stringify(result.changes)).not.toContain('Sensible');
  });

  // Sicherheitsregression (Sicherheitsreview 2026-08, Befund M2):
  // "birthdate"/"gender"/"joinDate" gingen bislang für JEDEN Athletendatensatz
  // unverändert heraus — auch für fremde Personen, obwohl kein team-weites
  // Modul diese Felder je liest (nur apps/web/js/modules/athletes.js,
  // roles: ['trainer','admin']).
  it('PULL: "birthdate"/"gender"/"joinDate" werden für FREMDE Athletendatensätze nicht mehr ausgeliefert', async () => {
    const { service, gateway } = makeService();
    const foreign = makeAthletePayload({ id: '66666666-6666-6666-6666-666666666661', birthdate: '2011-05-20T00:00:00.000Z', gender: 'm', joinDate: '2021-01-01T00:00:00.000Z' });
    gateway.seed('athletes', { ...foreign, birthdate: new Date(foreign.birthdate as string), joinDate: new Date(foreign.joinDate as string), updatedAt: new Date(foreign.updatedAt as string), createdAt: new Date(foreign.createdAt as string), deletedAt: null });

    const result = await service.pull({}, asAthlete(CLUB_A, '55555555-5555-5555-5555-555555555555'));
    expect(result.changes).toHaveLength(1);
    const payload = result.changes[0]!.payload as Record<string, unknown>;
    expect(payload).not.toHaveProperty('birthdate');
    expect(payload).not.toHaveProperty('gender');
    expect(payload).not.toHaveProperty('joinDate');
    // Die team-weit tatsächlich genutzten Felder bleiben erhalten.
    expect(payload.id).toBe(foreign.id);
    expect(payload.firstName).toBe('Mara');
    expect(payload.groupId).toBeNull();
    expect(payload.active).toBe(true);
  });

  // Regressionsschutz: das EIGENE, verknüpfte Athletenprofil darf NICHT
  // auf die Allowlist reduziert werden — apps/web/js/modules/profile.js'
  // collectMyData() nutzt genau diesen lokal gesynchten Datensatz als
  // Offline-Ausweichlösung für den DSGVO-Auskunftsexport (Art. 15) der
  // eigenen Person und braucht dafür die eigenen Personendaten vollständig.
  it('PULL: "birthdate"/"gender"/"joinDate" bleiben am EIGENEN Athletendatensatz erhalten', async () => {
    const { service, gateway } = makeService();
    const own = makeAthletePayload({ id: '55555555-5555-5555-5555-555555555555', birthdate: '2009-03-14T00:00:00.000Z', gender: 'w', joinDate: '2019-08-01T00:00:00.000Z' });
    gateway.seed('athletes', { ...own, birthdate: new Date(own.birthdate as string), joinDate: new Date(own.joinDate as string), updatedAt: new Date(own.updatedAt as string), createdAt: new Date(own.createdAt as string), deletedAt: null });

    const result = await service.pull({}, asAthlete(CLUB_A, own.id as string));
    const payload = result.changes[0]!.payload as Record<string, unknown>;
    // InMemorySyncGateway liefert Datumsfelder als native Date-Objekte
    // zurück (erst die HTTP-Schicht/Fastify serialisiert sie zu ISO-
    // Strings, siehe sync.gateway.ts) — hier zählt nur, dass die Werte
    // überhaupt noch vorhanden sind (nicht von der Allowlist entfernt).
    expect(new Date(payload.birthdate as string | Date).toISOString()).toBe('2009-03-14T00:00:00.000Z');
    expect(payload.gender).toBe('w');
    expect(new Date(payload.joinDate as string | Date).toISOString()).toBe('2019-08-01T00:00:00.000Z');
  });

  it('trainer/admin sehen "notes" weiterhin unredigiert', async () => {
    const { service, gateway } = makeService();
    const athlete = makeAthletePayload({ notes: 'Coaching-Notiz' });
    gateway.seed('athletes', { ...athlete, birthdate: new Date(athlete.birthdate), joinDate: new Date(athlete.joinDate), updatedAt: new Date(athlete.updatedAt), createdAt: new Date(athlete.createdAt), deletedAt: null });

    const result = await service.pull({}, asTrainer(CLUB_A));
    expect((result.changes[0]!.payload as Record<string, unknown>).notes).toBe('Coaching-Notiz');
  });

  it('PUSH: die Rolle "athlete" darf den Store "athletes" grundsätzlich nicht mehr verändern — auch nicht das eigene, verknüpfte Profil', async () => {
    // Laut STORE_PERMISSIONS (siehe sync.service.ts) ist "athletes" für
    // Rolle "athlete" komplett gesperrt — konsistent mit
    // js/modules/profile.js, das für das eigene
    // Konto ausdrücklich NUR Name/E-Mail/Sprache bearbeitbar macht;
    // Athleten-Stammdaten (inkl. "notes") bleiben admin-managed.
    const { service, gateway } = makeService();
    const original = makeAthletePayload({ notes: 'Original-Notiz von Admin' });
    gateway.seed('athletes', { ...original, birthdate: new Date(original.birthdate), joinDate: new Date(original.joinDate), updatedAt: new Date(original.updatedAt), createdAt: new Date(original.createdAt), deletedAt: null });

    const maliciousUpdate = makeAthletePayload({
      notes: 'Von Athlet:in eingeschleuste Notiz',
      groupId: null,
      updatedAt: new Date(Date.now() + 60_000).toISOString(),
    });
    const results = await service.push(
      [{ id: 'evt-athlete-notes', store: 'athletes', entityId: original.id, action: 'update', payload: maliciousUpdate, clientUpdatedAt: maliciousUpdate.updatedAt }],
      asAthlete(CLUB_A, original.id),
    );
    expect(results[0]!.status).toBe('error');

    const stored = await gateway.findById('athletes', original.id);
    expect((stored as Record<string, unknown>).notes).toBe('Original-Notiz von Admin');
  });

  it('PUSH: die Rolle "trainer" darf den Store "athletes" ebenfalls NICHT mehr verändern (Access-Konsistenz-Korrektur — vorher inkonsistent mit js/modules/athletes.js\' isAdminOrSuperAdmin()-Gate)', async () => {
    const { service, gateway } = makeService();
    const original = makeAthletePayload({ notes: 'Alte Notiz' });
    gateway.seed('athletes', { ...original, birthdate: new Date(original.birthdate), joinDate: new Date(original.joinDate), updatedAt: new Date(original.updatedAt), createdAt: new Date(original.createdAt), deletedAt: null });

    const update = makeAthletePayload({ notes: 'Von Trainer:in eingeschleuste Notiz', updatedAt: new Date(Date.now() + 60_000).toISOString() });
    const results = await service.push(
      [{ id: 'evt-trainer-notes', store: 'athletes', entityId: original.id, action: 'update', payload: update, clientUpdatedAt: update.updatedAt }],
      asTrainer(CLUB_A),
    );
    expect(results[0]!.status).toBe('error');
    const stored = await gateway.findById('athletes', original.id);
    expect((stored as Record<string, unknown>).notes).toBe('Alte Notiz');
  });

  it('admin: "notes" lässt sich weiterhin normal ändern', async () => {
    const { service, gateway } = makeService();
    const original = makeAthletePayload({ notes: 'Alte Notiz' });
    gateway.seed('athletes', { ...original, birthdate: new Date(original.birthdate), joinDate: new Date(original.joinDate), updatedAt: new Date(original.updatedAt), createdAt: new Date(original.createdAt), deletedAt: null });

    const update = makeAthletePayload({ notes: 'Neue Notiz von Admin', updatedAt: new Date(Date.now() + 60_000).toISOString() });
    const results = await service.push(
      [{ id: 'evt-admin-notes', store: 'athletes', entityId: original.id, action: 'update', payload: update, clientUpdatedAt: update.updatedAt }],
      asAdmin(CLUB_A),
    );
    expect(results[0]!.status).toBe('applied');
    const stored = await gateway.findById('athletes', original.id);
    expect((stored as Record<string, unknown>).notes).toBe('Neue Notiz von Admin');
  });
});

describe('syncService.push — Kommentar-Autor:innen-Prüfung (Sicherheitsreview 2026-08-27, Befund M2)', () => {
  // Vormals war Comment.authorName eine reine Client-Angabe ohne jede
  // serverseitige Verifikation — jedes Vereinsmitglied konnte per push()
  // einen Kommentar unter fremdem Namen hinterlassen. Der Fix führt
  // Comment.authorId (User-ID) ein und prüft sie in sync.commentAuthorship.ts.
  // Diese Suite deckt alle drei betroffenen Stores ab (exercises/plans/
  // templates) sowie beide Regeln: neue Kommentare müssen der eigenen
  // Identität zugeordnet sein, bestehende dürfen nachträglich nicht
  // umgeschrieben werden.
  function makePlanPayload(overrides: Partial<Record<string, unknown>> = {}) {
    const now = new Date().toISOString();
    return {
      id: '99999999-6666-6666-6666-666666666661',
      clubId: CLUB_A,
      name: 'Trainingswoche',
      weekStart: now,
      groupId: null,
      status: 'aktiv' as const,
      days: [],
      comments: [],
      createdAt: now,
      updatedAt: now,
      ...overrides,
    };
  }

  function makeTemplatePayload(overrides: Partial<Record<string, unknown>> = {}) {
    const now = new Date().toISOString();
    return {
      id: '99999999-6666-6666-6666-666666666662',
      clubId: CLUB_A,
      name: 'Standard-Vorlage',
      description: '',
      tags: [],
      sets: [],
      createdAt: now,
      updatedAt: now,
      ...overrides,
    };
  }

  it('akzeptiert einen NEUEN Kommentar an einer Übung, dessen authorId der eigenen Identität entspricht', async () => {
    const { service, gateway } = makeService();
    const payload = makeExercisePayload({
      comments: [{ id: 'c1', authorId: TRAINER_USER_ID, authorName: 'Jonas Beck', text: 'Auf Handstellung achten.', createdAt: new Date().toISOString() }],
    });
    const results = await service.push(
      [{ id: 'evt-m2-exercise-own', store: 'exercises', entityId: payload.id, action: 'create', payload, clientUpdatedAt: payload.updatedAt }],
      asTrainer(CLUB_A),
    );
    expect(results[0]!.status).toBe('applied');
    const stored = await gateway.findById('exercises', payload.id);
    expect((stored as Record<string, unknown>).comments).toEqual(payload.comments);
  });

  it('lehnt einen NEUEN Kommentar an einer Übung ab, dessen authorId auf eine fremde Identität zeigt (Identitätsvortäuschung)', async () => {
    const { service, gateway } = makeService();
    const payload = makeExercisePayload({
      comments: [{ id: 'c1', authorId: ADMIN_USER_ID, authorName: 'Vorgetäuschter Admin-Name', text: 'X', createdAt: new Date().toISOString() }],
    });
    const results = await service.push(
      [{ id: 'evt-m2-exercise-spoof', store: 'exercises', entityId: payload.id, action: 'create', payload, clientUpdatedAt: payload.updatedAt }],
      asTrainer(CLUB_A),
    );
    expect(results[0]!.status).toBe('error');
    expect(await gateway.findById('exercises', payload.id)).toBeNull();
  });

  it('lehnt es ab, einen bestehenden Kommentar einer DRITTEN Person zuzuschreiben', async () => {
    const { service, gateway } = makeService();
    const commentCreatedAt = new Date().toISOString();
    const original = makeExercisePayload({
      comments: [{ id: 'c1', authorId: TRAINER_USER_ID, authorName: 'Jonas Beck', text: 'Ursprünglicher Text', createdAt: commentCreatedAt }],
    });
    const seedResult = await service.push(
      [{ id: 'evt-m2-seed', store: 'exercises', entityId: original.id, action: 'create', payload: original, clientUpdatedAt: original.updatedAt }],
      asTrainer(CLUB_A),
    );
    expect(seedResult[0]!.status).toBe('applied');

    // "admin" schreibt den bestehenden Kommentar einer dritten Person zu
    // (weder sich selbst noch der ursprünglichen Autor:in) — genau die
    // Richtung, die M2 verhindern soll: jemandem etwas in den Mund legen.
    const tampered = {
      ...original,
      comments: [{ id: 'c1', authorId: ATHLETE_USER_ID, authorName: 'Ben Athlet', text: 'Ursprünglicher Text', createdAt: commentCreatedAt }],
      updatedAt: new Date(Date.now() + 60_000).toISOString(),
    };
    const results = await service.push(
      [{ id: 'evt-m2-tamper', store: 'exercises', entityId: original.id, action: 'update', payload: tampered, clientUpdatedAt: tampered.updatedAt }],
      asAdmin(CLUB_A),
    );
    expect(results[0]!.status).toBe('error');
    const stored = await gateway.findById('exercises', original.id);
    expect(((stored as Record<string, unknown>).comments as Array<{ authorId: string }>)[0]!.authorId).toBe(TRAINER_USER_ID);
  });

  // Bewusst ERLAUBT und hier als Erwartung festgehalten, damit die Grenze
  // der Zusicherung dokumentiert bleibt: einen fremden Kommentar auf sich
  // SELBST umzuschreiben ist datenseitig nicht von "fremden Kommentar
  // gelöscht und einen eigenen mit demselben Text geschrieben" zu
  // unterscheiden — und Letzteres steht in einem geteilten Datensatz
  // (plans/exercises/templates sind Team-Dokumente) ohnehin jeder Person
  // offen. Die Zusicherung von M2 lautet deshalb präzise: Zuschreibung an
  // eine ANDERE Person ist unmöglich; die Übernahme fremder Inhalte auf
  // den eigenen Namen ist es nicht.
  it('erlaubt es, einen fremden Kommentar auf die EIGENE Identität umzuschreiben (entspricht Löschen + eigenem Neuanlegen)', async () => {
    const { service } = makeService();
    const commentCreatedAt = new Date().toISOString();
    const original = makeExercisePayload({
      comments: [{ id: 'c1', authorId: TRAINER_USER_ID, authorName: 'Jonas Beck', text: 'Ursprünglicher Text', createdAt: commentCreatedAt }],
    });
    await service.push(
      [{ id: 'evt-m2-self-seed', store: 'exercises', entityId: original.id, action: 'create', payload: original, clientUpdatedAt: original.updatedAt }],
      asTrainer(CLUB_A),
    );

    const claimed = {
      ...original,
      comments: [{ id: 'c1', authorId: ADMIN_USER_ID, authorName: 'Die Admin', text: 'Ursprünglicher Text', createdAt: commentCreatedAt }],
      updatedAt: new Date(Date.now() + 60_000).toISOString(),
    };
    const results = await service.push(
      [{ id: 'evt-m2-self-claim', store: 'exercises', entityId: original.id, action: 'update', payload: claimed, clientUpdatedAt: claimed.updatedAt }],
      asAdmin(CLUB_A),
    );
    expect(results[0]!.status).toBe('applied');
  });

  it('erlaubt es einer anderen Person weiterhin, dem selben Datensatz einen EIGENEN neuen Kommentar hinzuzufügen, ohne den bestehenden fremden Kommentar zu berühren', async () => {
    const { service, gateway } = makeService();
    const original = makeExercisePayload({
      comments: [{ id: 'c1', authorId: TRAINER_USER_ID, authorName: 'Jonas Beck', text: 'Erster Kommentar', createdAt: new Date().toISOString() }],
    });
    await service.push(
      [{ id: 'evt-m2-seed-2', store: 'exercises', entityId: original.id, action: 'create', payload: original, clientUpdatedAt: original.updatedAt }],
      asTrainer(CLUB_A),
    );

    const updated = {
      ...original,
      comments: [
        original.comments[0],
        { id: 'c2', authorId: ADMIN_USER_ID, authorName: 'Admin-Kontoinhaber:in', text: 'Zweiter Kommentar', createdAt: new Date().toISOString() },
      ],
      updatedAt: new Date(Date.now() + 60_000).toISOString(),
    };
    const results = await service.push(
      [{ id: 'evt-m2-add-second', store: 'exercises', entityId: original.id, action: 'update', payload: updated, clientUpdatedAt: updated.updatedAt }],
      asAdmin(CLUB_A),
    );
    expect(results[0]!.status).toBe('applied');
    const stored = await gateway.findById('exercises', original.id);
    const comments = (stored as Record<string, unknown>).comments as Array<{ id: string; authorId: string }>;
    expect(comments.find((c) => c.id === 'c1')!.authorId).toBe(TRAINER_USER_ID);
    expect(comments.find((c) => c.id === 'c2')!.authorId).toBe(ADMIN_USER_ID);
  });

  it('prüft Plan-weite Kommentare UND verschachtelte Set-Kommentare (days[].sets[].comments, auch innerhalb eines Wiederholungsblocks)', async () => {
    const { service } = makeService();
    const payload = makePlanPayload({
      comments: [{ id: 'plan-c1', authorId: ADMIN_USER_ID, authorName: 'Fremd', text: 'Fremd zugeordnet', createdAt: new Date().toISOString() }],
    });
    const results = await service.push(
      [{ id: 'evt-m2-plan-comment-spoof', store: 'plans', entityId: payload.id, action: 'create', payload, clientUpdatedAt: payload.updatedAt }],
      asTrainer(CLUB_A),
    );
    expect(results[0]!.status).toBe('error');

    const nestedPayload = makePlanPayload({
      id: '99999999-6666-6666-6666-666666666663',
      days: [
        {
          date: new Date().toISOString(),
          sets: [
            {
              kind: 'block',
              id: 'b1',
              label: '',
              repeatCount: 2,
              sets: [
                {
                  kind: 'set',
                  id: 's1',
                  description: '',
                  distance: 100,
                  reps: 4,
                  intensity: 'ga1',
                  restSec: 20,
                  comments: [{ id: 'set-c1', authorId: ADMIN_USER_ID, authorName: 'Fremd', text: 'Fremd zugeordnet (verschachtelt)', createdAt: new Date().toISOString() }],
                },
              ],
            },
          ],
        },
      ],
    });
    const nestedResults = await service.push(
      [{ id: 'evt-m2-plan-nested-spoof', store: 'plans', entityId: nestedPayload.id, action: 'create', payload: nestedPayload, clientUpdatedAt: nestedPayload.updatedAt }],
      asTrainer(CLUB_A),
    );
    expect(nestedResults[0]!.status).toBe('error');
  });

  it('prüft Kommentare, die innerhalb eines Abschnitts (section) verschachtelt sind', async () => {
    const { service } = makeService();
    const payload = makePlanPayload({
      id: '99999999-6666-6666-6666-666666666665',
      days: [
        {
          date: new Date().toISOString(),
          sets: [
            {
              kind: 'section',
              id: 'sec1',
              heading: 'Hauptteil',
              entries: [
                {
                  kind: 'set',
                  id: 's1',
                  description: '',
                  distance: 100,
                  reps: 4,
                  intensity: 'ga1',
                  restSec: 20,
                  comments: [{ id: 'set-c1', authorId: ADMIN_USER_ID, authorName: 'Fremd', text: 'Fremd zugeordnet (Abschnitt)', createdAt: new Date().toISOString() }],
                },
              ],
            },
          ],
        },
      ],
    });
    const results = await service.push(
      [{ id: 'evt-m2-plan-section-spoof', store: 'plans', entityId: payload.id, action: 'create', payload, clientUpdatedAt: payload.updatedAt }],
      asTrainer(CLUB_A),
    );
    expect(results[0]!.status).toBe('error');
  });

  it('akzeptiert Kommentare in Template.sets, wenn die authorId der eigenen Identität entspricht', async () => {
    const { service, gateway } = makeService();
    const payload = makeTemplatePayload({
      sets: [{ kind: 'set', id: 's1', description: '', distance: 200, reps: 1, intensity: 'ga1', restSec: 0, comments: [{ id: 'c1', authorId: TRAINER_USER_ID, authorName: 'Jonas Beck', text: 'Vorlagen-Hinweis', createdAt: new Date().toISOString() }] }],
    });
    const results = await service.push(
      [{ id: 'evt-m2-template-own', store: 'templates', entityId: payload.id, action: 'create', payload, clientUpdatedAt: payload.updatedAt }],
      asTrainer(CLUB_A),
    );
    expect(results[0]!.status).toBe('applied');
    const stored = await gateway.findById('templates', payload.id);
    expect((stored as Record<string, unknown>).sets).toEqual(payload.sets);
  });

  it('lehnt einen fremd zugeordneten neuen Kommentar in Template.sets ab', async () => {
    const { service, gateway } = makeService();
    const payload = makeTemplatePayload({
      id: '99999999-6666-6666-6666-666666666664',
      sets: [{ kind: 'set', id: 's1', description: '', distance: 200, reps: 1, intensity: 'ga1', restSec: 0, comments: [{ id: 'c1', authorId: ADMIN_USER_ID, authorName: 'Fremd', text: 'X', createdAt: new Date().toISOString() }] }],
    });
    const results = await service.push(
      [{ id: 'evt-m2-template-spoof', store: 'templates', entityId: payload.id, action: 'create', payload, clientUpdatedAt: payload.updatedAt }],
      asTrainer(CLUB_A),
    );
    expect(results[0]!.status).toBe('error');
    expect(await gateway.findById('templates', payload.id)).toBeNull();
  });

  // ----------------------------------------------------------------
  // Nachreview zu M2: Die erste Fassung dieser Prüfung schlug die
  // authorId eines bestehenden Kommentars über dessen `id` nach. Weil
  // CommentSchema.id ein frei wählbarer, NICHT eindeutiger Client-String
  // ist (bewusst kein UUID, siehe entities.ts), ließ sich das auf drei
  // Wegen umgehen. Alle drei sind hier als Regressionstests festgehalten;
  // sie schlugen gegen die id-basierte Fassung fehl.
  // ----------------------------------------------------------------
  it('lehnt einen zweiten Kommentar mit der id eines bestehenden fremden Kommentars ab (frei erfundener Text unter fremdem Namen)', async () => {
    const { service, gateway } = makeService();
    const createdAt = new Date().toISOString();
    const original = makeExercisePayload({
      comments: [{ id: 'c1', authorId: TRAINER_USER_ID, authorName: 'Jonas Beck', text: 'Gut gemacht', createdAt }],
    });
    await service.push(
      [{ id: 'evt-m2-dup-seed', store: 'exercises', entityId: original.id, action: 'create', payload: original, clientUpdatedAt: original.updatedAt }],
      asTrainer(CLUB_A),
    );

    const forged = {
      ...original,
      comments: [
        { id: 'c1', authorId: TRAINER_USER_ID, authorName: 'Jonas Beck', text: 'Gut gemacht', createdAt },
        { id: 'c1', authorId: TRAINER_USER_ID, authorName: 'Jonas Beck', text: 'FREI ERFUNDEN', createdAt },
      ],
      updatedAt: new Date(Date.now() + 60_000).toISOString(),
    };
    const results = await service.push(
      [{ id: 'evt-m2-dup', store: 'exercises', entityId: original.id, action: 'update', payload: forged, clientUpdatedAt: forged.updatedAt }],
      asAdmin(CLUB_A),
    );
    expect(results[0]!.status).toBe('error');
    const stored = await gateway.findById('exercises', original.id);
    expect((stored as Record<string, unknown>).comments).toHaveLength(1);
  });

  it('lehnt die Wiederverwendung einer bestehenden Kommentar-id an einer ANDEREN Stelle des Datensatzes ab', async () => {
    const { service } = makeService();
    const createdAt = new Date().toISOString();
    const trainerComment = { id: 'c1', authorId: TRAINER_USER_ID, authorName: 'Jonas Beck', text: 'Guter Wochenaufbau', createdAt };
    const original = makePlanPayload({ comments: [trainerComment] });
    await service.push(
      [{ id: 'evt-m2-move-seed', store: 'plans', entityId: original.id, action: 'create', payload: original, clientUpdatedAt: original.updatedAt }],
      asTrainer(CLUB_A),
    );

    // Plan-Kommentar bleibt unangetastet; dieselbe id taucht zusätzlich
    // als SATZ-Kommentar mit erfundenem Text auf.
    const forged = {
      ...original,
      comments: [trainerComment],
      days: [{
        date: createdAt,
        sets: [{
          kind: 'set', id: 's1', description: '', distance: 100, reps: 4, intensity: 'ga1', restSec: 20,
          comments: [{ id: 'c1', authorId: TRAINER_USER_ID, authorName: 'Jonas Beck', text: 'FREI ERFUNDEN AM SATZ', createdAt }],
        }],
      }],
      updatedAt: new Date(Date.now() + 60_000).toISOString(),
    };
    const results = await service.push(
      [{ id: 'evt-m2-move', store: 'plans', entityId: original.id, action: 'update', payload: forged, clientUpdatedAt: forged.updatedAt }],
      asAthlete(CLUB_A, null),
    );
    expect(results[0]!.status).toBe('error');
  });

  it('lehnt das Umschreiben des TEXTES eines bestehenden fremden Kommentars ab (authorId unverändert)', async () => {
    const { service, gateway } = makeService();
    const createdAt = new Date().toISOString();
    const original = makeExercisePayload({
      comments: [{ id: 'c1', authorId: TRAINER_USER_ID, authorName: 'Jonas Beck', text: 'Gute Arbeit', createdAt }],
    });
    await service.push(
      [{ id: 'evt-m2-rewrite-seed', store: 'exercises', entityId: original.id, action: 'create', payload: original, clientUpdatedAt: original.updatedAt }],
      asTrainer(CLUB_A),
    );

    const forged = {
      ...original,
      comments: [{ id: 'c1', authorId: TRAINER_USER_ID, authorName: 'Jonas Beck', text: 'UMGESCHRIEBEN', createdAt }],
      updatedAt: new Date(Date.now() + 60_000).toISOString(),
    };
    const results = await service.push(
      [{ id: 'evt-m2-rewrite', store: 'exercises', entityId: original.id, action: 'update', payload: forged, clientUpdatedAt: forged.updatedAt }],
      asAdmin(CLUB_A),
    );
    expect(results[0]!.status).toBe('error');
    const stored = await gateway.findById('exercises', original.id);
    expect(((stored as Record<string, unknown>).comments as Array<{ text: string }>)[0]!.text).toBe('Gute Arbeit');
  });

  it('erlaubt das LÖSCHEN eines fremden Kommentars (geteilter Datensatz — bewusst nicht eingeschränkt)', async () => {
    const { service, gateway } = makeService();
    const original = makeExercisePayload({
      comments: [{ id: 'c1', authorId: TRAINER_USER_ID, authorName: 'Jonas Beck', text: 'Weg damit', createdAt: new Date().toISOString() }],
    });
    await service.push(
      [{ id: 'evt-m2-del-seed', store: 'exercises', entityId: original.id, action: 'create', payload: original, clientUpdatedAt: original.updatedAt }],
      asTrainer(CLUB_A),
    );

    const withoutComment = { ...original, comments: [], updatedAt: new Date(Date.now() + 60_000).toISOString() };
    const results = await service.push(
      [{ id: 'evt-m2-del', store: 'exercises', entityId: original.id, action: 'update', payload: withoutComment, clientUpdatedAt: withoutComment.updatedAt }],
      asAdmin(CLUB_A),
    );
    expect(results[0]!.status).toBe('applied');
    expect((await gateway.findById('exercises', original.id) as Record<string, unknown>).comments).toEqual([]);
  });

  // Altbestand (Kommentare ohne authorId, geschrieben vor Befund M2):
  // muss unverändert weiterreichbar bleiben, sonst wäre jeder Datensatz
  // mit Alt-Kommentaren dauerhaft unspeicherbar — darf sich aber nicht
  // nachträglich jemandem zuschreiben lassen.
  it('lässt einen Alt-Kommentar ohne authorId unverändert passieren, verhindert aber dessen nachträgliche Zuschreibung', async () => {
    const { service, gateway } = makeService();
    const createdAt = new Date().toISOString();
    const legacyComment = { id: 'c-alt', authorName: 'Alt-Autor:in', text: 'Vor M2 geschrieben', createdAt };
    // Direkt in den Gateway geseedet — ein Alt-Datensatz ist nie durch die
    // heutige Prüfung gelaufen.
    gateway.seed('exercises', { ...makeExercisePayload({ comments: [legacyComment] }), deletedAt: null, createdAt: new Date(), updatedAt: new Date(Date.now() - 60_000) });
    const base = makeExercisePayload();

    const carriedThrough = { ...base, name: 'Umbenannt', comments: [legacyComment], updatedAt: new Date(Date.now() + 60_000).toISOString() };
    const ok = await service.push(
      [{ id: 'evt-m2-legacy-ok', store: 'exercises', entityId: base.id, action: 'update', payload: carriedThrough, clientUpdatedAt: carriedThrough.updatedAt }],
      asAdmin(CLUB_A),
    );
    expect(ok[0]!.status).toBe('applied');

    const claimed = {
      ...base,
      comments: [{ ...legacyComment, authorId: TRAINER_USER_ID }],
      updatedAt: new Date(Date.now() + 120_000).toISOString(),
    };
    const rejected = await service.push(
      [{ id: 'evt-m2-legacy-claim', store: 'exercises', entityId: base.id, action: 'update', payload: claimed, clientUpdatedAt: claimed.updatedAt }],
      asAdmin(CLUB_A),
    );
    expect(rejected[0]!.status).toBe('error');
  });

  it('betrifft ausschließlich die drei Kommentar-tragenden Stores — ein Store ohne Kommentare bleibt unbeeinflusst', async () => {
    const { service } = makeService();
    const payload = makeGroupPayload();
    const results = await service.push(
      [{ id: 'evt-m2-unaffected-store', store: 'groups', entityId: payload.id, action: 'create', payload, clientUpdatedAt: payload.updatedAt }],
      asTrainer(CLUB_A),
    );
    expect(results[0]!.status).toBe('applied');
  });
});

describe('splitAtSafeTimestampBoundary()', () => {
  function row(entityId: string, ms: number): ChangedRecord {
    return { store: 'groups', entityId, action: 'update', payload: null, updatedAt: new Date(ms) };
  }

  it('gibt alle Zeilen unverändert zurück, wenn sie in die Seite passen', () => {
    const rows = [row('a', 1), row('b', 2)];
    expect(splitAtSafeTimestampBoundary(rows, 5)).toEqual(rows);
  });

  it('schneidet an einer sauberen Zeitstempel-Grenze exakt bei pageSize ab', () => {
    const rows = [row('a', 1), row('b', 2), row('c', 3)];
    expect(splitAtSafeTimestampBoundary(rows, 2).map((r) => r.entityId)).toEqual(['a', 'b']);
  });

  it('kürzt die Seite, wenn die Zeile GENAU an der Grenze denselben Zeitstempel wie die letzte reguläre Zeile trägt', () => {
    // pageSize=2: rows[1] (Grenze) und rows[2] (erste ausgeschlossene Zeile)
    // teilen sich den Zeitstempel 2 -> beide dürfen nicht getrennt werden,
    // die Seite wird auf die einzige verbleibende sichere Zeile gekürzt.
    const rows = [row('a', 1), row('b', 2), row('c', 2)];
    expect(splitAtSafeTimestampBoundary(rows, 2).map((r) => r.entityId)).toEqual(['a']);
  });

  it('liefert eine leere Seite, wenn ALLE gepufferten Zeilen denselben Zeitstempel teilen', () => {
    const rows = [row('a', 1), row('b', 1), row('c', 1)];
    expect(splitAtSafeTimestampBoundary(rows, 2)).toEqual([]);
  });
});

describe('describeSyncError()', () => {
  it('übersetzt einen Fehler mit Prisma-Code "P2003" (Fremdschlüssel-Verletzung) in eine verständliche deutsche Meldung', () => {
    const fakeError = { code: 'P2003', message: 'Foreign key constraint failed on the field: `athleteId`' };
    expect(describeSyncError(fakeError)).toBe(
      'Die referenzierte Person oder der referenzierte Datensatz existiert nicht mehr (wurde vermutlich zwischenzeitlich endgültig gelöscht).',
    );
  });

  it('gibt für einen normalen Error NICHT dessen Original-Nachricht zurück (kein Leak interner Fehlerdetails)', () => {
    // Sicherheitskorrektur: die rohe err.message darf den Client nicht
    // erreichen (siehe Kommentar bei describeSyncError() — Prismas Texte
    // nennen z. B. Spalten-/Constraint-Namen aus dem internen Schema).
    expect(describeSyncError(new Error('Unique constraint failed on the fields: (`tokenHash`)')))
      .toBe('Der Vorgang konnte nicht angewendet werden (interner Fehler).');
  });

  it('liefert einen generischen Text für Fehler ohne erkennbare Form', () => {
    expect(describeSyncError('nur ein String')).toBe('Der Vorgang konnte nicht angewendet werden (interner Fehler).');
    expect(describeSyncError(undefined)).toBe('Der Vorgang konnte nicht angewendet werden (interner Fehler).');
  });

  it('behandelt einen Fehler mit anderem Code nicht als Fremdschlüssel-Verletzung', () => {
    const fakeError = { code: 'P2002', message: 'Unique constraint failed' };
    expect(describeSyncError(fakeError)).toBe('Der Vorgang konnte nicht angewendet werden (interner Fehler).');
  });
});
