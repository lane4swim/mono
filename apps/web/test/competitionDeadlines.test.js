// Fristen eines Wettkampfs (js/modules/competitionDeadlines.js):
// Vorschlagswert der internen Startauswahl und Plausibilitätsprüfung.
import { describe, it, expect } from 'vitest';
import { defaultSelectionDeadline, validateDeadlines } from '../js/modules/competitionDeadlines.js';

describe('defaultSelectionDeadline', () => {
  it('ohne Meldeschluss: drei Wochen vor dem Wettkampf', () => {
    expect(defaultSelectionDeadline({ date: '2026-11-21' })).toBe('2026-10-31');
    expect(defaultSelectionDeadline({ date: '2026-11-21T00:00:00.000Z', entryDeadline: null })).toBe('2026-10-31');
  });

  it('mit Meldeschluss: eine Woche davor', () => {
    expect(defaultSelectionDeadline({ date: '2026-11-21', entryDeadline: '2026-11-07' })).toBe('2026-10-31');
    expect(defaultSelectionDeadline({ date: '2026-11-21', entryDeadline: '2026-11-14T00:00:00.000Z' })).toBe('2026-11-07');
  });

  it('über Monats- und Jahresgrenzen', () => {
    expect(defaultSelectionDeadline({ date: '2027-01-10' })).toBe('2026-12-20');
    expect(defaultSelectionDeadline({ entryDeadline: '2026-03-03' })).toBe('2026-02-24');
  });

  it('ohne Datum: leer', () => {
    expect(defaultSelectionDeadline({})).toBe('');
    expect(defaultSelectionDeadline()).toBe('');
  });
});

describe('validateDeadlines', () => {
  it('fehlende Fristen sind gültig', () => {
    expect(validateDeadlines({ date: '2026-11-21' })).toBeNull();
    expect(validateDeadlines({ date: '2026-11-21', entryDeadline: '', selectionDeadline: null })).toBeNull();
  });

  it('akzeptiert Fristen bis einschließlich zum Wettkampftag', () => {
    expect(validateDeadlines({ date: '2026-11-21', entryDeadline: '2026-11-21', selectionDeadline: '2026-11-21' })).toBeNull();
  });

  it('lehnt Fristen nach dem Wettkampf ab', () => {
    expect(validateDeadlines({ date: '2026-11-21', entryDeadline: '2026-11-22' })).toBe('validationEntryDeadline');
    expect(validateDeadlines({ date: '2026-11-21', selectionDeadline: '2026-11-22' })).toBe('validationSelectionDeadline');
  });

  it('lehnt eine interne Auswahl nach dem Meldeschluss ab', () => {
    expect(validateDeadlines({ date: '2026-11-21', entryDeadline: '2026-11-07', selectionDeadline: '2026-11-08' })).toBe('validationSelectionAfterEntry');
  });
});
