// @vitest-environment jsdom
//
// Anmeldung in der Superadmin-Oberfläche (admin/admin.js): der Server
// verlangt die Fassung der Einwilligung, und Superadmins melden sich bei
// aktiver MFA-Pflicht in zwei Schritten an (bzw. richten TOTP erst ein).
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../js/demoMode.js', () => ({ IS_DEMO: false }));

const apiMocks = {
  getStoredRefreshToken: vi.fn(() => null),
  refreshTokens: vi.fn(),
  login: vi.fn(),
  loginMfa: vi.fn(),
  beginForcedMfaSetup: vi.fn(),
  confirmForcedMfaSetup: vi.fn(),
  logoutRemote: vi.fn(() => Promise.resolve()),
  clearTokens: vi.fn(),
  listClubs: vi.fn(() => Promise.resolve({ clubs: [] })),
  getJobsStatus: vi.fn(() => Promise.resolve({ schedulerEnabled: true, jobs: [] })),
  describeError: vi.fn((err) => String(err?.message || err)),
  ApiError: class extends Error {},
};
vi.mock('../js/apiClient.js', () => apiMocks);

const SUPERADMIN = { id: 'u1', name: 'Sina Super', roles: ['superadmin'] };
const flush = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); };

async function bootAndSubmitLogin() {
  document.body.innerHTML = `
    <div id="auth-screen"></div>
    <div id="admin-shell" hidden>
      <span id="current-user-label"></span>
      <button id="btn-logout"></button>
      <div id="view"></div>
    </div>
    <div id="toast-region"></div>
  `;
  vi.resetModules();
  await import('../admin/admin.js');
  await flush();
  const inputs = document.querySelectorAll('#auth-screen input');
  inputs[0].value = 'super@example.org';
  inputs[1].value = 'geheim';
  document.querySelector('#auth-screen input[type=checkbox]').checked = true;
  document.querySelector('#auth-screen form').dispatchEvent(new Event('submit', { cancelable: true }));
  await flush();
}

beforeEach(() => { vi.clearAllMocks(); });

describe('admin.js — Anmeldung', () => {
  it('schickt die Fassung der Einwilligung mit (sonst lehnt der Server mit 400 ab)', async () => {
    const { CURRENT_CONSENT_VERSION } = await import('../js/state.js');
    apiMocks.login.mockResolvedValue(SUPERADMIN);
    await bootAndSubmitLogin();
    expect(apiMocks.login).toHaveBeenCalledWith({ email: 'super@example.org', password: 'geheim', consent: true, consentVersion: CURRENT_CONSENT_VERSION });
    expect(document.getElementById('admin-shell').hidden).toBe(false);
  });

  it('fragt bei aktiver Zwei-Faktor-Anmeldung den Code ab, statt das Konto als Nicht-Superadmin abzuweisen', async () => {
    apiMocks.login.mockResolvedValue({ mfaRequired: true, mfaToken: 'mfa-token' });
    apiMocks.loginMfa.mockResolvedValue(SUPERADMIN);
    await bootAndSubmitLogin();
    expect(apiMocks.logoutRemote).not.toHaveBeenCalled();
    expect(document.getElementById('admin-shell').hidden).toBe(true);

    document.querySelector('#auth-screen input').value = '123456';
    document.querySelector('#auth-screen form').dispatchEvent(new Event('submit', { cancelable: true }));
    await flush();
    expect(apiMocks.loginMfa).toHaveBeenCalledWith({ mfaToken: 'mfa-token', code: '123456' });
    expect(document.getElementById('admin-shell').hidden).toBe(false);
  });

  it('führt ohne eingerichtetes TOTP durch die erzwungene Einrichtung', async () => {
    apiMocks.login.mockResolvedValue({ mfaSetupRequired: true, setupToken: 'setup-token' });
    apiMocks.beginForcedMfaSetup.mockResolvedValue({ secret: 'JBSWY3DPEHPK3PXP', qrSvg: '' });
    apiMocks.confirmForcedMfaSetup.mockResolvedValue({ recoveryCodes: ['aaaa-bbbb'], user: SUPERADMIN });
    await bootAndSubmitLogin();
    expect(apiMocks.beginForcedMfaSetup).toHaveBeenCalledWith('setup-token');

    document.querySelector('#auth-screen form input').value = '123456';
    document.querySelector('#auth-screen form').dispatchEvent(new Event('submit', { cancelable: true }));
    await flush();
    expect(apiMocks.confirmForcedMfaSetup).toHaveBeenCalledWith('setup-token', '123456');
    expect(document.getElementById('auth-screen').textContent).toContain('aaaa-bbbb');

    document.querySelector('#auth-screen button.btn-primary').click();
    await flush();
    expect(document.getElementById('admin-shell').hidden).toBe(false);
  });
});
