// @vitest-environment jsdom
//
// Regressionstest für Issue #56: qualifications.js, kampfrichter.js und
// userManagement.js riefen im öffentlichen Demo-Modus (demo.html, kein
// apps/api dahinter — siehe demoMode.js) unbedingt echte REST-Endpunkte
// auf, ohne einen IS_DEMO-Zweig zu haben (anders als syncQueue.js). Jeder
// Aufruf dieser drei Seiten in der Demo scheiterte deshalb dauerhaft an
// einem nicht erreichbaren Backend. Dieser Test belegt für alle drei
// Module: im Demo-Modus wird kein API-Aufruf ausgelöst, stattdessen
// erscheint ein erklärender Hinweis.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../js/demoMode.js', () => ({ IS_DEMO: true }));
vi.mock('../js/state.js', () => ({
  isAdmin: () => true,
  hasRole: () => true,
  isSuperAdmin: () => false,
  getCurrentUser: () => ({ id: 'u1', name: 'Test', clubId: '0' }),
  setClubIdentity: vi.fn(),
}));

const apiMocks = {
  listMyQualifications: vi.fn(() => Promise.reject(new Error('must not be called in demo mode'))),
  listQualificationSettings: vi.fn(() => Promise.reject(new Error('must not be called in demo mode'))),
  listClubMembers: vi.fn(() => Promise.reject(new Error('must not be called in demo mode'))),
  listMyRefereeAssignments: vi.fn(() => Promise.reject(new Error('must not be called in demo mode'))),
  listClubs: vi.fn(() => Promise.reject(new Error('must not be called in demo mode'))),
  listInvitations: vi.fn(() => Promise.reject(new Error('must not be called in demo mode'))),
};
vi.mock('../js/apiClient.js', () => ({ ...apiMocks, describeError: (err) => String(err?.message || err) }));

const { qualificationsModule } = await import('../js/modules/qualifications.js');
const { kampfrichterModule } = await import('../js/modules/kampfrichter.js');
const { userManagementModule } = await import('../js/modules/userManagement.js');
const { t } = await import('../js/i18n.js');

beforeEach(() => {
  Object.values(apiMocks).forEach((fn) => fn.mockClear());
});

describe('IS_DEMO-Guards (Issue #56)', () => {
  it('qualifications.js: kein API-Aufruf, zeigt stattdessen den Demo-Hinweis', async () => {
    const container = document.createElement('div');
    await qualificationsModule.render(container);
    expect(apiMocks.listMyQualifications).not.toHaveBeenCalled();
    expect(apiMocks.listQualificationSettings).not.toHaveBeenCalled();
    expect(apiMocks.listClubMembers).not.toHaveBeenCalled();
    expect(container.textContent).toContain(t('qualifications.demoDisabled'));
  });

  it('kampfrichter.js: kein API-Aufruf, zeigt stattdessen den Demo-Hinweis', async () => {
    const container = document.createElement('div');
    await kampfrichterModule.render(container);
    expect(apiMocks.listQualificationSettings).not.toHaveBeenCalled();
    expect(apiMocks.listMyQualifications).not.toHaveBeenCalled();
    expect(apiMocks.listClubMembers).not.toHaveBeenCalled();
    expect(apiMocks.listMyRefereeAssignments).not.toHaveBeenCalled();
    expect(container.textContent).toContain(t('kampfrichter.demoDisabled'));
  });

  it('userManagement.js: kein API-Aufruf, zeigt stattdessen den Demo-Hinweis', async () => {
    const container = document.createElement('div');
    await userManagementModule.render(container);
    expect(apiMocks.listClubs).not.toHaveBeenCalled();
    expect(apiMocks.listInvitations).not.toHaveBeenCalled();
    expect(apiMocks.listClubMembers).not.toHaveBeenCalled();
    expect(container.textContent).toContain(t('usermgmt.demoDisabled'));
  });
});
