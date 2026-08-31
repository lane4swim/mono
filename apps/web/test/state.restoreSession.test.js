// apps/web/test/state.restoreSession.test.js
//
// Regressionstest für Review 30.08.2026, Befund U4: restoreSession()
// behandelte JEDEN Fehlschlag von api.refreshTokens() gleich — auch einen
// 429 (Ratenlimit-Treffer auf /auth/refresh, siehe Befund S2) — und rief
// dabei clearTokens() auf, obwohl ein 429 nichts über die Gültigkeit der
// Sitzung aussagt, nur darüber, dass DIESER Wiederherstellungsversuch
// gerade nicht möglich war (z. B. beim gleichzeitigen Neustart mehrerer
// Geräte hinter derselben NAT nach einem Netzwerkausfall).
//
// Eigene Datei statt einer Ergänzung in state.localStoreOwner.test.js: dort
// mockt apiClient.js ohne ApiError-Klasse — ein `instanceof api.ApiError`
// bräuchte eine echte (Mock-)Klasse im Modul-Mock, die die dortigen Tests
// nicht benötigen.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../js/demoMode.js', () => ({ IS_DEMO: false }));
vi.mock('../js/i18n.js', () => ({ setLocale: vi.fn(), detectInitialLocale: vi.fn(() => 'de-DE') }));
vi.mock('../js/db.js', () => ({
  wipeAll: vi.fn(),
  setClubIdProvider: vi.fn(),
  get: vi.fn(async () => null),
  put: vi.fn(async (store, obj) => obj),
  clearStore: vi.fn(),
  countAll: vi.fn(async () => 0),
  CLUB_SCOPED_STORES: new Set(),
}));
vi.mock('../js/syncClient.js', () => ({ resetCursor: vi.fn() }));

// vi.hoisted(): vi.mock()-Fabriken werden an den Dateianfang gehoben — eine
// gewöhnliche Klassendeklaration wäre zu diesem Zeitpunkt noch nicht
// initialisiert (siehe vi.mock()-Dokumentation).
const { MockApiError } = vi.hoisted(() => ({
  MockApiError: class MockApiError extends Error {
    constructor(status, body) {
      super(body?.message ?? `API-Fehler (${status})`);
      this.status = status;
      this.body = body;
    }
  },
}));

vi.mock('../js/apiClient.js', () => ({
  ApiError: MockApiError,
  refreshTokens: vi.fn(),
  getStoredRefreshToken: vi.fn(() => 'stored-refresh-token'),
  clearTokens: vi.fn(),
}));

import * as api from '../js/apiClient.js';
import { restoreSession, getCurrentUser } from '../js/state.js';

beforeEach(() => {
  api.clearTokens.mockClear();
  api.getStoredRefreshToken.mockReturnValue('stored-refresh-token');
});

describe('restoreSession() — ein 429 beendet die Sitzung nicht (Befund U4)', () => {
  it('ruft clearTokens() NICHT auf, wenn refreshTokens() mit 429 scheitert', async () => {
    api.refreshTokens.mockRejectedValue(new api.ApiError(429, { message: 'Zu viele Anfragen.' }));

    const result = await restoreSession();

    expect(result).toBeNull();
    expect(getCurrentUser()).toBeNull();
    expect(api.clearTokens).not.toHaveBeenCalled();
  });

  it('ruft clearTokens() weiterhin auf, wenn der Refresh Token tatsächlich ungültig ist (401, kein Ratenlimit)', async () => {
    api.refreshTokens.mockRejectedValue(new api.ApiError(401, { message: 'Refresh Token ungültig.' }));

    const result = await restoreSession();

    expect(result).toBeNull();
    expect(api.clearTokens).toHaveBeenCalledTimes(1);
  });

  it('ruft clearTokens() weiterhin auf, wenn refreshTokens() aus einem anderen Grund scheitert (z. B. offline)', async () => {
    api.refreshTokens.mockRejectedValue(new Error('Netzwerkfehler'));

    const result = await restoreSession();

    expect(result).toBeNull();
    expect(api.clearTokens).toHaveBeenCalledTimes(1);
  });
});
