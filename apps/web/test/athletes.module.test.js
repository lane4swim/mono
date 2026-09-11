// Schlanker Import-/Formsanity-Test für modules/athletes.js, analog
// test/kampfrichter.module.test.js — kein voller render()-Test, aber der
// Import deckt bereits jeden Top-Level-Import der Datei ab (inkl. des
// neuen Imports von fetchAssignableTrainers aus modules/actionItems.js,
// docs/Plans/vereinsverwaltung-phase3-plan.md Abschnitt 1.3).
import { describe, it, expect, vi } from 'vitest';

// db.js/state.js importieren transitiv demoMode.js, das auf Modulebene
// `location.pathname` liest (siehe kampfrichter.module.test.js-Kommentar).
vi.mock('../js/demoMode.js', () => ({ IS_DEMO: false }));
vi.mock('../js/state.js', () => ({ isAdminOrSuperAdmin: () => false, isAthleteScoped: () => false, getCurrentUser: () => null }));

import { athletesModule } from '../js/modules/athletes.js';
import { isModuleVisible } from '../js/router.js';

describe('athletesModule', () => {
  it('registriert sich mit der Router-ID "athletes" und einem render()', () => {
    expect(athletesModule.id).toBe('athletes');
    expect(typeof athletesModule.render).toBe('function');
  });

  it('ist nur für trainer/admin sichtbar, nicht für athlete', () => {
    for (const role of ['trainer', 'admin']) {
      expect(isModuleVisible(athletesModule, role, ['athletes'])).toBe(true);
    }
    expect(isModuleVisible(athletesModule, 'athlete', ['athletes'])).toBe(false);
  });
});
