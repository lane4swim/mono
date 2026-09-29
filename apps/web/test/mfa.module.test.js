// @vitest-environment jsdom
//
// Issue #97: Oberfläche der Zwei-Faktor-Anmeldung (js/modules/mfa.js).
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../js/demoMode.js', () => ({ IS_DEMO: false }));

let currentUser = null;
const applySessionUser = vi.fn((u) => { currentUser = u; return u; });
vi.mock('../js/state.js', () => ({
  getCurrentUser: () => currentUser,
  applySessionUser: (u) => applySessionUser(u),
}));

const apiMocks = {
  getMfaStatus: vi.fn(),
  beginMfaSetup: vi.fn(),
  confirmMfaSetup: vi.fn(),
  disableMfa: vi.fn(),
  regenerateRecoveryCodes: vi.fn(),
  resetUserMfa: vi.fn(),
  setClubMfaPolicy: vi.fn(),
};
class ApiError extends Error {
  constructor(status, body) { super(body?.message || 'err'); this.status = status; this.body = body; }
}
vi.mock('../js/apiClient.js', () => ({
  ...apiMocks,
  ApiError,
  NetworkError: class extends Error {},
  describeError: (err) => String(err?.message || err),
}));

const mfa = await import('../js/modules/mfa.js');
const { t } = await import('../js/i18n.js');

const flush = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); };

beforeEach(() => {
  document.body.innerHTML = '<div id="app-shell"></div><div id="modal-root" hidden></div>';
  Object.values(apiMocks).forEach((fn) => fn.mockReset());
  applySessionUser.mockClear();
  currentUser = { id: 'me', name: 'Admina', roles: ['admin'], clubId: 'club-a', mfaEnabled: false };
});

const QR = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 29 29" shape-rendering="crispEdges"><path fill="#fff" d="M0 0h29v29H0z"/><path stroke="#000" d="M1 1.5h7"/></svg>';

describe('buildQrSvg()', () => {
  it('baut den QR-Code nach und verwirft alles, was nicht dazugehört', () => {
    const hostile = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1" onload="alert(1)"><script>alert(1)</script><foreignObject><div>x</div></foreignObject><path d="M0 0h1" onclick="alert(1)"/><a href="javascript:alert(1)"><path d="M1 1"/></a></svg>';
    const svg = mfa.buildQrSvg(hostile);
    expect(svg.namespaceURI).toBe('http://www.w3.org/2000/svg');
    expect(svg.getAttribute('onload')).toBeNull();
    expect(svg.querySelector('script, foreignObject, a')).toBeNull();
    expect(svg.querySelectorAll('path')).toHaveLength(1);
    expect(svg.querySelector('path').getAttribute('onclick')).toBeNull();
    expect(svg.getAttribute('viewBox')).toBe('0 0 1 1');
  });

  it('übernimmt einen echten QR-Code vollständig', () => {
    const svg = mfa.buildQrSvg(QR);
    expect(svg.querySelectorAll('path')).toHaveLength(2);
    expect(svg.getAttribute('role')).toBe('img');
  });

  it('liefert null für etwas, das kein SVG ist', () => {
    expect(mfa.buildQrSvg('<html><body>nein</body></html>')).toBeNull();
  });
});

