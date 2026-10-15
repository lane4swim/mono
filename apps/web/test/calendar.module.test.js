// @vitest-environment jsdom
//
// UI des Kalendermoduls (js/modules/calendar.js): verfügbare Termintypen je
// Rolle/Paket, Ansichtswechsel, Typ-Filter und Scope-Umschaltung — gegen
// gemockte Stores/REST-Endpunkte, mit fest eingestelltem "heute".
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const session = vi.hoisted(() => ({
  user: null,
  roles: [],
  enabledModules: [],
  demo: false,
}));

vi.mock('../js/demoMode.js', () => ({ get IS_DEMO() { return session.demo; } }));
vi.mock('../js/state.js', () => ({
  getCurrentUser: () => session.user,
  getRoles: () => session.roles,
  getEnabledModules: () => session.enabledModules,
  hasRole: (r) => session.roles.includes(r),
  isAdmin: () => session.roles.includes('admin'),
  isTrainerOrAdmin: () => session.roles.some((r) => ['trainer', 'admin'].includes(r)),
  isAthleteScoped: () => session.roles.includes('athlete') && !session.roles.some((r) => ['trainer', 'admin'].includes(r)),
}));

const stores = vi.hoisted(() => ({}));
vi.mock('../js/db.js', () => ({ getAll: vi.fn(async (name) => stores[name] || []) }));

const apiMocks = vi.hoisted(() => ({
  listMyQualifications: vi.fn(),
  listMyRefereeAssignments: vi.fn(),
}));
vi.mock('../js/apiClient.js', () => ({ ...apiMocks, describeError: (e) => String(e) }));

const { calendarModule, availableTypes, periodLabel } = await import('../js/modules/calendar.js');
const { registerModule, MODULES, MODULE_KEYS, isModuleVisible } = await import('../js/router.js');
const { t } = await import('../js/i18n.js');

// Stubs der Fachmodule mit ihren echten Rollen — calendar.js prüft deren
// Sichtbarkeit über router.js, rendert sie aber nie.
for (const [id, roles] of Object.entries({
  plans: ['trainer', 'athlete'], sessions: ['trainer', 'athlete'], attendance: ['admin'],
  competitions: ['trainer', 'admin'], actionitems: ['trainer', 'admin', 'athlete'],
  qualifications: ['admin', 'trainer', 'athlete'], kampfrichter: ['admin', 'referee'],
})) {
  if (!MODULES.some((m) => m.id === id)) registerModule({ id, roles, render() {} });
}

function seed() {
  Object.assign(stores, {
    groups: [{ id: 'g-a', name: 'Leistungsgruppe', trainerIds: ['u-trainer'] }, { id: 'g-b', name: 'Nachwuchs', trainerIds: ['u-other'] }],
    athletes: [{ id: 'a-maya', firstName: 'Maya', lastName: 'Vogel', groupId: 'g-a' }, { id: 'a-lukas', firstName: 'Lukas', lastName: 'Weber', groupId: 'g-b' }],
    plans: [
      { id: 'p-a', name: 'Plan Leistung', groupId: 'g-a', days: [{ date: '2026-10-14', sets: [] }] },
      { id: 'p-b', name: 'Plan Nachwuchs', groupId: 'g-b', days: [{ date: '2026-10-13', sets: [] }] },
    ],
    sessions: [],
    competitions: [{ id: 'c1', name: 'Bezirksmeisterschaften', date: '2026-10-28', location: 'Nord', course: 'SCM' }],
    entries: [{ id: 'e1', competitionId: 'c1', athleteId: 'a-maya' }],
    actionItems: [{ id: 'ai1', athleteId: 'a-maya', title: 'Wenden verbessern', status: 'offen', assignedTrainerId: 'u-trainer', dueDate: '2026-10-20' }],
  });
}

function loginAs(kind) {
  if (kind === 'trainer') {
    session.user = { id: 'u-trainer', athleteId: null };
    session.roles = ['trainer'];
  } else if (kind === 'athlete') {
    session.user = { id: 'u-maya', athleteId: 'a-maya' };
    session.roles = ['athlete'];
  } else if (kind === 'referee') {
    session.user = { id: 'u-ref', athleteId: null };
    session.roles = ['referee'];
  }
  session.enabledModules = [...MODULE_KEYS];
}

