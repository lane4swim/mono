// apps/web/test/state.moduleDeprovisioning.test.js
//
// Regressionstest für Sicherheitsreview 2026-08-27, Befund N5: ein
// abbestelltes Modul-Paket entfernte bislang die bereits lokal
// synchronisierten Daten NICHT von den Geräten (der serverseitige Filter
// unterdrückte nur künftige Changes, siehe sync.service.ts). state.js'
// applyEnabledModules() (intern, nicht exportiert — hier über login()/
// restoreSession() getestet, den beiden Stellen, die enabledModules vom
// Server erhalten) muss beim Erkennen einer Abbestellung die zugehörigen
// IndexedDB-Stores leeren und den globalen Sync-Cursor zurücksetzen.
//
// db.js wird durch eine minimale In-Memory-Fake-Implementierung ersetzt
// (statt eines reinen no-op-Mocks wie in state.test.js), damit der
// Vergleich gegen den "letzten bekannten Stand" (persistiert im
// 'meta'-Store) über mehrere aufeinanderfolgende Aufrufe hinweg
// tatsächlich funktioniert — genau das, worauf applyEnabledModules()
// angewiesen ist.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../js/demoMode.js', () => ({ IS_DEMO: false }));
vi.mock('../js/i18n.js', () => ({ setLocale: vi.fn(), detectInitialLocale: vi.fn(() => 'de-DE') }));

// vi.mock()-Factories werden an den Dateianfang gehoben (siehe Vitest-
// Fehlermeldung, falls vergessen) — vi.hoisted() macht die für die
// Fakes gebrauchten Variablen dort verfügbar, statt separate `let`-
// Deklarationen zu benötigen, auf die die Factories andernfalls VOR ihrer
// eigenen Initialisierung zugreifen würden.
const { fakeDb, clearStoreCalls, resetCursorMock } = vi.hoisted(() => ({
  fakeDb: new Map(), // `${store}:${id}` -> record
  clearStoreCalls: [],
  resetCursorMock: vi.fn(),
}));

// countAll()/CLUB_SCOPED_STORES kamen mit Sicherheitsreview 2026-08-29,
// Befund H1 dazu (state.js: ensureLocalStoreBelongsTo()) — beide werden
// hier über denselben `fakeDb` bedient, damit dieser Test weiterhin
// ausschließlich das Modul-Abbestellungs-Verhalten prüft und nicht
// nebenbei am neuen Eigentümer-Wächter scheitert.
vi.mock('../js/db.js', () => ({
  wipeAll: vi.fn(async () => { fakeDb.clear(); }),
  setClubIdProvider: vi.fn(),
  get: vi.fn(async (store, id) => fakeDb.get(`${store}:${id}`) ?? null),
  put: vi.fn(async (store, obj) => { fakeDb.set(`${store}:${obj.id}`, obj); return obj; }),
  clearStore: vi.fn(async (store) => { clearStoreCalls.push(store); }),
  countAll: vi.fn(async (store) => [...fakeDb.keys()].filter((k) => k.startsWith(`${store}:`)).length),
  CLUB_SCOPED_STORES: new Set([
    'athletes', 'groups', 'competitions', 'entries', 'results',
    'exercises', 'templates', 'plans', 'sessions', 'actionItems',
  ]),
}));

vi.mock('../js/syncClient.js', () => ({ resetCursor: resetCursorMock }));

vi.mock('../js/apiClient.js', () => ({
  login: vi.fn(),
  refreshTokens: vi.fn(),
  getStoredRefreshToken: vi.fn(() => 'stored-refresh-token'),
  clearTokens: vi.fn(),
}));

import * as api from '../js/apiClient.js';
import { login, restoreSession } from '../js/state.js';

function user(overrides = {}) {
  return { id: 'u1', clubId: 'club-1', name: 'Trainer X', role: 'trainer', locale: 'de-DE', enabledModules: [], ...overrides };
}

beforeEach(() => {
  fakeDb.clear();
  clearStoreCalls.length = 0;
  resetCursorMock.mockClear();
});

describe('applyEnabledModules() (intern, über login()/restoreSession() getestet) — Befund N5', () => {
  it('leert beim allerersten Login auf einem Gerät NICHTS (kein bekannter vorheriger Stand zum Vergleich)', async () => {
    api.login.mockResolvedValue(user({ enabledModules: ['athletes', 'plans'] }));
    await login('a@example.org', 'pw', true);
    expect(clearStoreCalls).toEqual([]);
    expect(resetCursorMock).not.toHaveBeenCalled();
  });

  it('leert beim Erkennen einer Abbestellung genau die Stores des entfernten Pakets und setzt den Sync-Cursor zurück', async () => {
    api.login.mockResolvedValue(user({ enabledModules: ['athletes', 'plans'] }));
    await login('a@example.org', 'pw', true);
    clearStoreCalls.length = 0; // erster Login selbst räumt nichts weg (s.o.) — nur die Baseline zählt

    // "athletes" wurde zwischenzeitlich vom Superadmin abbestellt.
    api.login.mockResolvedValue(user({ enabledModules: ['plans'] }));
    await login('a@example.org', 'pw', true);

    expect(clearStoreCalls.sort()).toEqual(['athletes', 'groups']);
    expect(resetCursorMock).toHaveBeenCalledTimes(1);
  });

  it('rührt nichts an, wenn sich enabledModules nicht verkleinert (unverändert oder ein zusätzliches Paket)', async () => {
    api.login.mockResolvedValue(user({ enabledModules: ['plans'] }));
    await login('a@example.org', 'pw', true);
    clearStoreCalls.length = 0;

    api.login.mockResolvedValue(user({ enabledModules: ['plans', 'templates'] }));
    await login('a@example.org', 'pw', true);

    expect(clearStoreCalls).toEqual([]);
    expect(resetCursorMock).not.toHaveBeenCalled();
  });

  it('erkennt eine Abbestellung auch über restoreSession() (Seiten-Reload) hinweg, nicht nur innerhalb derselben Sitzung', async () => {
    api.login.mockResolvedValue(user({ enabledModules: ['athletes', 'catalog'] }));
    await login('a@example.org', 'pw', true);
    clearStoreCalls.length = 0;

    // Simuliert einen Seiten-Reload: eine neue "Sitzung" beginnt über
    // restoreSession() statt login() — der zuletzt bekannte Stand kommt
    // dabei ausschließlich aus der IndexedDB (siehe applyEnabledModules()-
    // Kommentar in state.js zur Begründung, warum ein rein
    // speicherbasierter Vergleich hier nicht ausreichen würde).
    api.refreshTokens.mockResolvedValue({ user: user(), enabledModules: ['catalog'] });
    await restoreSession();

    expect(clearStoreCalls.sort()).toEqual(['athletes', 'groups']);
    expect(resetCursorMock).toHaveBeenCalledTimes(1);
  });

  it('leert bei einem Paket ohne eigene Stores (z. B. "stats") nichts, setzt den Cursor aber dennoch zurück', async () => {
    api.login.mockResolvedValue(user({ enabledModules: ['stats'] }));
    await login('a@example.org', 'pw', true);
    clearStoreCalls.length = 0;

    api.login.mockResolvedValue(user({ enabledModules: [] }));
    await login('a@example.org', 'pw', true);

    expect(clearStoreCalls).toEqual([]);
    expect(resetCursorMock).toHaveBeenCalledTimes(1);
  });
});
