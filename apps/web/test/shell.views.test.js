// @vitest-environment jsdom
//
// Ansichten (js/views.js) in der App-Shell: Navigationsfilter, mobile
// Bottom-Nav, Ansichtswechsel, automatischer Wechsel bei Routen außerhalb
// der Ansicht und die Startauswahl samt Häkchen "Immer in dieser Ansicht
// starten".
import { describe, it, expect, vi, beforeEach } from 'vitest';

let roles = ['trainer'];
vi.mock('../js/db.js', () => ({ pendingSyncCount: async () => 0 }));
vi.mock('../js/state.js', () => ({
  getRoles: () => roles,
  getCurrentUser: () => null,
  getEnabledModules: () => ['athletes', 'competitions', 'times', 'plans', 'templates', 'catalog', 'sectionTemplates', 'sessions', 'actionitems', 'announcements', 'stats', 'qualifications', 'kampfrichter'],
}));

const { buildNav, renderRoute, defaultModuleFor, switchView, initViews } = await import('../js/shell.js');
const { registerModule } = await import('../js/router.js');
const { setCurrentView, getCurrentView, setViewStorageScope, getSkipViewPicker, setSkipViewPicker } = await import('../js/views.js');
const { el } = await import('../js/dom.js');

const rendered = [];
const MODULE_ROLES = {
  dashboard: ['trainer', 'admin', 'athlete'],
  athletes: ['trainer', 'admin'],
  competitions: ['trainer', 'admin'],
  times: ['trainer', 'admin', 'athlete'],
  plans: ['trainer', 'athlete'],
  templates: ['trainer'],
  catalog: ['trainer'],
  sectionTemplates: ['trainer'],
  sessions: ['trainer', 'athlete'],
  actionitems: ['trainer', 'admin', 'athlete'],
  announcements: ['trainer', 'admin', 'athlete'],
  stats: ['trainer', 'admin'],
  syncqueue: ['trainer', 'admin'],
  profile: undefined,
  qualifications: ['admin', 'trainer', 'athlete'],
  kampfrichter: ['admin', 'referee'],
};
Object.entries(MODULE_ROLES).forEach(([id, r]) => registerModule({
  id, roles: r, icon: '<svg></svg>',
  async render(container) { rendered.push(id); container.replaceChildren(el('p', {}, id)); },
}));

const sideIds = () => [...document.querySelectorAll('#nav-list .nav-link')].map((b) => b.dataset.route);
const bottomIds = () => [...document.querySelectorAll('#bottomnav button[data-route]')].map((b) => b.dataset.route);
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  document.body.innerHTML = `
    <div id="app-shell">
      <button id="btn-view-switch" hidden></button>
      <ul id="nav-list"></ul><nav id="bottomnav" class="bottomnav"></nav>
    </div>
    <div id="toast-region"></div><div id="modal-root" hidden></div>`;
  localStorage.clear();
  history.replaceState(null, '', '#/');
  roles = ['trainer'];
  rendered.length = 0;
  setViewStorageScope('u1');
});

describe('buildNav() mit Ansicht', () => {
  it('ohne Ansicht bleibt die Navigation ungefiltert (bisheriges Verhalten)', () => {
    buildNav();
    expect(sideIds()).toContain('plans');
    expect(sideIds()).toContain('competitions');
  });

  it('zeigt nur Module der Ansicht plus gemeinsame Module', () => {
    setCurrentView('competition');
    buildNav();
    expect(sideIds().sort()).toEqual(['announcements', 'competitions', 'dashboard', 'profile', 'stats', 'syncqueue', 'times'].sort());
  });

  it('mobile Bottom-Nav: Dashboard, bis zu vier Fachmodule direkt, Profil — der Rest unter "Mehr"', () => {
    setCurrentView('training');
    buildNav();
    expect(bottomIds()).toEqual(['dashboard', 'plans', 'sessions', 'actionitems', 'stats', 'profile']);
    const more = document.querySelector('#bottomnav button:not([data-route])');
    expect(more.dataset.routeGroup.split(' ')).toEqual(expect.arrayContaining(['templates', 'catalog', 'sectionTemplates', 'announcements', 'syncqueue']));
  });

  it('Umschalt-Knopf zeigt die aktuelle Ansicht, wenn mehrere verfügbar sind', () => {
    setCurrentView('training');
    buildNav();
    const btn = document.getElementById('btn-view-switch');
    expect(btn.hidden).toBe(false);
    expect(btn.textContent).toBe('Trainingsplanung');
  });

  it('Umschalt-Knopf bleibt verborgen, wenn nur eine Ansicht verfügbar ist', () => {
    roles = ['referee'];
    setCurrentView('meetOrg');
    buildNav();
    expect(document.getElementById('btn-view-switch').hidden).toBe(true);
    expect(document.querySelector('#bottomnav button:not([data-route])')).toBeNull();
  });

  it('eine nicht mehr verfügbare Ansicht fällt auf die erste verfügbare zurück', () => {
    roles = ['athlete'];
    setCurrentView('meetOrg');
    buildNav();
    expect(getCurrentView()?.id).not.toBe('meetOrg');
  });

  it('"Mehr" bietet den Ansichtswechsel an', () => {
    setCurrentView('competition');
    buildNav();
    document.querySelector('#bottomnav button:not([data-route])').click();
    expect(document.querySelector('#modal-root .more-nav-view-switch')).not.toBeNull();
  });
});

