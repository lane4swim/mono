// apps/web/test/apiClient.test.js
//
// Testet js/apiClient.js gegen ein gemocktes globalThis.fetch (kein
// echtes Netzwerk) — bislang ungetestet. Deckt insbesondere Befund S4 ab:
// refreshTokens() muss mehrere gleichzeitige Aufrufer auf GENAU einen
// tatsächlichen POST /auth/refresh bündeln (Single-Flight), statt jeden
// eigenständig einen Refresh auslösen zu lassen. Ohne dieses Bündeln
// rotiert der ERSTE dieser parallelen Aufrufe serverseitig das Refresh
// Token; jeder weitere schickt danach ein bereits rotiertes Token und
// scheitert — was ohne die serverseitige Reuse-Detection (siehe apps/api
// auth.service.ts: refresh(), Befund S2) "nur" die eigene Anfrage
// verwarf, mit ihr aber sämtliche Sitzungen des Kontos widerrufen würde
// (Massen-Logout ausgelöst durch reines paralleles Anfrageverhalten der
// App selbst, nicht durch einen echten Diebstahl).
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Node (vitest environment: 'node', siehe vitest.config.js) kennt
// `localStorage` nicht als globalen Standard wie ein Browser — ein
// minimaler, Map-gestützter Ersatz reicht für apiClient.js' alleinige
// Nutzung von get/set/removeItem/clear.
function installLocalStorageStub() {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  };
}
installLocalStorageStub();

const api = await import('../js/apiClient.js');

beforeEach(() => {
  globalThis.localStorage.clear();
  api.clearTokens();
});

describe('refreshTokens() — Single-Flight (Befund S4)', () => {
  it('bündelt mehrere gleichzeitige Aufrufe auf GENAU einen POST /auth/refresh und liefert allen dasselbe Ergebnis', async () => {
    api.setTokens({ accessToken: 'a0', refreshToken: 'altes-refresh-token', expiresIn: 900 });
    globalThis.fetch = vi.fn(async () => ({
      status: 200,
      ok: true,
      json: async () => ({ accessToken: 'neuer-access-token', refreshToken: 'neues-refresh-token', expiresIn: 900, user: { id: 'u1' } }),
    }));

    const [a, b, c] = await Promise.all([api.refreshTokens(), api.refreshTokens(), api.refreshTokens()]);

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(globalThis.localStorage.getItem('lane1-refresh-token')).toBe('neues-refresh-token');
  });

  it('erlaubt nach Abschluss eines Refreshs einen neuen, unabhängigen zweiten Refresh-Versuch', async () => {
    api.setTokens({ accessToken: 'a0', refreshToken: 'token-1', expiresIn: 900 });
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({ status: 200, ok: true, json: async () => ({ accessToken: 'a1', refreshToken: 'token-2', expiresIn: 900, user: { id: 'u1' } }) })
      .mockResolvedValueOnce({ status: 200, ok: true, json: async () => ({ accessToken: 'a2', refreshToken: 'token-3', expiresIn: 900, user: { id: 'u1' } }) });

    await api.refreshTokens();
    await api.refreshTokens();

    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    expect(globalThis.localStorage.getItem('lane1-refresh-token')).toBe('token-3');
  });

  it('lässt einen fehlgeschlagenen Refresh an alle wartenden Aufrufer als Fehler durchreichen, ohne ihn mehrfach auszulösen', async () => {
    api.setTokens({ accessToken: 'a0', refreshToken: 'ungueltiges-token', expiresIn: 900 });
    globalThis.fetch = vi.fn(async () => ({
      status: 401,
      ok: false,
      json: async () => ({ error: 'invalid_refresh_token', message: 'Refresh Token ist ungültig.' }),
    }));

    const results = await Promise.allSettled([api.refreshTokens(), api.refreshTokens()]);
    expect(results.every((r) => r.status === 'rejected')).toBe(true);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });
});

describe('request() — 401-Retry über refreshTokens() (Befund S4, End-to-End)', () => {
  // Simuliert den Praxisfall: der Access Token ist zwischenzeitlich
  // abgelaufen, mehrere Requests laufen parallel (z. B. runSync()'s
  // push()+pull(), oder ein modulweites Promise.all() wie in
  // userManagement.js). Jede der drei ersten Anfragen bekommt 401 (altes
  // Token), löst intern refreshTokens() aus und wiederholt sich danach
  // mit dem neuen Token.
  it('drei parallele Anfragen mit abgelaufenem Access Token lösen zusammen nur EINEN POST /auth/refresh aus', async () => {
    api.setTokens({ accessToken: 'abgelaufenes-access-token', refreshToken: 'gueltiges-refresh-token', expiresIn: 900 });

    globalThis.fetch = vi.fn(async (url, options) => {
      if (String(url).endsWith('/auth/refresh')) {
        return {
          status: 200, ok: true,
          json: async () => ({ accessToken: 'frisches-access-token', refreshToken: 'frisches-refresh-token', expiresIn: 900, user: { id: 'u1' } }),
        };
      }
      const authHeader = options?.headers?.Authorization;
      if (authHeader === 'Bearer abgelaufenes-access-token') {
        return { status: 401, ok: false, json: async () => ({ error: 'unauthorized', message: 'abgelaufen' }) };
      }
      expect(authHeader).toBe('Bearer frisches-access-token');
      return { status: 200, ok: true, json: async () => ({ id: 'u1', name: 'Test Person' }) };
    });

    const results = await Promise.all([api.getMe(), api.getMe(), api.getMe()]);
    expect(results).toEqual([
      { id: 'u1', name: 'Test Person' },
      { id: 'u1', name: 'Test Person' },
      { id: 'u1', name: 'Test Person' },
    ]);

    const refreshCalls = globalThis.fetch.mock.calls.filter(([url]) => String(url).endsWith('/auth/refresh'));
    expect(refreshCalls).toHaveLength(1);
    // 3× ursprünglicher (401) + 3× wiederholter (200) Aufruf von GET /api/me.
    const meCalls = globalThis.fetch.mock.calls.filter(([url]) => String(url).endsWith('/api/me'));
    expect(meCalls).toHaveLength(6);
  });
});
