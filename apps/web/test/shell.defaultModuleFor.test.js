// apps/web/test/shell.defaultModuleFor.test.js
//
// Regressionstest für shell.js: defaultModuleFor() — deckt eine beim
// Anpassen des Rollenhandbuchs (docs/kampfrichter-modul-plan.md) entdeckte
// Lücke ab: ein reines Kampfrichter-Konto (roles: ['referee'], keine
// weitere Rolle) hat kein sichtbares Dashboard (dashboard.js: roles
// ['trainer','admin','athlete'] — referee fehlt dort bewusst) und wäre
// ohne Sonderbehandlung auf "Mein Profil" gelandet, dem ersten in
// moduleRegistry.js registrierten Modul ohne eigenes Rollen-Gate. Analog
// zur bereits bestehenden superadmin-Sonderbehandlung (DEFAULT_ROUTE_BY_ROLE)
// landet ein reines Kampfrichter-Konto jetzt stattdessen im
// Kampfrichter-Modul.
import { describe, it, expect, vi } from 'vitest';

// shell.js importiert db.js (transitiv demoMode.js, das auf Modulebene
// `location.pathname` liest — in vitest.config.js läuft apps/web bewusst
// mit environment: 'node', siehe test/qualifications.module.test.js) sowie
// state.js — beide werden hier durch schlanke Stubs ersetzt, da
// defaultModuleFor() von beiden nur getEnabledModules() braucht.
vi.mock('../js/db.js', () => ({ pendingSyncCount: async () => 0 }));
vi.mock('../js/state.js', () => ({
  getRoles: () => [],
  getCurrentUser: () => null,
  getEnabledModules: () => ['kampfrichter'],
}));

import { defaultModuleFor } from '../js/shell.js';
import { registerModule } from '../js/router.js';

registerModule({ id: 'dashboard', roles: ['trainer', 'admin', 'athlete'] });
registerModule({ id: 'profile', roles: undefined });
registerModule({ id: 'kampfrichter', roles: ['admin', 'referee'] });
registerModule({ id: 'usermgmt', roles: ['superadmin', 'admin'] });

describe('defaultModuleFor()', () => {
  it('ein reines Kampfrichter-Konto landet im Kampfrichter-Modul, nicht im ersten rollenoffenen Modul (Profil)', () => {
    expect(defaultModuleFor(['referee'])).toMatchObject({ id: 'kampfrichter' });
  });

  it('trägt das Konto zusätzlich eine andere Rolle, bleibt deren reguläre Startseite maßgeblich', () => {
    expect(defaultModuleFor(['trainer', 'referee'])).toMatchObject({ id: 'dashboard' });
  });

  it('superadmin landet unverändert in der Nutzerverwaltung (bestehendes Verhalten, Regressionsschutz)', () => {
    expect(defaultModuleFor(['superadmin'])).toMatchObject({ id: 'usermgmt' });
  });
});
