// @vitest-environment jsdom
//
// Issue #110: mit aktiver Zwei-Faktor-Anmeldung fragt der Reset-Bildschirm
// nach einem Code, bevor das Passwort geändert wird.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../js/demoMode.js', () => ({ IS_DEMO: false }));
const resetPassword = vi.fn();
vi.mock('../js/state.js', () => ({
  login: vi.fn(),
  completeMfaLogin: vi.fn(),
  confirmForcedMfaSetup: vi.fn(),
  acceptInvitation: vi.fn(),
  resetPassword: (...args) => resetPassword(...args),
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
  describeError: (err) => `api:${err?.body?.error}`,
  apiErrorMessage: (err) => `api:${err?.body?.error}`,
}));

const { renderResetPasswordScreen } = await import('../js/modules/authScreens.js');
const { t } = await import('../js/i18n.js');
const flush = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); };

function submit(container) {
  container.querySelector('form').dispatchEvent(new Event('submit', { cancelable: true }));
}
function fillPasswords(container) {
  const [pw, confirm] = container.querySelectorAll('input[type="password"]');
  pw.value = 'ein-ganz-neues-passwort';
  confirm.value = 'ein-ganz-neues-passwort';
}

beforeEach(() => {
  document.body.innerHTML = '<div id="auth"></div><div id="modal-root" hidden></div>';
  resetPassword.mockReset();
});

describe('Passwort zurücksetzen mit Zwei-Faktor-Anmeldung', () => {
  it('blendet nach mfa_code_required das Codefeld ein und sendet den Code mit', async () => {
    resetPassword
      .mockRejectedValueOnce(new ApiError(400, { error: 'mfa_code_required' }))
      .mockResolvedValueOnce({ id: 'u1', name: 'Mara' });
    const onSuccess = vi.fn();
    const container = document.getElementById('auth');
    renderResetPasswordScreen(container, 'tok', onSuccess);

    fillPasswords(container);
    submit(container);
    await flush();
    expect(resetPassword).toHaveBeenLastCalledWith('tok', 'ein-ganz-neues-passwort', {});
    expect(container.textContent).toContain(t('auth.resetPasswordMfaHint'));
    expect(container.querySelector('.form-error').style.display).toBe('none');
    expect(onSuccess).not.toHaveBeenCalled();

    container.querySelector('input.mfa-code-input').value = '123 456';
    submit(container);
    await flush();
    expect(resetPassword).toHaveBeenLastCalledWith('tok', 'ein-ganz-neues-passwort', { code: '123456' });
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it('zeigt einen falschen Code als Fehler an, ohne das Codefeld zu verdoppeln', async () => {
    resetPassword
      .mockRejectedValueOnce(new ApiError(400, { error: 'mfa_code_required' }))
      .mockRejectedValueOnce(new ApiError(400, { error: 'invalid_mfa_code' }));
    const container = document.getElementById('auth');
    renderResetPasswordScreen(container, 'tok', vi.fn());
    fillPasswords(container);
    submit(container);
    await flush();
    container.querySelector('input.mfa-code-input').value = '000000';
    submit(container);
    await flush();
    expect(container.querySelector('.form-error').textContent).toBe(t('mfa.errorInvalidCode'));
    expect(container.querySelectorAll('input.mfa-code-input')).toHaveLength(1);
  });
});
