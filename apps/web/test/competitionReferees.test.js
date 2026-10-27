// Kampfgericht eines Wettkampfs (js/modules/competitionReferees.js):
// Formularwert der Kampfrichter-Anzahl und Besetzungsstand.
import { describe, it, expect, vi } from 'vitest';

// Wie in test/kampfrichter.module.test.js: demoMode.js liest auf
// Modulebene `location` (environment: 'node'), state.js zieht es nach.
const state = vi.hoisted(() => ({ admin: true, modules: ['kampfrichter'] }));
vi.mock('../js/state.js', () => ({
  isAdmin: () => state.admin,
  hasRole: () => false,
  getEnabledModules: () => state.modules,
}));
vi.mock('../js/demoMode.js', () => ({ IS_DEMO: false }));

import { parseRefereesRequired, refereeStaffing, canAssignReferees, MAX_REFEREES_REQUIRED } from '../js/modules/competitionReferees.js';
import { t } from '../js/i18n.js';

describe('parseRefereesRequired', () => {
  it('leer heißt keine Vorgabe', () => {
    expect(parseRefereesRequired('')).toBeNull();
    expect(parseRefereesRequired('  ')).toBeNull();
    expect(parseRefereesRequired(undefined)).toBeNull();
  });

  it('übernimmt ganze Zahlen von 0 bis zum Maximum', () => {
    expect(parseRefereesRequired('0')).toBe(0);
    expect(parseRefereesRequired(' 3 ')).toBe(3);
    expect(parseRefereesRequired(String(MAX_REFEREES_REQUIRED))).toBe(MAX_REFEREES_REQUIRED);
  });

  it('lehnt negative, gebrochene, zu große und nicht-numerische Werte ab', () => {
    for (const value of ['-1', '1.5', '2,5', String(MAX_REFEREES_REQUIRED + 1), 'drei', '1e2']) {
      expect(parseRefereesRequired(value), value).toBeUndefined();
    }
  });
});

describe('refereeStaffing', () => {
  const a = (status) => ({ status });

  it('zählt Zusagen, offene Anfragen und Absagen; Absagen füllen keinen Platz', () => {
    const s = refereeStaffing(4, [a('confirmed'), a('requested'), a('declined'), a('confirmed')]);
    expect(s).toEqual({ required: 4, confirmed: 2, requested: 1, declined: 1, missing: 1, complete: false });
  });

  it('voll besetzt erst mit genügend Zusagen', () => {
    expect(refereeStaffing(2, [a('confirmed'), a('requested')]).complete).toBe(false);
    expect(refereeStaffing(2, [a('confirmed'), a('requested')]).missing).toBe(0);
    expect(refereeStaffing(2, [a('confirmed'), a('confirmed'), a('confirmed')])).toMatchObject({ complete: true, missing: 0 });
    expect(refereeStaffing(0, []).complete).toBe(true);
  });

  it('ohne Vorgabe: nichts fehlt, nie "voll besetzt"', () => {
    expect(refereeStaffing(null, [a('confirmed')])).toEqual({ required: null, confirmed: 1, requested: 0, declined: 0, missing: 0, complete: false });
    expect(refereeStaffing(undefined, []).required).toBeNull();
  });
});

describe('canAssignReferees', () => {
  it('nur admin mit gebuchtem Kampfrichter-Modul', () => {
    state.admin = true; state.modules = ['kampfrichter'];
    expect(canAssignReferees()).toBe(true);
    state.modules = ['competitions'];
    expect(canAssignReferees()).toBe(false);
    state.admin = false; state.modules = ['kampfrichter'];
    expect(canAssignReferees()).toBe(false);
  });
});

describe('Übersetzungen', () => {
  it('alle neuen Schlüssel sind übersetzt', () => {
    for (const key of ['formRefereesRequired', 'formRefereesRequiredHint', 'validationRefereesRequired', 'refereesTitle', 'refereesRequiredInfo',
      'refereesConfirmedOf', 'refereesMissing', 'refereesNoTarget', 'refereesNone', 'refereesAssign', 'refereesAssignTitle',
      'refereesFormPerson', 'refereesAssignHint', 'refereesAssignSubmit', 'refereesAssigned', 'refereesRemoveConfirm']) {
      expect(t(`competitions.${key}`)).not.toBe(`competitions.${key}`);
    }
  });
});
