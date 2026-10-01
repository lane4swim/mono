// @vitest-environment jsdom
//
// Tests für js/views.js: welche Ansichten einer Person zur Verfügung
// stehen, die Startentscheidung (Auswahl zeigen oder nicht) und die
// gerätebezogenen Vorlieben in localStorage.
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { registerModule } from '../js/router.js';
import {
  VIEWS, COMMON_MODULE_IDS, availableViews, viewForRoute, defaultRouteOf, isRouteInView, getView,
  setViewStorageScope, setCurrentView, getCurrentView, getStoredViewId, getSkipViewPicker, setSkipViewPicker,
  resolveStartupView,
} from '../js/views.js';

// Rollen-Gates wie in den echten Modulen (js/modules/*.js).
const MODULE_ROLES = {
  dashboard: ['trainer', 'admin', 'athlete'],
  parent: ['parent'],
  athletes: ['trainer', 'admin'],
  competitions: ['trainer', 'admin'],
  times: ['trainer', 'admin', 'athlete'],
  plans: ['trainer', 'athlete'],
  templates: ['trainer'],
  catalog: ['trainer'],
  sectionTemplates: ['trainer'],
  sessions: ['trainer', 'athlete'],
  attendance: ['admin'],
  actionitems: ['trainer', 'admin', 'athlete'],
  announcements: ['trainer', 'admin', 'athlete'],
  stats: ['trainer', 'admin'],
  syncqueue: ['trainer', 'admin'],
  profile: undefined,
  usermgmt: ['superadmin', 'admin'],
  info: undefined,
  qualifications: ['admin', 'trainer', 'athlete'],
  kampfrichter: ['admin', 'referee'],
  auditlog: ['admin', 'superadmin'],
};
Object.entries(MODULE_ROLES).forEach(([id, roles]) => registerModule({ id, roles }));

const ALL_PACKAGES = ['athletes', 'competitions', 'times', 'plans', 'templates', 'catalog', 'sectionTemplates', 'sessions', 'actionitems', 'announcements', 'stats', 'qualifications', 'kampfrichter'];
const ids = (views) => views.map((v) => v.id);

describe('VIEWS', () => {
  it('gemeinsame Module stehen in keiner Ansicht (sonst begründeten sie einen Ansichtswechsel)', () => {
    expect(VIEWS.flatMap((v) => v.moduleIds).filter((id) => COMMON_MODULE_IDS.includes(id))).toEqual([]);
  });
});

describe('availableViews()', () => {
  it('Admin mit allen Paketen sieht alle vier Ansichten', () => {
    expect(ids(availableViews(['admin'], ALL_PACKAGES))).toEqual(['admin', 'training', 'competition', 'meetOrg']);
  });

  it('Trainer:in sieht Verwaltung, Trainingsplanung und Wettkampfteilnahme, aber keine Wettkampforganisation', () => {
    expect(ids(availableViews(['trainer'], ALL_PACKAGES))).toEqual(['admin', 'training', 'competition']);
  });

  it('ein reines Kampfrichter-Konto sieht nur die Wettkampforganisation', () => {
    expect(ids(availableViews(['referee'], ALL_PACKAGES))).toEqual(['meetOrg']);
  });

  it('Superadmin sieht nur die Verwaltung', () => {
    expect(ids(availableViews(['superadmin'], []))).toEqual(['admin']);
  });

  it('ein Eltern-Konto hat keine Ansicht (nur gemeinsame Module)', () => {
    expect(availableViews(['parent'], ALL_PACKAGES)).toEqual([]);
  });

  it('ein abbestelltes Paket blendet eine Ansicht aus, die dadurch leer würde', () => {
    const withoutCompetition = ALL_PACKAGES.filter((p) => !['competitions', 'times', 'stats'].includes(p));
    expect(ids(availableViews(['trainer'], withoutCompetition))).not.toContain('competition');
  });

  it('mehrere Rollen ergeben die Vereinigung der Ansichten', () => {
    expect(ids(availableViews(['trainer', 'referee'], ALL_PACKAGES))).toEqual(['admin', 'training', 'competition', 'meetOrg']);
  });
});

describe('Routen und Ansichten', () => {
  it('isRouteInView(): gemeinsame Module passen in jede Ansicht, ohne Ansicht passt alles', () => {
    expect(isRouteInView('dashboard', getView('meetOrg'))).toBe(true);
    expect(isRouteInView('plans', getView('competition'))).toBe(false);
    expect(isRouteInView('plans', null)).toBe(true);
  });

  it('viewForRoute() liefert die erste verfügbare Ansicht mit der Route, nie eine für gemeinsame Module', () => {
    expect(viewForRoute('times', VIEWS)?.id).toBe('competition');
    expect(viewForRoute('attendance', VIEWS)?.id).toBe('admin');
    expect(viewForRoute('attendance', [getView('training')])?.id).toBe('training');
    expect(viewForRoute('dashboard', VIEWS)).toBeNull();
  });

  it('defaultRouteOf() überspringt Module, die die Person nicht sehen darf', () => {
    expect(defaultRouteOf(getView('admin'), ['admin'], ALL_PACKAGES)).toBe('athletes');
    expect(defaultRouteOf(getView('admin'), ['superadmin'], [])).toBe('usermgmt');
    expect(defaultRouteOf(getView('admin'), ['athlete'], ALL_PACKAGES)).toBe('qualifications');
  });
});