describe('Profilbereich', () => {
  it('zeigt "Einrichten", führt durch QR-Code und Bestätigung und zeigt die Wiederherstellungscodes', async () => {
    apiMocks.getMfaStatus.mockResolvedValue({ available: true, enabled: false, required: false, enforced: true, recoveryCodesRemaining: 0 });
    apiMocks.beginMfaSetup.mockResolvedValue({ secret: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP', otpauthUri: 'otpauth://…', qrSvg: QR });
    const codes = Array.from({ length: 10 }, (_, i) => `aaaa${i}-bbbbb`);
    apiMocks.confirmMfaSetup.mockResolvedValue({ recoveryCodes: codes, user: { ...currentUser, mfaEnabled: true } });

    const card = mfa.buildMfaCard();
    document.body.appendChild(card);
    await flush();
    const setupBtn = [...card.querySelectorAll('button')].find((b) => b.textContent === t('mfa.setupButton'));
    setupBtn.click();
    await flush();

    const modal = document.getElementById('modal-root');
    expect(modal.querySelector('svg.mfa-qr')).not.toBeNull();
    expect(modal.textContent).toContain('JBSW Y3DP');
    const input = modal.querySelector('input.mfa-code-input');
    input.value = '123 456';
    modal.querySelector('input[type="password"]').value = 'geheim';
    modal.querySelector('form').dispatchEvent(new Event('submit', { cancelable: true }));
    await flush();

    expect(apiMocks.confirmMfaSetup).toHaveBeenCalledWith('123456', 'geheim');
    expect(applySessionUser).toHaveBeenCalledWith(expect.objectContaining({ mfaEnabled: true }));
    expect([...modal.querySelectorAll('.mfa-recovery-codes li')].map((li) => li.textContent)).toEqual(codes);
  });

  it('zeigt bei aktivem TOTP die verbleibenden Codes und warnt, wenn es nur noch wenige sind', async () => {
    apiMocks.getMfaStatus.mockResolvedValue({ available: true, enabled: true, required: false, enforced: true, recoveryCodesRemaining: 2 });
    const card = mfa.buildMfaCard();
    await flush();
    expect(card.textContent).toContain(t('mfa.recoveryRemaining', { count: 2 }));
    expect(card.textContent).toContain(t('mfa.recoveryLow'));
    expect([...card.querySelectorAll('button')].map((b) => b.textContent)).toEqual([t('mfa.regenerateButton'), t('mfa.disableButton')]);
  });

  it('bietet bei Pflicht kein Abschalten an', async () => {
    apiMocks.getMfaStatus.mockResolvedValue({ available: true, enabled: true, required: true, enforced: true, recoveryCodesRemaining: 10 });
    const card = mfa.buildMfaCard();
    await flush();
    expect(card.textContent).toContain(t('mfa.requiredInfo'));
    expect([...card.querySelectorAll('button')].map((b) => b.textContent)).toEqual([t('mfa.regenerateButton')]);
  });

  it('meldet, wenn TOTP auf dem Server nicht verfügbar ist', async () => {
    apiMocks.getMfaStatus.mockResolvedValue({ available: false, enabled: false, required: false, enforced: true, recoveryCodesRemaining: 0 });
    const card = mfa.buildMfaCard();
    await flush();
    expect(card.textContent).toContain(t('mfa.notAvailable'));
    expect(card.querySelector('button')).toBeNull();
  });

  it('empfiehlt Superadmins TOTP, wenn der Server es nicht vorschreibt', async () => {
    currentUser = { id: 'su', roles: ['superadmin'], clubId: null, mfaEnabled: false };
    apiMocks.getMfaStatus.mockResolvedValue({ available: true, enabled: false, required: false, enforced: false, recoveryCodesRemaining: 0 });
    const card = mfa.buildMfaCard();
    await flush();
    expect(card.textContent).toContain(t('mfa.recommendedForSuperadmin'));
  });
});

describe('Codeschritt der Anmeldung', () => {
  it('schickt den Code, schaltet auf Wiederherstellungscode um und meldet Erfolg', async () => {
    const container = document.createElement('div');
    const onSubmit = vi.fn(async () => ({ id: 'u1', name: 'Mara' }));
    const onSuccess = vi.fn();
    mfa.renderMfaStep(container, { onSubmit, onSuccess, onExpired: vi.fn() });

    const toggle = [...container.querySelectorAll('button')].find((b) => b.textContent === t('mfa.useRecoveryCode'));
    toggle.click();
    container.querySelector('input').value = 'abcde-fghjk';
    container.querySelector('form').dispatchEvent(new Event('submit', { cancelable: true }));
    await flush();

    expect(onSubmit).toHaveBeenCalledWith({ recoveryCode: 'abcde-fghjk' });
    expect(onSuccess).toHaveBeenCalledWith({ id: 'u1', name: 'Mara' });
  });

  it('zeigt einen falschen Code an und führt bei abgelaufenem mfaToken zurück zur Anmeldung', async () => {
    const container = document.createElement('div');
    const onExpired = vi.fn();
    const onSubmit = vi.fn()
      .mockRejectedValueOnce(new ApiError(400, { error: 'invalid_mfa_code' }))
      .mockRejectedValueOnce(new ApiError(401, { error: 'invalid_mfa_token' }));
    mfa.renderMfaStep(container, { onSubmit, onSuccess: vi.fn(), onExpired });

    container.querySelector('input').value = '000000';
    container.querySelector('form').dispatchEvent(new Event('submit', { cancelable: true }));
    await flush();
    expect(container.querySelector('.form-error').textContent).toBe(t('mfa.errorInvalidCode'));

    container.querySelector('form').dispatchEvent(new Event('submit', { cancelable: true }));
    await flush();
    expect(onExpired).toHaveBeenCalledWith(t('mfa.loginExpired'));
  });
});

describe('canResetMemberMfa()', () => {
  const member = (overrides) => ({ id: 'm1', name: 'M', roles: ['trainer'], clubId: 'club-a', mfaEnabled: true, ...overrides });

  it('Admin: Mitglieder und andere Admins des eigenen Vereins mit aktivem TOTP', () => {
    expect(mfa.canResetMemberMfa(member())).toBe(true);
    expect(mfa.canResetMemberMfa(member({ roles: ['admin'] }))).toBe(true);
  });

  it('Admin: nicht das eigene Konto, fremde Vereine, Superadmins oder Konten ohne TOTP', () => {
    expect(mfa.canResetMemberMfa(member({ id: 'me' }))).toBe(false);
    expect(mfa.canResetMemberMfa(member({ clubId: 'club-b' }))).toBe(false);
    expect(mfa.canResetMemberMfa(member({ roles: ['superadmin'], clubId: null }))).toBe(false);
    expect(mfa.canResetMemberMfa(member({ mfaEnabled: false }))).toBe(false);
  });

  it('Superadmin: jede Person außer sich selbst; Trainer:in: niemand', () => {
    currentUser = { id: 'su', roles: ['superadmin'], clubId: null };
    expect(mfa.canResetMemberMfa(member({ clubId: 'club-b' }))).toBe(true);
    currentUser = { id: 'tr', roles: ['trainer'], clubId: 'club-a' };
    expect(mfa.canResetMemberMfa(member())).toBe(false);
  });
});

describe('Vereinseinstellung', () => {
  it('nennt ausstehende Admins nur bei aktiver Pflicht und weist auf einen abgeschalteten Server-Schalter hin', () => {
    const club = { id: 'club-a', name: 'SV A', mfaRequiredForAdmins: true };
    expect(mfa.buildClubMfaPolicyCard(club, null, { enforced: true, adminsWithoutMfa: 2 }).textContent)
      .toContain(t('mfa.clubPolicyPendingAdmins', { count: 2 }));
    expect(mfa.buildClubMfaPolicyCard(club, null, { enforced: true, adminsWithoutMfa: 0 }).textContent)
      .not.toContain(t('mfa.clubPolicyPendingAdmins', { count: 0 }));
    const notEnforced = mfa.buildClubMfaPolicyCard(club, null, { enforced: false, adminsWithoutMfa: 2 }).textContent;
    expect(notEnforced).toContain(t('mfa.clubPolicyNotEnforced'));
    expect(notEnforced).not.toContain(t('mfa.clubPolicyPendingAdmins', { count: 2 }));
  });

  it('lässt sich ohne eigenes TOTP nicht einschalten', () => {
    const control = mfa.clubMfaPolicyControl({ id: 'club-a', name: 'SV A', mfaRequiredForAdmins: false });
    const button = control.querySelector('button');
    expect(button.disabled).toBe(true);
    expect(control.textContent).toContain(t('mfa.clubPolicyNeedsOwnMfa'));
  });

  it('schaltet mit eigenem TOTP per Passwort und Code um', async () => {
    currentUser = { ...currentUser, mfaEnabled: true };
    apiMocks.setClubMfaPolicy.mockResolvedValue({ mfaRequiredForAdmins: true });
    const onChanged = vi.fn();
    const control = mfa.clubMfaPolicyControl({ id: 'club-a', name: 'SV A', mfaRequiredForAdmins: false }, onChanged);
    control.querySelector('button').click();
    const modal = document.getElementById('modal-root');
    modal.querySelector('input[type="password"]').value = 'geheim';
    modal.querySelector('input.mfa-code-input').value = '123456';
    modal.querySelector('form').dispatchEvent(new Event('submit', { cancelable: true }));
    await flush();
    expect(apiMocks.setClubMfaPolicy).toHaveBeenCalledWith('club-a', { requiredForAdmins: true, currentPassword: 'geheim', code: '123456' });
    expect(onChanged).toHaveBeenCalledWith(true);
  });
});
