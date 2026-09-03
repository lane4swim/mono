// apps/api/test/sync/sync.route.test.ts
import { describe, it, expect, vi } from 'vitest';
import { MODULE_KEYS } from '@lane1/shared-types';
import { buildApp } from '../../src/app.js';
import { sweepExpiredClubModules, type CachedClubModules } from '../../src/modules/sync/sync.route.js';
import { loadEnv } from '../../src/config/env.js';
import { createAuthService } from '../../src/modules/auth/auth.service.js';
import { InMemoryUserRepository, InMemoryRefreshTokenRepository, InMemoryPasswordResetTokenRepository } from '../../src/modules/auth/auth.repository.memory.js';
import { createInvitationsService } from '../../src/modules/invitations/invitations.service.js';
import { InMemoryClubRepository, InMemoryInvitationRepository, InMemoryAthleteRepository } from '../../src/modules/invitations/invitations.repository.memory.js';
import { createSyncService } from '../../src/modules/sync/sync.service.js';
import { InMemorySyncGateway } from '../../src/modules/sync/sync.gateway.memory.js';
import { InMemoryMailSender } from '../../src/mail/mailer.memory.js';
import { InMemoryProfileDataGateway } from '../../src/modules/profile/profile.repository.memory.js';
import { generateFreshKeyPair, type KeyPair } from '../../src/auth/keys.js';
import { signAccessToken } from '../../src/auth/tokens.js';

const testEnv = loadEnv({
  NODE_ENV: 'test',
  PORT: '3000',
  DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
  CORS_ORIGIN: 'http://localhost:5173',
});

async function buildTestApp() {
  const keyPair = generateFreshKeyPair();
  const invitations = new InMemoryInvitationRepository();
  const invitationsService = createInvitationsService({
    clubs: new InMemoryClubRepository(),
    invitations,
    athletes: new InMemoryAthleteRepository(),
    users: new InMemoryUserRepository(),
    mailer: new InMemoryMailSender(),
    frontendBaseUrl: 'https://app.example.org',
    clubInvitationTtlDays: 14,
    memberInvitationTtlDays: 7,
  });
  // Diese Suite testet die Sync-Route selbst (Rollen-/FK-/Konflikt-
  // Verhalten), nicht das Modul-Gating — jeder Verein hat hier daher
  // standardmäßig alle Module gebucht (siehe sync.permissions.test.ts für
  // gezielte Tests eines eingeschränkten Modul-Sets).
  // `vi.fn()` statt einer nackten Pfeilfunktion, damit die Aufrufzahl
  // zählbar ist — der Cache aus Befund E1 (siehe sync.route.ts) lässt sich
  // sonst nicht von seinem Fehlen unterscheiden. Rückgabewert und
  // Verhalten sind identisch zu vorher.
  const clubs = { findById: vi.fn(async () => ({ enabledModules: [...MODULE_KEYS], nationalID: null, nationalIDType: null })) };
  const authService = createAuthService({
    users: new InMemoryUserRepository(),
    refreshTokens: new InMemoryRefreshTokenRepository(),
    invitations: invitationsService,
    profileGateway: new InMemoryProfileDataGateway({ users: [], athletes: [], results: [], entries: [], actionItems: [], sessions: [] }),
    clubs,
    dataErasureRetentionDays: 30,
    keyPair,
    passwordResetTokens: new InMemoryPasswordResetTokenRepository(),
    mailer: new InMemoryMailSender(),
    frontendBaseUrl: 'https://app.example.org',
    passwordResetTtlMinutes: 60,
    accessTtlSeconds: 900,
    refreshTtlDays: 30,
  });
  const gateway = new InMemorySyncGateway();
  const syncService = createSyncService({ gateway });
  const app = await buildApp(testEnv, { authService, invitationsService, syncService, clubs, keyPair });
  return { app, gateway, keyPair, clubs };
}

async function tokenFor(keyPair: KeyPair, role: string, clubId: string | null, athleteId: string | null = null) {
  return signAccessToken(
    { sub: '00000000-0000-0000-0000-000000000001', role: role as never, clubId, athleteId },
    keyPair,
    900,
  );
}

const CLUB_ID = '11111111-1111-1111-1111-111111111111';