async function render(params = ['month', '2026-10-15']) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  await calendarModule.render(container, params);
  return container;
}

const chipTitles = (c) => [...c.querySelectorAll('.cal-chip-title')].map((n) => n.textContent);
const filterButton = (c, type) => c.querySelector(`.cal-filter.cal-type-${type}`);
const segButton = (c, label) => [...c.querySelectorAll('.cal-seg')].find((b) => b.textContent === label);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-15T10:00:00Z'));
  for (const k of Object.keys(stores)) delete stores[k];
  seed();
  session.demo = false;
  localStorage.clear();
  apiMocks.listMyQualifications.mockReset().mockResolvedValue({ qualifications: [] });
  apiMocks.listMyRefereeAssignments.mockReset().mockResolvedValue({ assignments: [] });
  document.body.innerHTML = '';
  history.replaceState(null, '', '#/calendar');
});

afterEach(() => {
  vi.useRealTimers();
});

describe('calendarModule', () => {
  it('ist Kernmodul für trainer/admin/athlete/referee, nicht für parent/superadmin', () => {
    for (const role of ['trainer', 'admin', 'athlete', 'referee']) expect(isModuleVisible(calendarModule, role, [])).toBe(true);
    expect(isModuleVisible(calendarModule, 'parent', MODULE_KEYS)).toBe(false);
    expect(isModuleVisible(calendarModule, 'superadmin', MODULE_KEYS)).toBe(false);
  });

  it('Termintypen folgen Rollen und gebuchten Paketen', () => {
    loginAs('trainer');
    expect(availableTypes()).toEqual(['competition', 'deadline', 'qualification', 'training', 'session']);
    session.enabledModules = MODULE_KEYS.filter((k) => k !== 'competitions' && k !== 'plans');
    expect(availableTypes()).toEqual(['deadline', 'qualification', 'session']);
    loginAs('referee');
    expect(availableTypes()).toEqual(['referee']);
    session.demo = true;
    expect(availableTypes()).toEqual([]);
  });

  it('Monatsansicht: Trainer:in sieht standardmäßig nur die eigenen Termine', async () => {
    loginAs('trainer');
    const c = await render();
    expect(c.querySelector('.cal-period').textContent).toBe(periodLabel('month', '2026-10-15'));
    const titles = chipTitles(c.querySelector('.cal-month'));
    expect(titles).toContain('Plan Leistung');
    expect(titles).toContain('Wenden verbessern');
    expect(titles).toContain('Bezirksmeisterschaften');
    expect(titles).not.toContain('Plan Nachwuchs');
    expect(c.querySelector('.cal-month-cell.today .cal-daynum').textContent).toBe('15');
  });

  it('"Ganzer Verein" zeigt auch fremde Gruppen und wird gemerkt', async () => {
    loginAs('trainer');
    let c = await render();
    segButton(c, t('calendar.scopeAll')).click();
    expect(chipTitles(c.querySelector('.cal-month'))).toContain('Plan Nachwuchs');
    c.remove();
    c = await render();
    expect(segButton(c, t('calendar.scopeAll')).getAttribute('aria-pressed')).toBe('true');
  });

  it('Typ-Filter blendet Termine aus und zählt je Typ', async () => {
    loginAs('trainer');
    const c = await render();
    const training = filterButton(c, 'training');
    expect(training.getAttribute('aria-pressed')).toBe('true');
    expect(training.querySelector('.cal-count').textContent).toBe('1');
    training.click();
    expect(filterButton(c, 'training').getAttribute('aria-pressed')).toBe('false');
    expect(chipTitles(c.querySelector('.cal-month'))).not.toContain('Plan Leistung');
    expect(chipTitles(c.querySelector('.cal-month'))).toContain('Wenden verbessern');
    expect(JSON.parse(localStorage.getItem('lane1.calendar.types.u-trainer'))).not.toContain('training');

    c.querySelector('.cal-filter-all').click(); // alle wieder an
    expect(chipTitles(c.querySelector('.cal-month'))).toContain('Plan Leistung');
    c.querySelector('.cal-filter-all').click(); // alle aus
    expect(c.querySelectorAll('.cal-month .cal-chip')).toHaveLength(0);
    expect(c.querySelector('.cal-agenda').textContent).toContain(t('calendar.noEvents'));
  });

  it('Ansichtswechsel und Blättern aktualisieren den Hash ohne Routenwechsel', async () => {
    loginAs('trainer');
    const c = await render();
    segButton(c, t('calendar.views.week')).click();
    expect(location.hash).toBe('#/calendar/week/2026-10-15');
    expect(c.querySelectorAll('.cal-week-day')).toHaveLength(7);
    expect(c.querySelector('.cal-week-day.today')).not.toBeNull();
    c.querySelector(`[aria-label="${t('calendar.next')}"]`).click();
    expect(location.hash).toBe('#/calendar/week/2026-10-22');
    expect(chipTitles(c.querySelector('.cal-week'))).toEqual(['Wenden verbessern']);

    segButton(c, t('calendar.views.year')).click();
    expect(c.querySelectorAll('.cal-mini-month')).toHaveLength(12);
    // Wiederkehrende Trainings nur als Punkte, nicht in "Wichtige Termine"
    const keyDates = chipTitles(c.querySelector('.cal-agenda'));
    expect(keyDates).toEqual(['Wenden verbessern', 'Bezirksmeisterschaften']);

    segButton(c, t('calendar.views.quarter')).click();
    expect(c.querySelectorAll('.cal-mini-month')).toHaveLength(3);
    expect(c.querySelector('.cal-period').textContent).toBe(t('calendar.quarterLabel', { quarter: 4, year: '2026' }));
  });

  it('Klick auf einen Tag im Mini-Monat öffnet dessen Woche', async () => {
    loginAs('trainer');
    const c = await render(['quarter', '2026-10-15']);
    const cell = [...c.querySelectorAll('.cal-mini-cell.has-events')].find((b) => b.textContent.startsWith('20'));
    cell.click();
    expect(location.hash).toBe('#/calendar/week/2026-10-20');
  });

  it('Athletin: kein Scope-Umschalter, nur eigene Termine; Wettkampf ohne Sprung ins (nicht sichtbare) Modul', async () => {
    loginAs('athlete');
    const c = await render();
    expect(segButton(c, t('calendar.scopeAll'))).toBeUndefined();
    const titles = chipTitles(c.querySelector('.cal-month'));
    expect(titles).toEqual(expect.arrayContaining(['Plan Leistung', 'Wenden verbessern', 'Bezirksmeisterschaften']));
    expect(titles).not.toContain('Plan Nachwuchs');
    const compChip = c.querySelector('.cal-month .cal-chip.cal-type-competition');
    expect(compChip.tagName).toBe('DIV');
    expect(c.querySelector('.cal-month .cal-chip.cal-type-training').tagName).toBe('BUTTON');
  });

  it('REST-Termine (Qualifikationen) erscheinen; ein Fehler blendet nur einen Hinweis ein', async () => {
    loginAs('trainer');
    apiMocks.listMyQualifications.mockResolvedValue({ qualifications: [{ id: 'q1', type: 'trainerC', expiresOn: '2026-10-30T00:00:00.000Z', renewalCourseOrganizedOn: null, note: '' }] });
    let c = await render();
    expect(c.querySelector('.cal-month .cal-chip.cal-type-qualification')).not.toBeNull();
    c.remove();

    apiMocks.listMyQualifications.mockRejectedValue(new Error('offline'));
    c = await render();
    expect(c.textContent).toContain(t('calendar.remoteUnavailable'));
    expect(chipTitles(c.querySelector('.cal-month'))).toContain('Plan Leistung');
  });

  it('Demo-Modus ruft keine REST-Endpunkte auf', async () => {
    loginAs('trainer');
    session.demo = true;
    await render();
    expect(apiMocks.listMyQualifications).not.toHaveBeenCalled();
    expect(apiMocks.listMyRefereeAssignments).not.toHaveBeenCalled();
  });

  it('ungültige Routenparameter fallen auf Monat/heute zurück', async () => {
    loginAs('trainer');
    const c = await render(['bogus', 'not-a-date']);
    expect(location.hash).toBe('#/calendar/month/2026-10-15');
    expect(c.querySelector('.cal-month')).not.toBeNull();
  });
});
