// apps/web/test/qualifications.module.test.js
//
// Schlanker Import-/Formsanity-Test für modules/qualifications.js (docs/
// nutzer-qualifikationen-plan.md) — kein voller render()-Test (dafür gibt
// es im Repo kein etabliertes Muster, siehe andere modules/*.js: die
// Verifikation erfolgt dort über manuelles Testen im Browser). Dieser Test
// deckt trotzdem etwas Konkretes ab: der Import führt ALLE Top-Level-
// Importe der Datei aus (dom.js/dates.js/ui.js/modal.js/forms.js/state.js/
// refdata.js/i18n.js/apiClient.js) — ein falsch benannter Export (Tippfehler
// o. ä.) würde hier sofort mit einem Fehler auffallen, statt erst beim
// nächsten manuellen Öffnen der Seite im Browser.
import { describe, it, expect, vi } from 'vitest';

// state.js selbst importiert transitiv demoMode.js, das auf Modulebene
// `location.pathname` liest (in vitest.config.js läuft apps/web bewusst mit
// environment: 'node', siehe dortiger Kommentar — kein globales `location`,
// analog zur Begründung in test/state.test.js). qualifications.js braucht
// von state.js nur isAdmin(), daher genügt dieser schlanke Stub statt der
// dortigen vollen Mock-Kette (demoMode/apiClient/db/i18n).
vi.mock('../js/state.js', () => ({ isAdmin: () => false }));

import { qualificationsModule } from '../js/modules/qualifications.js';
import { isModuleVisible, MODULE_KEYS, CORE_MODULE_IDS } from '../js/router.js';

describe('qualificationsModule', () => {
  it('registriert sich mit der Router-ID "qualifications" und einem render()', () => {
    expect(qualificationsModule.id).toBe('qualifications');
    expect(typeof qualificationsModule.render).toBe('function');
  });

  it('ist für admin/trainer/athlete sichtbar, aber nicht für superadmin', () => {
    expect(qualificationsModule.roles).not.toContain('superadmin');
    for (const role of ['admin', 'trainer', 'athlete']) {
      expect(isModuleVisible(qualificationsModule, role, ['qualifications'])).toBe(true);
    }
  });

  it('ist NICHT Teil der immer sichtbaren Kern-Module (zubuchbar, siehe Plan Abschnitt 1.2)', () => {
    expect(CORE_MODULE_IDS).not.toContain('qualifications');
    expect(isModuleVisible(qualificationsModule, 'admin', [])).toBe(false);
  });

  it('"qualifications" ist als togglebares Modul-Paket bekannt (MODULE_KEYS in router.js — MUSS mit packages/shared-types/src/modules.ts: MODULE_PACKAGES übereinstimmen, siehe dortiger Kommentar zu ROUTE_TO_PACKAGE)', () => {
    expect(MODULE_KEYS).toContain('qualifications');
  });
});
