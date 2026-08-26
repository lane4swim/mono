// apps/web/test/router.test.js
//
// Testet js/router.js: visibleModules()/isModuleVisible() — die
// Sichtbarkeitsregel für "Module pro Verein aktivierbar" (Kern-Module
// immer sichtbar, Fach-Module nur wenn ihr Paket in enabledModules steht),
// kombiniert mit der bereits bestehenden Rollen-Filterung.
import { describe, it, expect } from 'vitest';
import { registerModule, visibleModules, isModuleVisible, CORE_MODULE_IDS, MODULE_KEYS } from '../js/router.js';

registerModule({ id: 'dashboard', roles: undefined });
registerModule({ id: 'competitions', roles: ['trainer', 'admin'] });
registerModule({ id: 'times', roles: ['trainer', 'admin', 'athlete'] });
registerModule({ id: 'usermgmt', roles: ['superadmin', 'admin'] });

describe('CORE_MODULE_IDS / MODULE_KEYS', () => {
  it('sind disjunkt — kein Modul ist gleichzeitig Kern und togglebar', () => {
    for (const id of CORE_MODULE_IDS) expect(MODULE_KEYS).not.toContain(id);
  });
});

describe('isModuleVisible()', () => {
  it('Kern-Module (z. B. dashboard) sind immer sichtbar, unabhängig von enabledModules', () => {
    const dashboard = { id: 'dashboard' };
    expect(isModuleVisible(dashboard, 'trainer', [])).toBe(true);
    expect(isModuleVisible(dashboard, 'athlete', [])).toBe(true);
  });

  it('ein Fach-Modul ohne enabledModules-Eintrag ist NICHT sichtbar, selbst bei passender Rolle', () => {
    const competitions = { id: 'competitions', roles: ['trainer', 'admin'] };
    expect(isModuleVisible(competitions, 'trainer', [])).toBe(false);
    expect(isModuleVisible(competitions, 'trainer', ['times'])).toBe(false);
  });

  it('ein Fach-Modul ist sichtbar, wenn Rolle UND enabledModules beide passen', () => {
    const competitions = { id: 'competitions', roles: ['trainer', 'admin'] };
    expect(isModuleVisible(competitions, 'trainer', ['competitions'])).toBe(true);
    expect(isModuleVisible(competitions, 'athlete', ['competitions'])).toBe(false); // Rolle bleibt zusätzlich maßgeblich
  });

  it('Default-Parameter (kein enabledModules übergeben) zeigt weiterhin alles — Rückwärtskompatibilität für Aufrufer vor der Anbindung', () => {
    const competitions = { id: 'competitions', roles: ['trainer', 'admin'] };
    expect(isModuleVisible(competitions, 'trainer')).toBe(true);
  });
});

describe('visibleModules(role, enabledModules)', () => {
  it('filtert gleichzeitig nach Rolle UND gebuchten Modulen', () => {
    const ids = visibleModules('trainer', ['times']).map((m) => m.id);
    expect(ids).toContain('dashboard'); // Kern
    expect(ids).toContain('times'); // gebucht + Rolle passt
    expect(ids).not.toContain('competitions'); // nicht gebucht
    expect(ids).not.toContain('usermgmt'); // Rolle passt nicht
  });

  it('ein Verein ohne jedes Fach-Modul sieht nur noch die Kern-Module', () => {
    const ids = visibleModules('trainer', []).map((m) => m.id);
    expect(ids).toEqual(['dashboard']);
  });
});
