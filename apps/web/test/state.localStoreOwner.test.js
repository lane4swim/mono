// apps/web/test/state.localStoreOwner.test.js
//
// Regressionstest für Sicherheitsreview 2026-08-29, Befund H1: die lokale
// IndexedDB wurde ausschließlich von logout() geleert. Endete eine Sitzung
// auf einem anderen Weg — abgelaufenes/serverseitig widerrufenes Refresh
// Token, oder schlicht ein geschlossener Browser —, blieb der vollständige
// gesynchte Bestand der vorherigen Person liegen, und die NÄCHSTE
// angemeldete Person bekam ihn angezeigt: alle Module lesen über
// getAll(<store>) ohne clubId-/Rollenfilter (siehe db.js).
//
// state.js' ensureLocalStoreBelongsTo() (intern, nicht exportiert — hier
// über login()/restoreSession() geprüft) muss die Ablage daher an genau
// eine User-ID binden und bei einem Wechsel vorher vollständig leeren.
//
// Wie state.moduleDeprovisioning.test.js: db.js wird durch eine minimale
// In-Memory-Fake-Implementierung ersetzt (kein reiner no-op-Mock), damit
// der über mehrere Aufrufe hinweg persistierte 'meta'-Eintrag tatsächlich
// trägt — genau darauf beruht der Wächter.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../js/demoMode.js', () => ({ IS_DEMO: false }));
vi.mock('../js/i18n.js', () => ({ setLocale: vi.fn(), detectInitialLocale: vi.fn(() => 'de-DE') }));

const { fakeDb, wipeAllMock } = vi.hoisted(() => ({
  fakeDb: new Map(), // `${store}:${id}` -> record
  wipeAllMock: vi.fn(),
}));

vi.mock('../js/db.js', () => ({
  wipeAll: vi.fn(async () => { wipeAllMock(); fakeDb.clear(); }),
  setClubIdProvider: vi.fn(),
  get: vi.fn(async (store, id) => fakeDb.get(`${store}:${id}`) ?? null),
  put: vi.fn(async (store, obj) => { fakeDb.set(`${store}:${obj.id}`, obj); return obj; }),
  clearStore: vi.fn(async (store) => {
    for (const key of [...fakeDb.keys()]) if (key.startsWith(`${store}:`)) fakeDb.delete(key);
  }),
  countAll: vi.fn(async (store) => [...fakeDb.keys()].filter((k) => k.startsWith(`${store}:`)).length),
  CLUB_SCOPED_STORES: new Set([
    'athletes', 'groups', 'competitions', 'entries', 'results',
    'exercises', 'templates', 'plans', 'sessions', 'actionItems',
  ]),
}));

vi.mock('../js/syncClient.js', () => ({ resetCursor: vi.fn() }));

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

// Bestand, wie ihn ein abgeschlossener Sync hinterlässt: ein
// Athlet:innen-Datensatz mit genau den Feldern, die der Server für die
// Rolle "athlete" gezielt redigiert (notes) — siehe sync.athleteScope.ts.
function seedForeignClubData() {
  fakeDb.set('athletes:a1', { id: 'a1', clubId: 'club-1', firstName: 'Anna', notes: 'coach-intern' });
  fakeDb.set('sessions:s1', { id: 's1', clubId: 'club-1', trainerNote: 'coach-intern' });
}

beforeEach(() => {
  fakeDb.clear();
  wipeAllMock.mockClear();
  api.getStoredRefreshToken.mockReturnValue('stored-refresh-token');
});

describe('ensureLocalStoreBelongsTo() (intern, über login()/restoreSession() geprüft) — Befund H1', () => {
  it('leert die lokale Ablage, wenn sich nach einem Bestand eine ANDERE Person anmeldet', async () => {
    api.login.mockResolvedValue(user({ id: 'u1' }));
    await login('trainerin@example.org', 'pw', true);
    seedForeignClubData();
    wipeAllMock.mockClear();

    api.login.mockResolvedValue(user({ id: 'u2', role: 'athlete' }));
    await login('athletin@example.org', 'pw', true);

    expect(wipeAllMock).toHaveBeenCalledTimes(1);
    expect(fakeDb.get('athletes:a1')).toBeUndefined();
    expect(fakeDb.get('sessions:s1')).toBeUndefined();
  });

  it('leert NICHT, wenn sich dieselbe Person erneut anmeldet (ausstehende Offline-Änderungen bleiben erhalten)', async () => {
    api.login.mockResolvedValue(user({ id: 'u1' }));
    await login('trainerin@example.org', 'pw', true);
    seedForeignClubData();
    wipeAllMock.mockClear();

    await login('trainerin@example.org', 'pw', true);

    expect(wipeAllMock).not.toHaveBeenCalled();
    expect(fakeDb.get('athletes:a1')).toBeDefined();
  });

  it('leert beim allerersten Login auf einem leeren Gerät nicht (nichts zu verlieren, kein unnötiger Vollabzug)', async () => {
    api.login.mockResolvedValue(user());
    await login('trainerin@example.org', 'pw', true);
    expect(wipeAllMock).not.toHaveBeenCalled();
  });

  it('leert Altbestand OHNE vermerkten Eigentümer (Installation aus der Zeit vor dieser Korrektur)', async () => {
    seedForeignClubData(); // kein 'meta:localStoreOwner' -> Herkunft unbekannt
    api.login.mockResolvedValue(user({ id: 'u2' }));
    await login('jemand@example.org', 'pw', true);

    expect(wipeAllMock).toHaveBeenCalledTimes(1);
    expect(fakeDb.get('athletes:a1')).toBeUndefined();
  });

  it('greift auch bei restoreSession() — ein gespeichertes Refresh Token kann zu einer anderen Person gehören als der lokale Bestand', async () => {
    api.login.mockResolvedValue(user({ id: 'u1' }));
    await login('trainerin@example.org', 'pw', true);
    seedForeignClubData();
    wipeAllMock.mockClear();

    api.refreshTokens.mockResolvedValue({ user: user({ id: 'u2' }), enabledModules: [] });
    await restoreSession();

    expect(wipeAllMock).toHaveBeenCalledTimes(1);
    expect(fakeDb.get('athletes:a1')).toBeUndefined();
  });
});
