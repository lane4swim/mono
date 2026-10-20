// @vitest-environment jsdom
//
// Team-Filter (js/teamFilter.js) und seine Verwendung in der Einheiten-
// und Wettkampfliste (js/modules/sessions.js, js/modules/competitions.js).
import { describe, it, expect, vi, beforeEach } from 'vitest';

const session = vi.hoisted(() => ({ user: { id: 'u-trainer', athleteId: null }, roles: ['trainer'] }));
vi.mock('../js/state.js', () => ({
  getCurrentUser: () => session.user,
  getRoles: () => session.roles,
  getEnabledModules: () => [],
  hasRole: (r) => session.roles.includes(r),
  isAdmin: () => false,
  isTrainerOrAdmin: () => true,
  isAthleteScoped: () => false,
}));
const stores = vi.hoisted(() => ({}));
vi.mock('../js/db.js', () => ({ getAll: vi.fn(async (name) => stores[name] || []), put: vi.fn(), remove: vi.fn() }));
vi.mock('../js/apiClient.js', () => ({ describeError: (e) => String(e) }));

const { matchesTeams, competitionGroupIds, athleteGroupMap, loadTeamSelection, saveTeamSelection } = await import('../js/teamFilter.js');
const { sessionsModule } = await import('../js/modules/sessions.js');
const { competitionsModule } = await import('../js/modules/competitions.js');
const { t } = await import('../js/i18n.js');

const groups = [{ id: 'g-a', name: 'Leistungsgruppe' }, { id: 'g-b', name: 'Nachwuchs' }];
const athletes = [{ id: 'a1', groupId: 'g-a' }, { id: 'a2', groupId: 'g-b' }, { id: 'a3', groupId: null }];

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  for (const k of Object.keys(stores)) delete stores[k];
  Object.assign(stores, {
    groups, athletes,
    sessions: [
      { id: 's1', date: '2026-10-12T00:00:00.000Z', groupId: 'g-a', attendance: [] },
      { id: 's2', date: '2026-10-13T00:00:00.000Z', groupId: 'g-b', attendance: [] },
    ],
    competitions: [
      { id: 'c-a', name: 'Bezirk', date: '2099-01-01', location: '', course: 'SCM' },
      { id: 'c-b', name: 'Nachwuchscup', date: '2099-02-01', location: '', course: 'SCM' },
      { id: 'c-none', name: 'Offen', date: '2099-03-01', location: '', course: 'LCM' },
    ],
    entries: [{ id: 'e1', competitionId: 'c-a', athleteId: 'a1' }, { id: 'e2', competitionId: 'c-b', athleteId: 'a2' }],
  });
});

async function render(mod) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  await mod.render(container, []);
  return container;
}
const chip = (c, name) => [...c.querySelectorAll('.team-chip')].find((b) => b.textContent === name);
const rows = (c) => [...c.querySelectorAll('tbody tr')].map((r) => r.textContent);

describe('teamFilter — Logik', () => {
  it('matchesTeams: leere Auswahl und teamlose Datensätze passen immer', () => {
    expect(matchesTeams(['g-a'], new Set())).toBe(true);
    expect(matchesTeams(null, new Set(['g-a']))).toBe(true);
    expect(matchesTeams(['g-a', 'g-b'], new Set(['g-b']))).toBe(true);
    expect(matchesTeams(['g-a'], new Set(['g-b']))).toBe(false);
  });

  it('competitionGroupIds: Teams der Meldungen, ohne Meldungen null', () => {
    const map = athleteGroupMap(athletes);
    expect(competitionGroupIds([{ athleteId: 'a1' }, { athleteId: 'a2' }, { athleteId: 'a1' }], map).sort()).toEqual(['g-a', 'g-b']);
    expect(competitionGroupIds([], map)).toBe(null);
    expect(competitionGroupIds([{ athleteId: 'a3' }], map)).toBe(null);
  });

  it('gespeicherte Auswahl je Ansicht und Person, gelöschte Gruppen fallen heraus', () => {
    saveTeamSelection('x', session.user, new Set(['g-a', 'g-gone']));
    expect([...loadTeamSelection('x', session.user, groups)]).toEqual(['g-a']);
    expect(loadTeamSelection('y', session.user, groups).size).toBe(0);
    expect(loadTeamSelection('x', { id: 'other' }, groups).size).toBe(0);
  });
});

describe('Einheitenliste', () => {
  it('filtert nach Team und merkt die Auswahl', async () => {
    let c = await render(sessionsModule);
    expect(rows(c)).toHaveLength(2);
    chip(c, 'Nachwuchs').click();
    expect(rows(c)).toHaveLength(1);
    expect(rows(c)[0]).toContain('Nachwuchs');
    c.remove();
    c = await render(sessionsModule);
    expect(rows(c)).toHaveLength(1);
    chip(c, t('teamFilter.all')).click();
    expect(rows(c)).toHaveLength(2);
  });

  it('zeigt einen Hinweis, wenn für die Auswahl nichts übrig bleibt', async () => {
    stores.sessions = stores.sessions.filter((s) => s.groupId === 'g-a');
    const c = await render(sessionsModule);
    chip(c, 'Nachwuchs').click();
    expect(c.textContent).toContain(t('teamFilter.noMatchTitle'));
  });
});

describe('Wettkampfliste', () => {
  it('filtert über die Teams der Meldungen; Wettkämpfe ohne Meldungen bleiben', async () => {
    const c = await render(competitionsModule);
    expect(rows(c)).toHaveLength(3);
    chip(c, 'Nachwuchs').click();
    const shown = rows(c).join('|');
    expect(shown).toContain('Nachwuchscup');
    expect(shown).toContain('Offen');
    expect(shown).not.toContain('Bezirk');
  });

  it('ohne mehrere Teams kein Filter', async () => {
    stores.groups = [groups[0]];
    const c = await render(competitionsModule);
    expect(c.querySelector('.team-chip')).toBeNull();
  });
});
