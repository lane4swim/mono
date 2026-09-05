// apps/web/test/kampfrichter.module.test.js
//
// Schlanker Import-/Formsanity-Test für modules/kampfrichter.js (docs/
// kampfrichter-modul-plan.md), analog test/qualifications.module.test.js —
// kein voller render()-Test (dafür gibt es im Repo kein etabliertes Muster,
// siehe andere modules/*.js: die Verifikation erfolgt dort über manuelles
// Testen im Browser). Dieser Test deckt trotzdem etwas Konkretes ab: der
// Import führt ALLE Top-Level-Importe der Datei aus (dom.js/dates.js/ui.js/
// modal.js/forms.js/state.js/refdata.js/qualifications.js/i18n.js/
// apiClient.js) — ein falsch benannter Export (Tippfehler o. ä.) würde hier
// sofort mit einem Fehler auffallen, statt erst beim nächsten manuellen
// Öffnen der Seite im Browser.
import { describe, it, expect, vi } from 'vitest';

// state.js selbst importiert transitiv demoMode.js, das auf Modulebene
// `location.pathname` liest (in vitest.config.js läuft apps/web bewusst mit
// environment: 'node', siehe dortiger Kommentar — kein globales `location`,
// analog zur Begründung in test/state.test.js). kampfrichter.js braucht von
// state.js nur isAdmin()/hasRole(), daher genügt dieser schlanke Stub statt
// der dortigen vollen Mock-Kette (demoMode/apiClient/db/i18n).
vi.mock('../js/state.js', () => ({ isAdmin: () => false, hasRole: () => false }));

import { kampfrichterModule } from '../js/modules/kampfrichter.js';
import { isModuleVisible, MODULE_KEYS, CORE_MODULE_IDS } from '../js/router.js';
import { REFEREE_FUNCTIONS } from '../js/refdata.js';
import { t } from '../js/i18n.js';

describe('kampfrichterModule', () => {
  it('registriert sich mit der Router-ID "kampfrichter" und einem render()', () => {
    expect(kampfrichterModule.id).toBe('kampfrichter');
    expect(typeof kampfrichterModule.render).toBe('function');
  });

  it('ist nur für admin und referee sichtbar, nicht für trainer/athlete/superadmin', () => {
    expect(kampfrichterModule.roles).toEqual(expect.arrayContaining(['admin', 'referee']));
    for (const role of ['admin', 'referee']) {
      expect(isModuleVisible(kampfrichterModule, role, ['kampfrichter'])).toBe(true);
    }
    for (const role of ['trainer', 'athlete', 'superadmin']) {
      expect(isModuleVisible(kampfrichterModule, role, ['kampfrichter'])).toBe(false);
    }
  });

  it('ist NICHT Teil der immer sichtbaren Kern-Module (zubuchbar, siehe Plan Abschnitt 4.2)', () => {
    expect(CORE_MODULE_IDS).not.toContain('kampfrichter');
    expect(isModuleVisible(kampfrichterModule, 'admin', [])).toBe(false);
  });

  it('"kampfrichter" ist als togglebares Modul-Paket bekannt (MODULE_KEYS in router.js — MUSS mit packages/shared-types/src/modules.ts: MODULE_PACKAGES übereinstimmen)', () => {
    expect(MODULE_KEYS).toContain('kampfrichter');
  });

  it('jede REFEREE_FUNCTIONS-Konstante hat eine übersetzte refdata.refereeFunctions-Beschriftung', () => {
    for (const fn of REFEREE_FUNCTIONS) {
      expect(t(`refdata.refereeFunctions.${fn.value}`)).not.toBe(`refdata.refereeFunctions.${fn.value}`);
    }
  });
});
