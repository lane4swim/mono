// @vitest-environment jsdom
//
// Rückmeldung (Zu-/Absage) zu Kampfrichter-Anfragen in js/modules/
// kampfrichter.js: Status-Anzeige, Antwort-Dialog, admin-Übersicht offener
// Anfragen/Absagen.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const session = vi.hoisted(() => ({ roles: ['referee'] }));
vi.mock('../js/state.js', () => ({
  isAdmin: () => session.roles.includes('admin'),
  hasRole: (r) => session.roles.includes(r),
}));
vi.mock('../js/demoMode.js', () => ({ IS_DEMO: false }));
const api = vi.hoisted(() => ({
  listQualificationSettings: vi.fn(),
  listMyQualifications: vi.fn(),
  listClubMembers: vi.fn(),
  listUpcomingClubRefereeAssignments: vi.fn(),
  listMyRefereeAssignments: vi.fn(),
  respondToRefereeAssignment: vi.fn(),
}));
vi.mock('../js/apiClient.js', () => ({ ...api, describeError: (e) => String(e?.message || e) }));

const { kampfrichterModule, openResponseModal, canRespond } = await import('../js/modules/kampfrichter.js');
const { t } = await import('../js/i18n.js');

const ADMIN_ID = '00000000-0000-0000-0000-0000000000a1';
const assignment = (over = {}) => ({
  id: 'as-1', userId: 'u-ref', competitionName: 'Bezirksmeisterschaften', competitionPlace: 'Nord', competitionId: null,
  date: '2099-03-01T00:00:00.000Z', function: 'zeitnehmer', note: '', createdByAdminId: ADMIN_ID,
  status: 'requested', responseNote: '', respondedAt: null, ...over,
});

beforeEach(() => {
  document.body.innerHTML = '<div id="app-shell"></div><div id="modal-root" hidden></div>';
  session.roles = ['referee'];
  for (const fn of Object.values(api)) fn.mockReset();
  api.listQualificationSettings.mockResolvedValue({ settings: [] });
  api.listMyQualifications.mockResolvedValue({ qualifications: [] });
  api.listClubMembers.mockResolvedValue({ users: [] });
  api.listUpcomingClubRefereeAssignments.mockResolvedValue({ assignments: [] });
  api.listMyRefereeAssignments.mockResolvedValue({ assignments: [] });
});

async function render() {
  const container = document.createElement('div');
  document.getElementById('app-shell').appendChild(container);
  await kampfrichterModule.render(container);
  return container;
}
const button = (root, label) => [...root.querySelectorAll('button')].find((b) => b.textContent === label);

describe('Rückmeldung zu Kampfrichter-Anfragen', () => {
  it('nur admin-seitig angelegte Einsätze brauchen eine Antwort', () => {
    expect(canRespond(assignment())).toBe(true);
    expect(canRespond(assignment({ createdByAdminId: null }))).toBe(false);
  });

  it('Kampfrichter:in sieht offene Anfragen mit Hinweis und kann zusagen', async () => {
    api.listMyRefereeAssignments.mockResolvedValue({ assignments: [assignment(), assignment({ id: 'as-2', createdByAdminId: null, status: 'confirmed' })] });
    api.respondToRefereeAssignment.mockResolvedValue(assignment({ status: 'confirmed' }));
    const c = await render();
    expect(c.querySelector('.referee-open-banner').textContent).toBe(t('kampfrichter.openRequests', { count: 1 }));
    expect(c.textContent).toContain(t('kampfrichter.status.requested'));
    // Selbst erfasster Einsatz: kein Antwort-Knopf
    expect(c.querySelectorAll('tbody button').length).toBe(2 + 3);
    button(c, t('kampfrichter.respond')).click();
    const modal = document.getElementById('modal-root');
    modal.querySelector('input').value = ' Bin dabei ';
    button(modal, t('kampfrichter.confirm')).click();
    await vi.waitFor(() => expect(api.respondToRefereeAssignment).toHaveBeenCalledWith('as-1', { status: 'confirmed', responseNote: 'Bin dabei' }));
  });

  it('openResponseModal meldet den aktualisierten Einsatz zurück und zeigt Fehler im Dialog', async () => {
    const onDone = vi.fn();
    api.respondToRefereeAssignment.mockRejectedValueOnce(new Error('offline'));
    openResponseModal(assignment(), onDone);
    const modal = document.getElementById('modal-root');
    button(modal, t('kampfrichter.decline')).click();
    await vi.waitFor(() => expect(modal.querySelector('.form-error').textContent).toBe('offline'));
    expect(onDone).not.toHaveBeenCalled();
    api.respondToRefereeAssignment.mockResolvedValueOnce(assignment({ status: 'declined' }));
    button(modal, t('kampfrichter.decline')).click();
    await vi.waitFor(() => expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ status: 'declined' })));
  });

  it('admin sieht offene Anfragen und Absagen mit Namen sowie Zählungen je Person', async () => {
    session.roles = ['admin'];
    api.listClubMembers.mockResolvedValue({ users: [{ id: 'u-ref', name: 'Ronja', email: 'r@x.de', roles: ['referee'] }] });
    api.listUpcomingClubRefereeAssignments.mockResolvedValue({ assignments: [
      assignment(),
      assignment({ id: 'as-2', status: 'declined', responseNote: 'Urlaub', competitionName: 'Landesmeisterschaften' }),
      assignment({ id: 'as-3', status: 'confirmed', competitionName: 'Kreismeisterschaften' }),
    ] });
    const c = await render();
    const rows = [...c.querySelectorAll('.card')[0].querySelectorAll('tbody tr')].map((r) => r.textContent);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain('Landesmeisterschaften'); // Absagen zuerst
    expect(rows[0]).toContain('Urlaub');
    expect(rows[1]).toContain('Ronja');
    const counts = c.querySelectorAll('.card')[1].textContent;
    for (const key of ['countConfirmed', 'countRequested', 'countDeclined']) expect(counts).toContain(t(`kampfrichter.${key}`, { count: 1 }));
  });
});
