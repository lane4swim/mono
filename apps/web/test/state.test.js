// apps/web/test/state.test.js
//
// Testet js/state.js — bisher ungetestet. demoMode.js wird gemockt (liest
// `location.pathname` auf Modulebene, in einer reinen Node-Testumgebung
// nicht vorhanden), apiClient.js und db.js werden ebenfalls gemockt, da
// dieser Test ausschließlich getRole()/isLoggedIn() ohne aktive Sitzung
// prüft und keinen echten Netzwerk-/IndexedDB-Zugriff braucht.
import { describe, it, expect, vi } from 'vitest';

vi.mock('../js/demoMode.js', () => ({ IS_DEMO: false }));
vi.mock('../js/apiClient.js', () => ({}));
vi.mock('../js/db.js', () => ({ wipeAll: vi.fn(), setClubIdProvider: vi.fn() }));
vi.mock('../js/i18n.js', () => ({ setLocale: vi.fn(), detectInitialLocale: vi.fn(() => 'de-DE') }));

import { getRole, getCurrentUser, isLoggedIn, isTrainerOrAdmin, isAdmin, isSuperAdmin, isAdminOrSuperAdmin } from '../js/state.js';

// Regressionstest für die Code-Review-Korrektur: getRole() fiel bei
// fehlender Sitzung auf die konkrete Rolle 'trainer' zurück, statt zu
// verweigern — ein Default-Wert sollte im Zweifel zusperren, nicht öffnen.
describe('getRole() ohne aktive Sitzung', () => {
  it('liefert null, NICHT mehr eine konkrete Rolle wie "trainer"', () => {
    expect(getCurrentUser()).toBeNull();
    expect(isLoggedIn()).toBe(false);
    expect(getRole()).toBeNull();
  });

  it('sämtliche Rollen-Prüfungen fallen ohne Sitzung konsistent negativ aus', () => {
    expect(isTrainerOrAdmin()).toBe(false);
    expect(isAdmin()).toBe(false);
    expect(isSuperAdmin()).toBe(false);
    expect(isAdminOrSuperAdmin()).toBe(false);
  });
});
