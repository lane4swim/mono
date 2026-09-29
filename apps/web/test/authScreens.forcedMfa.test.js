// @vitest-environment jsdom
//
// Issue #97, Plan PR 3: ist die Zwei-Faktor-Anmeldung Pflicht, aber noch
// nicht eingerichtet, führt die Anmeldung in die erzwungene Einrichtung —
// die Sitzung beginnt erst, nachdem die Wiederherstellungscodes gezeigt
// wurden.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../js/demoMode.js', () => ({ IS_DEMO: false }));
const login = vi.fn();
const confirmForcedMfaSetup = vi.fn();
vi.mock('../js/state.js', () => ({
  login: (...args) => login(...args),
  completeMfaLogin: vi.fn(),
  confirmForcedMfaSetup: (...args) => confirmForcedMfaSetup(...args),
  acceptInvitation: vi.fn(),
  resetPassword: vi.fn(),
  getCurrentUser: () => null,
  applySessionUser: vi.fn(),
  CURRENT_CONSENT_VERSION: 'v1',
}));
class ApiError extends Error {
  constructor(status, body) { super('err'); this.status = status; this.body = body; }
}
const beginForcedMfaSetup = vi.fn();
vi.mock('../js/apiClient.js', () => ({
  ApiError,
  NetworkError: class extends Error {},
  describeError: (err) => String(err?.message || err),
  apiErrorMessage: () => 'fehler',
  beginForcedMfaSetup: (...args) => beginForcedMfaSetup(...args),
}));

const { renderLoginScreen } = await import('../js/modules/authScreens.js');
const { t } = await import('../js/i18n.js');
const flush = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); };

const SETUP = {
  secret: 'JBSWY3DPEHPK3PXP',
  otpauthUri: 'otpauth://totp/x',
  qrSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0h1v1H0z"/></svg>',
};

function submitLogin(container) {
  container.querySelector('input[type="email"]').value = 'chef@example.org';
  container.querySelector('input[type="password"]').value = 'ein-sicheres-passwort';
  container.querySelector('#login-consent').checked = true;
  container.querySelector('form').dispatchEvent(new Event('submit', { cancelable: true }));
}

function submitCode(container, code) {
  container.querySelector('input.mfa-code-input').value = code;
  container.querySelector('form').dispatchEvent(new Event('submit', { cancelable: true }));
}

beforeEach(() => {
  document.body.innerHTML = '<div id="auth"></div><div id="modal-root" hidden></div>';
  login.mockReset();
  confirmForcedMfaSetup.mockReset();
  beginForcedMfaSetup.mockReset();
});

describe('Erzwungene Einrichtung bei der Anmeldung', () => {
  it('QR-Code, erster Code, Wiederherstellungscodes — erst dann beginnt die Sitzung', async () => {
    login.mockResolvedValue({ mfaSetupRequired: true, setupToken: 'setup-1' });
    beginForcedMfaSetup.mockResolvedValue(SETUP);
    const finish = vi.fn().mockResolvedValue({ id: 'u1', name: 'Chef' });
    confirmForcedMfaSetup.mockResolvedValue({ recoveryCodes: ['aaaaa-bbbbb', 'ccccc-ddddd'], finish });
    const onSuccess = vi.fn();
    const container = document.getElementById('auth');
    renderLoginScreen(container, onSuccess);

    submitLogin(container);
    await flush();
    expect(beginForcedMfaSetup).toHaveBeenCalledWith('setup-1');
    expect(container.textContent).toContain(t('mfa.forcedTitle'));
    expect(container.querySelector('.mfa-qr-wrap svg')).not.toBeNull();
    expect(container.querySelector('.mfa-secret').textContent).toBe('JBSW Y3DP EHPK 3PXP');

    submitCode(container, '123 456');
    await flush();
    expect(confirmForcedMfaSetup).toHaveBeenCalledWith('setup-1', '123456');
    expect(container.textContent).toContain('aaaaa-bbbbb');
    expect(container.textContent).not.toContain(t('auth.backToLogin'));
    expect(finish).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();

    [...container.querySelectorAll('button')].find((b) => b.textContent === t('mfa.forcedContinue')).click();
    await flush();
    expect(finish).toHaveBeenCalledTimes(1);
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it('ein falscher Code bleibt im Formular, ein abgelaufenes setupToken führt zur Anmeldung zurück', async () => {
    login.mockResolvedValue({ mfaSetupRequired: true, setupToken: 'setup-1' });
    beginForcedMfaSetup.mockResolvedValue(SETUP);
    confirmForcedMfaSetup.mockRejectedValueOnce(new ApiError(400, { error: 'invalid_mfa_code' }));
    const container = document.getElementById('auth');
    renderLoginScreen(container, vi.fn());
    submitLogin(container);
    await flush();

    submitCode(container, '000000');
    await flush();
    expect(container.querySelector('.form-error').textContent).toBe(t('mfa.errorInvalidCode'));
    expect(container.textContent).toContain(t('mfa.forcedTitle'));

    confirmForcedMfaSetup.mockRejectedValueOnce(new ApiError(401, { error: 'invalid_mfa_setup_token' }));
    submitCode(container, '123456');
    await flush();
    expect(container.textContent).toContain(t('auth.loginTitle'));
    expect(container.querySelector('.form-error').textContent).toBe(t('mfa.forcedExpired'));
  });
});
