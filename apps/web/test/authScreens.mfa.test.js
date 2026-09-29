// @vitest-environment jsdom
//
// Issue #97: der Anmeldebildschirm übergibt bei aktiver Zwei-Faktor-
// Anmeldung an den Codeschritt und schließt die Anmeldung erst danach ab.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../js/demoMode.js', () => ({ IS_DEMO: false }));
const login = vi.fn();
const completeMfaLogin = vi.fn();
vi.mock('../js/state.js', () => ({
  login: (...args) => login(...args),
  completeMfaLogin: (...args) => completeMfaLogin(...args),
  acceptInvitation: vi.fn(),
  resetPassword: vi.fn(),
  getCurrentUser: () => null,
  applySessionUser: vi.fn(),
  CURRENT_CONSENT_VERSION: 'v1',
}));
class ApiError extends Error {
  constructor(status, body) { super('err'); this.status = status; this.body = body; }
}
vi.mock('../js/apiClient.js', () => ({
  ApiError,
  NetworkError: class extends Error {},
  describeError: (err) => String(err?.message || err),
  apiErrorMessage: () => 'fehler',
}));

const { renderLoginScreen } = await import('../js/modules/authScreens.js');
const { t } = await import('../js/i18n.js');
const flush = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); };

function submitLogin(container) {
  container.querySelector('input[type="email"]').value = 'mara@example.org';
  container.querySelector('input[type="password"]').value = 'ein-sicheres-passwort';
  container.querySelector('#login-consent').checked = true;
  container.querySelector('form').dispatchEvent(new Event('submit', { cancelable: true }));
}

beforeEach(() => {
  document.body.innerHTML = '<div id="auth"></div><div id="modal-root" hidden></div>';
  login.mockReset();
  completeMfaLogin.mockReset();
});

describe('Anmeldung mit Zwei-Faktor-Anmeldung', () => {
  it('zeigt nach dem Passwort den Codeschritt und meldet erst nach gültigem Code an', async () => {
    login.mockResolvedValue({ mfaRequired: true, mfaToken: 'mfa-1' });
    completeMfaLogin.mockResolvedValue({ id: 'u1', name: 'Mara' });
    const onSuccess = vi.fn();
    const container = document.getElementById('auth');
    renderLoginScreen(container, onSuccess);

    submitLogin(container);
    await flush();
    expect(onSuccess).not.toHaveBeenCalled();
    expect(container.textContent).toContain(t('mfa.loginTitle'));

    container.querySelector('input.mfa-code-input').value = '123456';
    container.querySelector('form').dispatchEvent(new Event('submit', { cancelable: true }));
    await flush();
    expect(completeMfaLogin).toHaveBeenCalledWith('mfa-1', { code: '123456' });
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it('führt bei abgelaufenem mfaToken mit Hinweis zurück zur Anmeldung', async () => {
    login.mockResolvedValue({ mfaRequired: true, mfaToken: 'mfa-1' });
    completeMfaLogin.mockRejectedValue(new ApiError(401, { error: 'invalid_mfa_token' }));
    const container = document.getElementById('auth');
    renderLoginScreen(container, vi.fn());
    submitLogin(container);
    await flush();
    container.querySelector('input.mfa-code-input').value = '123456';
    container.querySelector('form').dispatchEvent(new Event('submit', { cancelable: true }));
    await flush();
    expect(container.textContent).toContain(t('auth.loginTitle'));
    expect(container.querySelector('.form-error').textContent).toBe(t('mfa.loginExpired'));
  });

  it('ohne Zwei-Faktor-Anmeldung wie bisher direkt angemeldet', async () => {
    login.mockResolvedValue({ id: 'u1', name: 'Mara' });
    const onSuccess = vi.fn();
    const container = document.getElementById('auth');
    renderLoginScreen(container, onSuccess);
    submitLogin(container);
    await flush();
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(completeMfaLogin).not.toHaveBeenCalled();
  });
});
