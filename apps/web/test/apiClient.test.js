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

// Node kennt (wie `localStorage` oben) auch kein globales `location` —
// ein minimaler, beschreibbarer Ersatz reicht, um Befund N3
// (Origin-Gating des `lane1-api-base-url`-Overrides) zu testen. Startwert
// "localhost", da die übrigen Tests in dieser Datei den Override nicht
// verwenden und daher unabhängig vom Origin funktionieren müssen.
globalThis.location = { hostname: 'localhost' };

const api = await import('../js/apiClient.js');

beforeEach(() => {
  globalThis.localStorage.clear();
  globalThis.location.hostname = 'localhost';
  api.clearTokens();
});

// Sicherheitsreview 2026-08, Befund N3: der `lane1-api-base-url`-Override
// betrifft ALLE Requests inkl. Authorization-Header — ohne Origin-Gating
// hätte ein per XSS gesetzter Schlüssel sämtliche Tokens an einen fremden
// Host umgeleitet. getApiBaseUrl()/setApiBaseUrl() berücksichtigen den
// Override deshalb nur noch auf einem lokalen Entwicklungs-Origin.
describe('getApiBaseUrl()/setApiBaseUrl() — Origin-Gating (Befund N3)', () => {
  it('berücksichtigt den Override auf localhost', () => {
    globalThis.location.hostname = 'localhost';
    api.setApiBaseUrl('http://localhost:3000');
    expect(api.getApiBaseUrl()).toBe('http://localhost:3000');
  });

  it('ignoriert einen bereits gesetzten Override auf einem Produktions-Origin, obwohl der Schlüssel im localStorage steht', () => {
    globalThis.location.hostname = 'localhost';
    api.setApiBaseUrl('http://localhost:3000');
    globalThis.location.hostname = 'training.mein-verein.de';
    expect(api.getApiBaseUrl()).toBe('');
  });

  it('lehnt setApiBaseUrl() auf einem Produktions-Origin ab — der Schlüssel wird gar nicht erst geschrieben', () => {
    globalThis.location.hostname = 'training.mein-verein.de';
    api.setApiBaseUrl('http://böser-host.example');
    expect(globalThis.localStorage.getItem('lane1-api-base-url')).toBeNull();
  });

  it('berücksichtigt den Override auf 127.0.0.1 (weiterer anerkannter lokaler Origin)', () => {
    globalThis.location.hostname = '127.0.0.1';
    api.setApiBaseUrl('http://localhost:3000');
    expect(api.getApiBaseUrl()).toBe('http://localhost:3000');
  });
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

// Regressionstests für Befund R6 (Code-Review): accessTokenExpiresAt wurde
// zuvor nur geschrieben, nie gelesen — request() erneuert das Access Token
// jetzt PROAKTIV, wenn es laut diesem Zeitstempel in Kürze abläuft, statt
// ausschließlich auf einen tatsächlichen 401 zu warten.
describe('request() — proaktiver Refresh vor Ablauf (Befund R6)', () => {
  it('erneuert das Access Token proaktiv, wenn es innerhalb der Sicherheitsspanne abläuft, OHNE dass die erste Anfrage einen 401 erhält', async () => {
    // expiresIn: 5s liegt unterhalb der 10s-Sicherheitsspanne (siehe
    // PROACTIVE_REFRESH_MARGIN_MS in apiClient.js) — gilt sofort als
    // "läuft in Kürze ab".
    api.setTokens({ accessToken: 'bald-ablaufendes-token', refreshToken: 'gueltiges-refresh-token', expiresIn: 5 });

    globalThis.fetch = vi.fn(async (url, options) => {
      if (String(url).endsWith('/auth/refresh')) {
        return {
          status: 200, ok: true,
          json: async () => ({ accessToken: 'frisches-access-token', refreshToken: 'frisches-refresh-token', expiresIn: 900, user: { id: 'u1' } }),
        };
      }
      // Die eigentliche Anfrage darf NIE mit dem alten, bald ablaufenden
      // Token gesendet werden — der proaktive Refresh muss ihr vorausgehen.
      expect(options?.headers?.Authorization).toBe('Bearer frisches-access-token');
      return { status: 200, ok: true, json: async () => ({ id: 'u1', name: 'Test Person' }) };
    });

    await api.getMe();

    const refreshCalls = globalThis.fetch.mock.calls.filter(([url]) => String(url).endsWith('/auth/refresh'));
    expect(refreshCalls).toHaveLength(1);
    // GENAU EIN Aufruf von GET /api/me — kein 401/Retry-Zyklus nötig.
    const meCalls = globalThis.fetch.mock.calls.filter(([url]) => String(url).endsWith('/api/me'));
    expect(meCalls).toHaveLength(1);
  });

  it('löst KEINEN proaktiven Refresh aus, wenn das Access Token noch lange gültig ist', async () => {
    api.setTokens({ accessToken: 'frisches-token', refreshToken: 'gueltiges-refresh-token', expiresIn: 900 });
    globalThis.fetch = vi.fn(async (url, options) => {
      expect(String(url)).not.toContain('/auth/refresh');
      expect(options?.headers?.Authorization).toBe('Bearer frisches-token');
      return { status: 200, ok: true, json: async () => ({ id: 'u1' }) };
    });

    await api.getMe();
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('bündelt mehrere gleichzeitige proaktive Refresh-Auslöser auf denselben Single-Flight wie reaktive Refreshs (kein doppelter POST /auth/refresh)', async () => {
    api.setTokens({ accessToken: 'bald-ablaufendes-token', refreshToken: 'gueltiges-refresh-token', expiresIn: 5 });
    globalThis.fetch = vi.fn(async (url) => {
      if (String(url).endsWith('/auth/refresh')) {
        return {
          status: 200, ok: true,
          json: async () => ({ accessToken: 'frisches-access-token', refreshToken: 'frisches-refresh-token', expiresIn: 900, user: { id: 'u1' } }),
        };
      }
      return { status: 200, ok: true, json: async () => ({ id: 'u1' }) };
    });

    await Promise.all([api.getMe(), api.getMe(), api.getMe()]);

    const refreshCalls = globalThis.fetch.mock.calls.filter(([url]) => String(url).endsWith('/auth/refresh'));
    expect(refreshCalls).toHaveLength(1);
  });

  it('login() löst keinen proaktiven Refresh aus (allowRefreshRetry: false, ohnehin noch kein Access Token vorhanden)', async () => {
    api.clearTokens();
    globalThis.fetch = vi.fn(async (url) => {
      expect(String(url)).not.toContain('/auth/refresh');
      return {
        status: 200, ok: true,
        json: async () => ({ accessToken: 'a1', refreshToken: 'r1', expiresIn: 900, user: { id: 'u1' } }),
      };
    });

    await api.login({ email: 'a@b.de', password: 'x', consent: true, consentVersion: '2026-07-15' });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });
});

// Regressionstests für Review 30.08.2026, Befund U4: ein Ratenlimit-Treffer
// (429) beim reaktiven Refresh-Versuch behandelte die Sitzung bislang wie
// einen echten Auth-Fehler (clearTokens() + Rückfall auf den ursprünglichen
// 401) — ununterscheidbar von "Sitzung abgelaufen", obwohl das Refresh
// Token selbst weiterhin gültig war (siehe Befund S2: gerade /auth/refresh
// ist der praktisch relevante Fall, da apiClient.js jede Sitzung
// automatisch/proaktiv erneuert).
describe('request() — ein 429 beim Refresh-Versuch beendet die Sitzung NICHT (Befund U4)', () => {
  it('behält die gespeicherten Tokens und wirft den 429 (nicht den ursprünglichen 401), wenn /auth/refresh mit einem Ratenlimit-Treffer scheitert', async () => {
    api.setTokens({ accessToken: 'abgelaufenes-access-token', refreshToken: 'gueltiges-refresh-token', expiresIn: 900 });

    globalThis.fetch = vi.fn(async (url) => {
      if (String(url).endsWith('/auth/refresh')) {
        return { status: 429, ok: false, json: async () => ({ error: 'rate_limited', message: 'Zu viele Anfragen.' }) };
      }
      // Die eigentliche Anfrage (z. B. GET /api/me) scheitert mit dem
      // ursprünglichen 401 — genau der Auslöser für den Refresh-Versuch.
      return { status: 401, ok: false, json: async () => ({ error: 'unauthorized', message: 'abgelaufen' }) };
    });

    let caughtError;
    try {
      await api.getMe();
    } catch (err) {
      caughtError = err;
    }

    expect(caughtError).toBeInstanceOf(api.ApiError);
    expect(caughtError.status).toBe(429);
    // Die Sitzung bleibt bestehen — clearTokens() wurde NICHT aufgerufen.
    expect(api.getStoredRefreshToken()).toBe('gueltiges-refresh-token');
  });

  it('löscht die Tokens weiterhin, wenn der Refresh Token selbst tatsächlich ungültig ist (401, kein Ratenlimit)', async () => {
    api.setTokens({ accessToken: 'abgelaufenes-access-token', refreshToken: 'widerrufenes-refresh-token', expiresIn: 900 });

    globalThis.fetch = vi.fn(async (url) => {
      if (String(url).endsWith('/auth/refresh')) {
        return { status: 401, ok: false, json: async () => ({ error: 'unauthorized', message: 'Refresh Token ungültig.' }) };
      }
      return { status: 401, ok: false, json: async () => ({ error: 'unauthorized', message: 'abgelaufen' }) };
    });

    await expect(api.getMe()).rejects.toThrow();
    // Anders als beim 429 oben: ein echter Auth-Fehler beendet die Sitzung
    // weiterhin wie vor diesem Fix.
    expect(api.getStoredRefreshToken()).toBeNull();
  });
});

describe('describeError() — eigene Meldung für 429 (Befund U4)', () => {
  it('zeigt eine eigene, verständliche Meldung statt der generischen Server-Fehlermeldung', async () => {
    const { t } = await import('../js/i18n.js');
    const err = new api.ApiError(429, { message: 'Rate limit exceeded' });
    const message = api.describeError(err);
    expect(message).toBe(t('common.errorRateLimited'));
    expect(message).not.toBe('Rate limit exceeded');
  });
});
