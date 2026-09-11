// Schlanker Import-/Formsanity-Test für modules/auditLog.js (docs/Plans/
// vereinsverwaltung-phase3-plan.md, Abschnitt 2.6), analog
// test/kampfrichter.module.test.js — kein voller render()-Test, aber der
// Import deckt bereits jeden Top-Level-Import der Datei ab (ein falsch
// benannter Export würde hier sofort auffallen).
import { describe, it, expect, vi } from 'vitest';

// demoMode.js liest location.pathname auf Modulebene (siehe
// kampfrichter.module.test.js-Kommentar für die Begründung des Stubs).
vi.mock('../js/demoMode.js', () => ({ IS_DEMO: false }));

import { auditLogModule } from '../js/modules/auditLog.js';
import { isModuleVisible, CORE_MODULE_IDS } from '../js/router.js';

describe('auditLogModule', () => {
  it('registriert sich mit der Router-ID "auditlog" und einem render()', () => {
    expect(auditLogModule.id).toBe('auditlog');
    expect(typeof auditLogModule.render).toBe('function');
  });

  it('ist nur für admin/superadmin sichtbar, nicht für trainer/athlete/referee', () => {
    for (const role of ['admin', 'superadmin']) {
      expect(isModuleVisible(auditLogModule, role, [])).toBe(true);
    }
    for (const role of ['trainer', 'athlete', 'referee']) {
      expect(isModuleVisible(auditLogModule, role, [])).toBe(false);
    }
  });

  it('ist Teil der immer sichtbaren Kern-Module (reine Infrastruktur, kein zubuchbares Paket)', () => {
    expect(CORE_MODULE_IDS).toContain('auditlog');
    expect(isModuleVisible(auditLogModule, 'admin', [])).toBe(true);
  });
});
