// Issue #133: IMPORT_LIMITS spiegelt die Grenzen der Server-Schemas, weil
// apps/web Zod nicht laden kann. Dieser Test hält beide gleich: für jede
// Grenze muss das Schema den Wert genau an der Grenze annehmen und eins
// darüber ablehnen.
import { describe, it, expect } from 'vitest';
import { IMPORT_LIMITS as L } from '../js/modules/importValidation.js';
import {
  ExerciseSchema, TemplateSchema, SectionTemplateSchema, PlanSchema,
  PlainSetSchema, RepeatBlockSchema, SectionSchema,
} from '../../../packages/shared-types/src/entities.js';

const UUID = '11111111-1111-4111-8111-111111111111';
const NOW = '2026-03-01T00:00:00.000Z';
const set = (over = {}) => ({ kind: 'set', id: 's', description: '', distance: null, reps: 1, intensity: '', restSec: 0, ...over });
const exercise = (over = {}) => ({ id: UUID, clubId: UUID, name: 'Ü', category: 'K', stroke: null, defaultDistance: null, createdAt: NOW, updatedAt: NOW, ...over });
const template = (over = {}) => ({ id: UUID, clubId: UUID, name: 'V', sets: [], createdAt: NOW, updatedAt: NOW, ...over });
const sectionTemplate = (over = {}) => ({ id: UUID, clubId: UUID, name: 'A', entries: [], createdAt: NOW, updatedAt: NOW, ...over });
const day = (over = {}) => ({ date: NOW, sets: [], ...over });
const plan = (over = {}) => ({ id: UUID, clubId: UUID, name: 'P', weekStart: NOW, groupId: null, status: 'aktiv', days: [], createdAt: NOW, updatedAt: NOW, ...over });

const str = (n) => 'x'.repeat(n);
const arr = (n, item) => Array.from({ length: n }, () => item);

// [Grenze, Schema, Datensatz mit dem Wert n]
const CASES = {
  'nameLength (Übung)': [L.nameLength, ExerciseSchema, (n) => exercise({ name: str(n) })],
  'nameLength (Vorlage)': [L.nameLength, TemplateSchema, (n) => template({ name: str(n) })],
  'nameLength (Abschnitts-Vorlage)': [L.nameLength, SectionTemplateSchema, (n) => sectionTemplate({ name: str(n) })],
  'nameLength (Plan)': [L.nameLength, PlanSchema, (n) => plan({ name: str(n) })],
  categoryLength: [L.categoryLength, ExerciseSchema, (n) => exercise({ category: str(n) })],
  strokeLength: [L.strokeLength, ExerciseSchema, (n) => exercise({ stroke: str(n) })],
  'descriptionLength (Übung)': [L.descriptionLength, ExerciseSchema, (n) => exercise({ description: str(n) })],
  'descriptionLength (Vorlage)': [L.descriptionLength, TemplateSchema, (n) => template({ description: str(n) })],
  'descriptionLength (Abschnitts-Vorlage)': [L.descriptionLength, SectionTemplateSchema, (n) => sectionTemplate({ description: str(n) })],
  setDescriptionLength: [L.setDescriptionLength, PlainSetSchema, (n) => set({ description: str(n) })],
  intensityLength: [L.intensityLength, PlainSetSchema, (n) => set({ intensity: str(n) })],
  labelLength: [L.labelLength, RepeatBlockSchema, (n) => ({ kind: 'block', id: 'b', label: str(n), repeatCount: 1, sets: [] })],
  headingLength: [L.headingLength, SectionSchema, (n) => ({ kind: 'section', id: 'c', heading: str(n), entries: [] })],
  'tagLength (Übung)': [L.tagLength, ExerciseSchema, (n) => exercise({ tags: [str(n)] })],
  'tagLength (Material)': [L.tagLength, PlainSetSchema, (n) => set({ equipment: [str(n)] })],
  'tagCount (Übung)': [L.tagCount, ExerciseSchema, (n) => exercise({ tags: arr(n, 't') })],
  'tagCount (Vorlage)': [L.tagCount, TemplateSchema, (n) => template({ tags: arr(n, 't') })],
  'equipmentCount (Übung)': [L.equipmentCount, ExerciseSchema, (n) => exercise({ equipment: arr(n, 'e') })],
  'equipmentCount (Satz)': [L.equipmentCount, PlainSetSchema, (n) => set({ equipment: arr(n, 'e') })],
  'entriesCount (Vorlage)': [L.entriesCount, TemplateSchema, (n) => template({ sets: arr(n, set()) })],
  'entriesCount (Plan-Tag)': [L.entriesCount, PlanSchema, (n) => plan({ days: [day({ sets: arr(n, set()) })] })],
  'entriesCount (Abschnitt)': [L.entriesCount, SectionSchema, (n) => ({ kind: 'section', id: 'c', heading: '', entries: arr(n, set()) })],
  'entriesCount (Abschnitts-Vorlage)': [L.entriesCount, SectionTemplateSchema, (n) => sectionTemplate({ entries: arr(n, set()) })],
  blockSetsCount: [L.blockSetsCount, RepeatBlockSchema, (n) => ({ kind: 'block', id: 'b', label: '', repeatCount: 1, sets: arr(n, set()) })],
  planDaysCount: [L.planDaysCount, PlanSchema, (n) => plan({ days: arr(n, day()) })],
};

describe('IMPORT_LIMITS entspricht den Server-Schemas', () => {
  it.each(Object.entries(CASES))('%s', (_name, [limit, schema, build]) => {
    expect(schema.safeParse(build(limit)).success).toBe(true);
    expect(schema.safeParse(build(limit + 1)).success).toBe(false);
  });

  it('deckt jede Grenze ab', () => {
    const covered = new Set(Object.keys(CASES).map((k) => k.split(' ')[0]));
    expect([...covered].sort()).toEqual(Object.keys(L).sort());
  });
});