describe('resolveStartupView()', () => {
  const available = [getView('admin'), getView('training'), getView('competition')];

  it('keine Ansicht -> keine Auswahl, kein Filter', () => {
    expect(resolveStartupView({ available: [], storedViewId: null, skipPicker: false, routeId: null }))
      .toEqual({ viewId: null, showPicker: false });
  });

  it('genau eine Ansicht -> diese, ohne Auswahl', () => {
    expect(resolveStartupView({ available: [getView('meetOrg')], storedViewId: null, skipPicker: false, routeId: null }))
      .toEqual({ viewId: 'meetOrg', showPicker: false });
  });

  it('mehrere Ansichten ohne Häkchen -> Auswahl mit zuletzt genutzter Ansicht vorausgewählt', () => {
    expect(resolveStartupView({ available, storedViewId: 'competition', skipPicker: false, routeId: null }))
      .toEqual({ viewId: 'competition', showPicker: true });
  });

  it('Häkchen gesetzt und gespeicherte Ansicht gültig -> direkt diese, ohne Auswahl', () => {
    expect(resolveStartupView({ available, storedViewId: 'training', skipPicker: true, routeId: null }))
      .toEqual({ viewId: 'training', showPicker: false });
  });

  it('Häkchen gesetzt, aber gespeicherte Ansicht nicht mehr verfügbar -> Auswahl trotzdem zeigen', () => {
    expect(resolveStartupView({ available, storedViewId: 'meetOrg', skipPicker: true, routeId: null }))
      .toEqual({ viewId: 'admin', showPicker: true });
  });

  it('Deep Link auf ein Fachmodul -> passende Ansicht ohne Auswahl', () => {
    expect(resolveStartupView({ available, storedViewId: 'training', skipPicker: false, routeId: 'times' }))
      .toEqual({ viewId: 'competition', showPicker: false });
  });

  it('Deep Link, den die gespeicherte Ansicht bereits enthält -> diese bleibt', () => {
    expect(resolveStartupView({ available, storedViewId: 'training', skipPicker: false, routeId: 'attendance' }))
      .toEqual({ viewId: 'training', showPicker: false });
  });
});

describe('Gerätebezogene Vorlieben (localStorage)', () => {
  beforeEach(() => { localStorage.clear(); setViewStorageScope('user-a'); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('setCurrentView() merkt sich die Ansicht als zuletzt genutzt', () => {
    setCurrentView('training');
    expect(getCurrentView()?.id).toBe('training');
    expect(getStoredViewId()).toBe('training');
  });

  it('eine unbekannte Ansicht hebt den Filter auf und überschreibt nichts', () => {
    setCurrentView('training');
    setCurrentView('gibt-es-nicht');
    expect(getCurrentView()).toBeNull();
    expect(getStoredViewId()).toBe('training');
  });

  it('das Häkchen lässt sich setzen und wieder entfernen', () => {
    expect(getSkipViewPicker()).toBe(false);
    setSkipViewPicker(true);
    expect(getSkipViewPicker()).toBe(true);
    setSkipViewPicker(false);
    expect(getSkipViewPicker()).toBe(false);
  });

  it('Vorlieben sind je Konto getrennt', () => {
    setCurrentView('competition');
    setSkipViewPicker(true);
    setViewStorageScope('user-b');
    expect(getStoredViewId()).toBeNull();
    expect(getSkipViewPicker()).toBe(false);
    setViewStorageScope('user-a');
    expect(getStoredViewId()).toBe('competition');
    expect(getSkipViewPicker()).toBe(true);
  });

  it('ohne Scope (vor dem Login) wird nichts gespeichert', () => {
    setViewStorageScope(null);
    setCurrentView('training');
    setSkipViewPicker(true);
    expect(localStorage.length).toBe(0);
  });

  it('blockierter Speicher wirft nicht — es gilt dann "nichts gespeichert"', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('SecurityError'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('SecurityError'); });
    expect(() => setCurrentView('training')).not.toThrow();
    expect(() => setSkipViewPicker(true)).not.toThrow();
    expect(getStoredViewId()).toBeNull();
    expect(getSkipViewPicker()).toBe(false);
  });
});