describe('Ansichtswechsel', () => {
  it('switchView() filtert neu und springt auf die Startseite der Ansicht', () => {
    setCurrentView('training');
    buildNav();
    switchView('competition');
    expect(getCurrentView()?.id).toBe('competition');
    expect(location.hash).toBe('#/competitions');
    expect(sideIds()).not.toContain('plans');
  });

  it('der Wechsel-Dialog setzt das Häkchen sofort und wechselt per Klick', () => {
    setCurrentView('training');
    buildNav();
    document.getElementById('btn-view-switch').click();
    const checkbox = document.querySelector('#modal-root input[type="checkbox"]');
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));
    expect(getSkipViewPicker()).toBe(true);
    document.querySelector('#modal-root .view-card[data-view="admin"]').click();
    expect(getCurrentView()?.id).toBe('admin');
    expect(document.getElementById('modal-root').hidden).toBe(true);
  });
});

describe('renderRoute() außerhalb der Ansicht', () => {
  it('rendert die Route trotzdem und wechselt in eine passende Ansicht', async () => {
    setCurrentView('training');
    buildNav();
    const viewEl = document.createElement('div');
    await renderRoute(viewEl, { routeId: 'times', params: [] });
    expect(rendered).toEqual(['times']);
    expect(getCurrentView()?.id).toBe('competition');
    expect(sideIds()).toContain('times');
    expect(document.getElementById('toast-region').textContent).toContain('Wettkampfteilnahme');
  });

  it('gemeinsame Module lösen keinen Wechsel aus', async () => {
    setCurrentView('training');
    await renderRoute(document.createElement('div'), { routeId: 'profile', params: [] });
    expect(getCurrentView()?.id).toBe('training');
  });

  it('defaultModuleFor() nimmt die Startseite der aktuellen Ansicht', () => {
    setCurrentView('competition');
    expect(defaultModuleFor(['trainer'])).toMatchObject({ id: 'competitions' });
  });
});

describe('initViews() beim Start', () => {
  it('zeigt die Auswahl, übernimmt die Wahl samt Häkchen und liefert deren Startseite', async () => {
    const pending = initViews('u1');
    await flush();
    const screen = document.querySelector('.view-picker-screen');
    expect(screen).not.toBeNull();
    expect(document.getElementById('app-shell').hasAttribute('inert')).toBe(true);
    screen.querySelector('input[type="checkbox"]').checked = true;
    screen.querySelector('.view-card[data-view="training"]').click();
    await expect(pending).resolves.toBe('plans');
    expect(document.querySelector('.view-picker-screen')).toBeNull();
    expect(document.getElementById('app-shell').hasAttribute('inert')).toBe(false);
    expect(getCurrentView()?.id).toBe('training');
    expect(getSkipViewPicker()).toBe(true);
  });

  it('mit Häkchen und gespeicherter Ansicht startet sie direkt dort', async () => {
    setCurrentView('competition');
    setSkipViewPicker(true);
    await expect(initViews('u1')).resolves.toBe('competitions');
    expect(document.querySelector('.view-picker-screen')).toBeNull();
  });

  it('ein Deep Link überspringt die Auswahl und behält die Route', async () => {
    history.replaceState(null, '', '#/times');
    await expect(initViews('u1')).resolves.toBeNull();
    expect(getCurrentView()?.id).toBe('competition');
    expect(document.querySelector('.view-picker-screen')).toBeNull();
  });

  it('bei nur einer Ansicht keine Auswahl und kein Sprung', async () => {
    roles = ['referee'];
    await expect(initViews('u1')).resolves.toBeNull();
    expect(getCurrentView()?.id).toBe('meetOrg');
    expect(document.querySelector('.view-picker-screen')).toBeNull();
  });

  it('ignoreRoute wertet die aktuelle Route nicht als Deep Link (Demo-Kontowechsel)', async () => {
    history.replaceState(null, '', '#/times');
    const pending = initViews('u1', { ignoreRoute: true });
    await flush();
    expect(document.querySelector('.view-picker-screen')).not.toBeNull();
    document.querySelector('.view-card').click();
    await pending;
  });
});