function makeGroupEvent(id: string, overrides: Partial<Record<string, unknown>> = {}) {
  const now = new Date().toISOString();
  const payload = { id, clubId: CLUB_ID, name: 'Leistungsgruppe', description: '', createdAt: now, updatedAt: now, ...overrides };
  return { id: `evt-${id}`, store: 'groups' as const, entityId: id, action: 'create' as const, payload, clientUpdatedAt: payload.updatedAt };
}

// Review 30.08.2026, Befund E1: requesterFrom() las die Club-Zeile bei
// JEDER Push-/Pull-Anfrage neu — ein Erstabgleich (bis zu
// MAX_PULL_ITERATIONS = 1000 Pull-Seiten) fragte damit bis zu 1.000-mal
// dieselbe Zeile ab. Beide Tests prüfen die zwei Hälften des Fixes: dass
// überhaupt zwischengespeichert wird, UND dass der Zwischenspeicher
// wieder verfällt. Die zweite Hälfte ist die sicherheitsrelevante: ein
// dauerhaft gültiger Cache würde ein per Superadmin abbestelltes Modul nie
// wirksam werden lassen.
describe('Vereins-Modul-Lookup je Sync-Anfrage (Review 30.08.2026, Befund E1)', () => {
  it('liest die Club-Zeile für mehrere aufeinanderfolgende Anfragen desselben Vereins nur EINMAL, je Verein aber getrennt', async () => {
    const { app, keyPair, clubs } = await buildTestApp();
    const token = await tokenFor(keyPair, 'trainer', CLUB_ID);

    for (let i = 0; i < 5; i++) {
      const response = await app.inject({
        method: 'GET', url: '/api/sync/pull',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.statusCode).toBe(200);
    }
    // Ohne den Cache: fünf Aufrufe für fünf Anfragen.
    expect(clubs.findById).toHaveBeenCalledTimes(1);

    // Ein ANDERER Verein darf den Eintrag des ersten nicht mitbenutzen —
    // sonst bekäme er dessen Modul-Set (ein Mandantendurchbruch auf der
    // Rechte-Ebene). Der Cache ist nach clubId geschlüsselt, also ein
    // zweiter Lookup.
    const otherClubToken = await tokenFor(keyPair, 'trainer', '99999999-9999-9999-9999-999999999999');
    const otherResponse = await app.inject({
      method: 'GET', url: '/api/sync/pull',
      headers: { authorization: `Bearer ${otherClubToken}` },
    });
    expect(otherResponse.statusCode).toBe(200);
    expect(clubs.findById).toHaveBeenCalledTimes(2);

    await app.close();
  });

  it('liest die Club-Zeile nach Ablauf der Cache-Lebensdauer erneut (ein abbestelltes Modul wird wirksam, statt dauerhaft veraltet zu bleiben)', async () => {
    const { app, keyPair, clubs } = await buildTestApp();
    const token = await tokenFor(keyPair, 'trainer', CLUB_ID);

    const first = await app.inject({
      method: 'GET', url: '/api/sync/pull',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(first.statusCode).toBe(200);
    expect(clubs.findById).toHaveBeenCalledTimes(1);

    // Nur `Date.now()` vorstellen (der einzige Zeitgeber des Caches),
    // nicht die echten Timer — Fastify und die Token-Prüfung laufen
    // dadurch unbeeinflusst weiter. 46 s > CLUB_MODULES_CACHE_TTL_MS
    // (45 s), aber weit unter der Access-Token-Laufzeit von 900 s, das
    // Token bleibt also gültig.
    const realNow = Date.now();
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => realNow + 46_000);
    try {
      const second = await app.inject({
        method: 'GET', url: '/api/sync/pull',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(second.statusCode).toBe(200);
      // Ein Cache ohne Verfall bliebe hier bei 1 — und ein abbestelltes
      // Modul würde nie greifen.
      expect(clubs.findById).toHaveBeenCalledTimes(2);
    } finally {
      nowSpy.mockRestore();
    }

    await app.close();
  });
});

// Code-Review 2026-09-02, Befund R2: ein abgelaufener Eintrag wurde
// bislang nur bei erneutem Zugriff überschrieben, nie proaktiv entfernt —
// ein Verein, der nie wieder abgefragt wird (z. B. nach einem harten
// DSGVO-Purge), hinterließe seinen Eintrag dauerhaft in der Map. Testet
// die reine Sweep-Funktion direkt (kein Timer, keine Fastify-Instanz
// nötig) — die Instanz, die syncRoutes() tatsächlich per setInterval()
// aufruft, ist von außen nicht beobachtbar (siehe dortiger Kommentar).
describe('sweepExpiredClubModules()', () => {
  it('entfernt abgelaufene Einträge', () => {
    const cache = new Map<string, CachedClubModules>([
      ['expired', { enabledModules: [], expiresAt: 1000 }],
      ['stillValid', { enabledModules: ['athletes'], expiresAt: 5000 }],
    ]);
    sweepExpiredClubModules(cache, 2000);
    expect(cache.has('expired')).toBe(false);
    expect(cache.has('stillValid')).toBe(true);
  });

  it('lässt einen Eintrag stehen, dessen expiresAt exakt "now" entspricht (Grenzfall < vs. <=)', () => {
    // Dieselbe Grenzbedingung wie in resolveEnabledModules() oben
    // (`cached.expiresAt > now` gilt noch als frisch) — der Sweep muss
    // konsistent dazu genau diesen Grenzfall noch als abgelaufen werten
    // (`entry.expiresAt <= now`), sonst könnten beide Prüfungen für
    // denselben Zeitpunkt unterschiedliche Ergebnisse liefern.
    const cache = new Map<string, CachedClubModules>([['borderline', { enabledModules: [], expiresAt: 1000 }]]);
    sweepExpiredClubModules(cache, 1000);
    expect(cache.has('borderline')).toBe(false);
  });

  it('ist ein No-Op auf einer leeren oder vollständig frischen Map', () => {
    const empty = new Map<string, CachedClubModules>();
    sweepExpiredClubModules(empty, Date.now());
    expect(empty.size).toBe(0);

    const allFresh = new Map<string, CachedClubModules>([['a', { enabledModules: [], expiresAt: 9_999_999_999_999 }]]);
    sweepExpiredClubModules(allFresh, Date.now());
    expect(allFresh.size).toBe(1);
  });
});

describe('POST /api/sync/push', () => {
  it('lehnt nicht authentifizierte Anfragen ab (401)', async () => {
    const { app } = await buildTestApp();
    const response = await app.inject({ method: 'POST', url: '/api/sync/push', payload: { events: [] } });
    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it('lehnt Superadmin ab (403) — Superadmin gehört zu keinem Verein', async () => {
    const { app, keyPair } = await buildTestApp();
    const token = await tokenFor(keyPair, 'superadmin', null);
    const response = await app.inject({
      method: 'POST', url: '/api/sync/push',
      headers: { authorization: `Bearer ${token}` },
      payload: { events: [] },
    });
    expect(response.statusCode).toBe(403);
    await app.close();
  });

  it('wendet ein gültiges create-Event für einen eingeloggten Trainer an (200)', async () => {
    const { app, keyPair, gateway } = await buildTestApp();
    const token = await tokenFor(keyPair, 'trainer', CLUB_ID);
    const event = makeGroupEvent('22222222-2222-2222-2222-222222222222');
    const response = await app.inject({
      method: 'POST', url: '/api/sync/push',
      headers: { authorization: `Bearer ${token}` },
      payload: { events: [event] },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().results).toEqual([{ eventId: event.id, status: 'applied' }]);
    expect(await gateway.findById('groups', event.entityId)).not.toBeNull();
    await app.close();
  });

  it('liefert 400 bei einem leeren events-Array (Schema verlangt mindestens ein Event)', async () => {
    const { app, keyPair } = await buildTestApp();
    const token = await tokenFor(keyPair, 'admin', CLUB_ID);
    const response = await app.inject({
      method: 'POST', url: '/api/sync/push',
      headers: { authorization: `Bearer ${token}` },
      payload: { events: [] },
    });
    expect(response.statusCode).toBe(400);
    await app.close();
  });

  // Regressionstest für Befund R3 (Code-Review): die Route prüfte
  // vormals JEDES Event bereits vollständig gegen SyncEventSchema — ein
  // einzelnes strukturell ungültiges Event ließ den GESAMTEN Batch mit
  // einer 400 scheitern, inklusive aller übrigen, gültigen Events. Die
  // Route lockert diese Prüfung jetzt auf die reine Array-Länge; die
  // eigentliche Struktur-Prüfung (SyncEventSchema.safeParse) übernimmt
  // sync.service.ts: push() PRO EVENT — ein kaputtes Event scheitert
  // jetzt nur noch selbst, alle anderen Events desselben Batches werden
  // regulär angewendet.
  it('wendet gültige Events eines Batches an und meldet nur das strukturell ungültige als Fehler, statt den gesamten Batch abzulehnen (Befund R3)', async () => {
    const { app, keyPair, gateway } = await buildTestApp();
    const token = await tokenFor(keyPair, 'trainer', CLUB_ID);
    const validEvent = makeGroupEvent('33333333-3333-3333-3333-333333333333');
    // Fehlt "store" — strukturell ungültig gegen SyncEventSchema.
    const malformedEvent = { id: 'evt-broken', entityId: 'x', action: 'create', payload: {}, clientUpdatedAt: new Date().toISOString() };

    const response = await app.inject({
      method: 'POST', url: '/api/sync/push',
      headers: { authorization: `Bearer ${token}` },
      payload: { events: [validEvent, malformedEvent] },
    });

    expect(response.statusCode).toBe(200);
    const results = response.json().results;
    expect(results).toContainEqual({ eventId: validEvent.id, status: 'applied' });
    expect(results.find((r: { eventId: string }) => r.eventId === 'evt-broken')).toMatchObject({ status: 'error' });
    // Das gültige Event wurde tatsächlich angewendet, nicht nur als
    // "applied" gemeldet, ohne dass es passiert wäre.
    expect(await gateway.findById('groups', validEvent.entityId)).not.toBeNull();
    await app.close();
  });

  it('liefert weiterhin 400 bei mehr als 500 Events (Batch-Größenlimit bleibt auf Routen-Ebene bestehen)', async () => {
    const { app, keyPair } = await buildTestApp();
    const token = await tokenFor(keyPair, 'trainer', CLUB_ID);
    const events = Array.from({ length: 501 }, (_, i) => makeGroupEvent(`44444444-4444-4444-4444-${String(i).padStart(12, '0')}`));

    const response = await app.inject({
      method: 'POST', url: '/api/sync/push',
      headers: { authorization: `Bearer ${token}` },
      payload: { events },
    });
    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it('athlete-Rolle darf ebenfalls synchronisieren (eigene Trainingsdaten)', async () => {
    const { app, keyPair } = await buildTestApp();
    const token = await tokenFor(keyPair, 'athlete', CLUB_ID);
    const event = makeGroupEvent('33333333-3333-3333-3333-333333333333');
    const response = await app.inject({
      method: 'POST', url: '/api/sync/push',
      headers: { authorization: `Bearer ${token}` },
      payload: { events: [event] },
    });
    expect(response.statusCode).toBe(200);
    await app.close();
  });

  it('athlete-Rolle darf "actionItems" NICHT per Push verändern (Rollen-Scopierung, Patch #6, End-to-End über HTTP)', async () => {
    const { app, keyPair } = await buildTestApp();
    const athleteId = '55555555-5555-5555-5555-555555555555';
    const token = await tokenFor(keyPair, 'athlete', CLUB_ID, athleteId);
    const now = new Date().toISOString();
    const payload = {
      id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', clubId: CLUB_ID, athleteId,
      title: 'X', description: '', category: 'technik', status: 'offen',
      createdDate: now, dueDate: null, createdAt: now, updatedAt: now,
    };
    const event = { id: 'evt-actionitem', store: 'actionItems' as const, entityId: payload.id, action: 'create' as const, payload, clientUpdatedAt: now };
    const response = await app.inject({
      method: 'POST', url: '/api/sync/push',
      headers: { authorization: `Bearer ${token}` },
      payload: { events: [event] },
    });
    expect(response.statusCode).toBe(200); // die HTTP-Antwort selbst ist 200; der Fehler steckt im Event-Ergebnis
    expect(response.json().results[0].status).toBe('error');
    await app.close();
  });
});

describe('GET /api/sync/pull', () => {
  it('lehnt nicht authentifizierte Anfragen ab (401)', async () => {
    const { app } = await buildTestApp();
    const response = await app.inject({ method: 'GET', url: '/api/sync/pull' });
    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it('liefert zuvor gepushte Änderungen zurück (Push-dann-Pull-Rundlauf)', async () => {
    const { app, keyPair } = await buildTestApp();
    const token = await tokenFor(keyPair, 'trainer', CLUB_ID);
    const event = makeGroupEvent('44444444-4444-4444-4444-444444444444');

    await app.inject({
      method: 'POST', url: '/api/sync/push',
      headers: { authorization: `Bearer ${token}` },
      payload: { events: [event] },
    });

    const pullResponse = await app.inject({ method: 'GET', url: '/api/sync/pull', headers: { authorization: `Bearer ${token}` } });
    expect(pullResponse.statusCode).toBe(200);
    const body = pullResponse.json();
    expect(body.changes.some((c: { entityId: string }) => c.entityId === event.entityId)).toBe(true);
    expect(body.hasMore).toBe(false);
    await app.close();
  });

  it('lehnt Superadmin ab (403)', async () => {
    const { app, keyPair } = await buildTestApp();
    const token = await tokenFor(keyPair, 'superadmin', null);
    const response = await app.inject({ method: 'GET', url: '/api/sync/pull', headers: { authorization: `Bearer ${token}` } });
    expect(response.statusCode).toBe(403);
    await app.close();
  });

  // Sicherheitskorrektur (Code-Review, Befund 9): vormals die einzige Route
  // ohne Eingabevalidierung — ein ungültiger "cursor"-Wert erzeugte in
  // syncService.pull() ein `Invalid Date`, das die anschließende
  // Datenbankabfrage mit einem ungefangenen Fehler (500) statt einer
  // regulären 400-Antwort quittierte.
  it('liefert 400 bei einem ungültigen "cursor"-Query-Parameter statt eines ungefangenen Fehlers', async () => {
    const { app, keyPair } = await buildTestApp();
    const token = await tokenFor(keyPair, 'trainer', CLUB_ID);
    const response = await app.inject({
      method: 'GET', url: '/api/sync/pull?cursor=abc',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('validation_failed');
    await app.close();
  });

  it('liefert 400 bei einem ungültigen "since"-Query-Parameter statt eines ungefangenen Fehlers', async () => {
    const { app, keyPair } = await buildTestApp();
    const token = await tokenFor(keyPair, 'trainer', CLUB_ID);
    const response = await app.inject({
      method: 'GET', url: '/api/sync/pull?since=nicht-datumsförmig',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it('athlete-Rolle sieht per Pull nur eigene "actionItems" (Rollen-Scopierung, Patch #6, End-to-End über HTTP)', async () => {
    const { app, keyPair, gateway } = await buildTestApp();
    const athleteId = '55555555-5555-5555-5555-555555555555';
    const foreignAthleteId = '66666666-6666-6666-6666-666666666666';
    const now = new Date();
    gateway.seed('actionItems', {
      id: 'own-item', clubId: CLUB_ID, athleteId, title: 'Eigenes Ziel', description: '', category: 'technik',
      status: 'offen', createdDate: now, dueDate: null, createdAt: now, updatedAt: now, deletedAt: null,
    });
    gateway.seed('actionItems', {
      id: 'foreign-item', clubId: CLUB_ID, athleteId: foreignAthleteId, title: 'Fremdes Ziel', description: '', category: 'technik',
      status: 'offen', createdDate: now, dueDate: null, createdAt: now, updatedAt: now, deletedAt: null,
    });

    const token = await tokenFor(keyPair, 'athlete', CLUB_ID, athleteId);
    const response = await app.inject({ method: 'GET', url: '/api/sync/pull', headers: { authorization: `Bearer ${token}` } });
    expect(response.statusCode).toBe(200);
    const entityIds = response.json().changes.map((c: { entityId: string }) => c.entityId);
    expect(entityIds).toContain('own-item');
    expect(entityIds).not.toContain('foreign-item');
    await app.close();
  });
});
