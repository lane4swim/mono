// Von Hand erfasste Pflichtzeiten und Normtabellen
// (docs/Plans/pflichtzeiten-manuell-plan.md).
import { describe, it, expect } from 'vitest';
import {
  RequiredTimeRuleSchema,
  ManualRequirementsSchema,
  RequiredTimeSetSchema,
  CompetitionSchema,
  ENTITY_SCHEMAS,
} from '../src/entities.js';
import { MODULE_PACKAGES } from '../src/modules.js';

const CLUB_ID = '11111111-1111-1111-1111-111111111111';
const SET_ID = '44444444-4444-4444-4444-444444444444';
const now = new Date().toISOString();
const rule = { event: '100 Freistil', gender: 'W', classType: 'AL', min: '11', max: '12', time: 72.5 };

describe('RequiredTimeRuleSchema', () => {
  it('akzeptiert Regeln mit Alter, Jahrgang und ohne Altersangabe', () => {
    expect(RequiredTimeRuleSchema.safeParse(rule).success).toBe(true);
    expect(RequiredTimeRuleSchema.safeParse({ ...rule, classType: 'JG', min: '2015', max: '2014' }).success).toBe(true);
    expect(RequiredTimeRuleSchema.parse({ event: '50 Brust', time: 40 })).toEqual({ event: '50 Brust', gender: '', classType: '', min: '', max: '', time: 40 });
  });
  it('lehnt ungültige Werte ab', () => {
    for (const bad of [
      { ...rule, gender: 'X' },
      { ...rule, classType: 'AK' },
      { ...rule, time: 0 },
      { ...rule, time: -1 },
      { ...rule, min: '1a' },
      { ...rule, event: '' },
      { ...rule, classType: '', min: '10' },
      { ...rule, min: '13', max: '12' },
      { ...rule, extra: 1 },
    ]) expect(RequiredTimeRuleSchema.safeParse(bad).success).toBe(false);
  });
});

describe('ManualRequirementsSchema', () => {
  it('nimmt {} (Default der JSON-Spalte) an und füllt alle Felder', () => {
    expect(ManualRequirementsSchema.parse({})).toEqual({
      rules: [], qualifyingWindow: { from: null, to: null, course: null }, sourceSetId: null, sourceSetName: '',
    });
  });
  it('prüft Nachweiszeitraum und Bahn', () => {
    expect(ManualRequirementsSchema.safeParse({ qualifyingWindow: { from: '2026-01-01', course: 'any' } }).success).toBe(true);
    expect(ManualRequirementsSchema.safeParse({ qualifyingWindow: { course: 'XYZ' } }).success).toBe(false);
    expect(ManualRequirementsSchema.safeParse({ qualifyingWindow: { from: '01.01.2026' } }).success).toBe(false);
  });
});

describe('CompetitionSchema.manualRequirements', () => {
  const valid = { id: SET_ID, clubId: CLUB_ID, name: 'BM', date: now, location: '', course: 'SCM', notes: '', createdAt: now, updatedAt: now };
  it('ist optional ohne Default', () => {
    expect('manualRequirements' in CompetitionSchema.parse(valid)).toBe(false);
    expect(CompetitionSchema.safeParse({ ...valid, manualRequirements: { rules: [rule] } }).success).toBe(true);
  });
});

describe('RequiredTimeSetSchema', () => {
  it('akzeptiert eine Normtabelle und ist als Store im Paket "competitions" registriert', () => {
    const set = { id: SET_ID, clubId: CLUB_ID, name: 'Bezirk 2027', rules: [rule], createdAt: now, updatedAt: now };
    expect(RequiredTimeSetSchema.safeParse(set).success).toBe(true);
    expect(RequiredTimeSetSchema.safeParse({ ...set, name: '' }).success).toBe(false);
    expect(ENTITY_SCHEMAS.requiredTimeSets).toBe(RequiredTimeSetSchema);
    expect(MODULE_PACKAGES.competitions.stores).toContain('requiredTimeSets');
  });
});
