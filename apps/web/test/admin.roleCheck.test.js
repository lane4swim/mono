// @vitest-environment jsdom
//
// Regressionstest für Issue #57: admin.js:54 prüfte den Superadmin-Zugriff
// über das transitionale Einzelrollenfeld `user.role` statt über das
// aktuelle `user.roles`-Array. Solange auth.service.ts den öffentlichen
// User noch als vollständigen DB-Spread liefert, enthält die Antwort
// zufällig auch `role` — sobald die angekündigte Contract-Migration die
// Spalte entfernt, liefert die API kein `role`-Feld mehr, `user.role` wird
// `undefined`, und JEDES Superadmin-Konto würde sofort wieder ausgesperrt.
// Dieser Test simuliert genau diese künftige API-Form (nur `roles`, kein
// `role`) und belegt, dass der Zugriff dann weiterhin funktioniert.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const apiMocks = {
  getStoredRefreshToken: vi.fn(),
  refreshTokens: vi.fn(),
  login: vi.fn(),
  logoutRemote: vi.fn(() => Promise.resolve()),
  clearTokens: vi.fn(),
  listClubs: vi.fn(() => Promise.resolve({ clubs: [] })),
  describeError: vi.fn((err) => String(err?.message || err)),
};
vi.mock('../js/apiClient.js', () => apiMocks);

function setUpDom() {
  document.body.innerHTML = `
    <div id="auth-screen"></div>
    <div id="admin-shell" hidden>
      <span id="current-user-label"></span>
      <button id="btn-logout"></button>
      <div id="view"></div>
    </div>
  `;
}

async function bootAdminWith(user) {
  setUpDom();
  vi.resetModules();
  apiMocks.getStoredRefreshToken.mockReturnValue('stored-refresh-token');
  apiMocks.refreshTokens.mockResolvedValue({ user });
  await import('../admin/admin.js');
  // boot() ist async und nicht awaited (Top-Level-Aufruf am Dateiende) —
  // ein paar Mikrotask-Umläufe abwarten, bis alle Awaits darin (refreshTokens,
  // handleAuthenticated, ggf. renderClubsView/listClubs) durchgelaufen sind.
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('admin.js — Superadmin-Zugriffsprüfung (Issue #57)', () => {
  it('gewährt Zugriff mit dem heutigen API-Format (roles-Array + transitionales role-Feld)', async () => {
    await bootAdminWith({ id: 'u1', name: 'Sina Super', role: 'superadmin', roles: ['superadmin'] });
    expect(document.getElementById('admin-shell').hidden).toBe(false);
    expect(document.getElementById('auth-screen').hidden).toBe(true);
    expect(apiMocks.logoutRemote).not.toHaveBeenCalled();
  });

  it('gewährt Zugriff auch OHNE das role-Feld (künftiges API-Format nach der Contract-Migration)', async () => {
    await bootAdminWith({ id: 'u1', name: 'Sina Super', roles: ['superadmin'] });
    expect(document.getElementById('admin-shell').hidden).toBe(false);
    expect(document.getElementById('auth-screen').hidden).toBe(true);
    expect(apiMocks.logoutRemote).not.toHaveBeenCalled();
  });

  it('sperrt ein Nicht-Superadmin-Konto weiterhin aus und widerruft das Refresh Token', async () => {
    await bootAdminWith({ id: 'u2', name: 'Anna Admin', roles: ['admin'] });
    expect(document.getElementById('admin-shell').hidden).toBe(true);
    expect(document.getElementById('auth-screen').hidden).toBe(false);
    expect(apiMocks.logoutRemote).toHaveBeenCalled();
    expect(apiMocks.clearTokens).toHaveBeenCalled();
  });
});
