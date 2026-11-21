// Testet js/modules/planTransfer.js (JSON-Export/Import eines einzelnen
// Trainingsplans) gegen echtes js/db.js (per fake-indexeddb, siehe
// test/setup.js). state.js/demoMode.js wie in libraryTransfer.test.js
// gestubbt.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const CLUB_ID = '11111111-1111-4111-8111-111111111111';
const EXERCISE_ID = '22222222-2222-4222-8222-222222222222';
const GROUP_ID = '33333333-3333-4333-8333-333333333333';
vi.mock('../js/state.js', () => ({ getCurrentUser: vi.fn(() => ({ clubId: CLUB_ID })), isTrainerOrAdmin: () => true }));
vi.mock('../js/demoMode.js', () => ({ IS_DEMO: false }));

import * as db from '../js/db.js';
import { buildPlanExport, parsePlanImport, importPlan, PLAN_EXPORT_FORMAT } from '../js/modules/planTransfer.js';
import { ImportValidationError } from '../js/modules/importValidation.js';
import { PlanSchema, ExerciseSchema } from '../../../packages/shared-types/src/entities.js';

beforeEach(async () => {
  await db.wipeAll();
});

const exercise = () => ({
  id: EXERCISE_ID, clubId: CLUB_ID, name: 'Kraul-Beinschlag', category: 'Technik', stroke: 'Kraul',
  description: 'Mit Brett', defaultDistance: 100, defaultDurationSec: null, tags: [], equipment: ['Brett'],
  comments: [{ id: 'c1', text: 'Intern', authorId: 'u1', authorName: 'Trainerin A', createdAt: '2026-01-01T00:00:00.000Z' }],
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
});

const comment = { id: 'pc1', text: 'Geheim', authorId: 'u1', authorName: 'Trainerin A', createdAt: '2026-01-01T00:00:00.000Z' };

const plan = () => ({
  id: '44444444-4444-4444-8444-444444444444', clubId: CLUB_ID, name: 'KW 12', weekStart: '2026-03-16T00:00:00.000Z',
  groupId: GROUP_ID, status: 'aktiv', comments: [comment],
  days: [{
    date: '2026-03-17T00:00:00.000Z', poolLength: 'SCM',
    sets: [
      { kind: 'set', id: 's1', description: 'Einschwimmen', distance: 400, durationSec: null, reps: 1, intensity: 'GA1', restSec: 0, exerciseId: null, comments: [comment] },
      { kind: 'block', id: 'b1', label: 'Hauptserie', repeatCount: 3, sets: [
        { kind: 'set', id: 's2', description: 'Beine', distance: 100, durationSec: 120, reps: 4, intensity: 'GA2', restSec: 20, exerciseId: EXERCISE_ID, equipment: ['Brett'], comments: [] },
      ] },
      { kind: 'section', id: 'sec1', heading: 'Ausschwimmen', entries: [
        { kind: 'set', id: 's3', description: 'Locker', distance: 200, durationSec: null, reps: 1, intensity: '', restSec: 0, exerciseId: EXERCISE_ID, comments: [] },
      ] },
    ],
  }],
  createdAt: '2026-03-01T00:00:00.000Z', updatedAt: '2026-03-01T00:00:00.000Z',
});

const groups = [{ id: GROUP_ID, clubId: CLUB_ID, name: 'Leistungsgruppe' }];

describe('buildPlanExport()', () => {
  it('exportiert den Plan ohne ids, clubId und Kommentare, mit Gruppenname und referenzierten Übungen', () => {
    const dump = buildPlanExport(plan(), { groups, exercises: [exercise(), { ...exercise(), id: 'unused', name: 'Andere' }] });
    expect(dump.format).toBe(PLAN_EXPORT_FORMAT);
    const json = JSON.stringify(dump);
    expect(json).not.toContain(CLUB_ID);
    expect(json).not.toContain(GROUP_ID);
    expect(json).not.toContain('Trainerin A');
    expect(json).not.toContain('Geheim');
    expect(dump.plan.groupName).toBe('Leistungsgruppe');
    expect(dump.plan.days[0].poolLength).toBe('SCM');
    expect(dump.plan.days[0].sets[1].sets[0].equipment).toEqual(['Brett']);
    expect(dump.exercises.map(ex => ex.id)).toEqual([EXERCISE_ID]);
    expect(dump.exercises[0].comments).toBeUndefined();
  });
});

describe('parsePlanImport()', () => {
  it('lehnt ungültiges JSON und fremde Formate ab', () => {
    expect(() => parsePlanImport('{nope')).toThrow('invalid-json');
    expect(() => parsePlanImport(JSON.stringify({ format: 'lane1-library-export-v1' }))).toThrow('invalid-format');
    expect(() => parsePlanImport(JSON.stringify({ format: PLAN_EXPORT_FORMAT }))).toThrow('invalid-format');
  });
});

describe('importPlan()', () => {
  it('Rück-Import in denselben Verein: neuer Plan, vorhandene Übung und Gruppe werden wiederverwendet', async () => {
    await db.putWithoutSync('exercises', exercise());
    await db.putWithoutSync('groups', groups[0]);
    const dump = parsePlanImport(JSON.stringify(buildPlanExport(plan(), { groups, exercises: [exercise()] })));

    const { plan: saved, createdExercises } = await importPlan(dump);
    expect(createdExercises).toBe(0);
    expect(await db.getAll('exercises')).toHaveLength(1);
    expect(saved.id).not.toBe(plan().id);
    expect(saved.clubId).toBe(CLUB_ID);
    expect(saved.groupId).toBe(GROUP_ID);
    expect(saved).not.toHaveProperty('comments');
    expect(saved.days[0].sets[1].sets[0].exerciseId).toBe(EXERCISE_ID);
    expect(saved.days[0].sets[2].entries[0].exerciseId).toBe(EXERCISE_ID);
    expect(PlanSchema.safeParse(saved).success).toBe(true);
  });

  it('Import in einen anderen Verein: legt fehlende Übungen neu an, remappt exerciseId, Gruppe bleibt leer', async () => {
    const dump = buildPlanExport(plan(), { groups, exercises: [exercise()] });
    const { plan: saved, createdExercises } = await importPlan(dump);

    expect(createdExercises).toBe(1);
    const [newExercise] = await db.getAll('exercises');
    expect(newExercise.id).not.toBe(EXERCISE_ID);
    expect(newExercise).not.toHaveProperty('comments');
    expect(ExerciseSchema.safeParse(newExercise).success).toBe(true);
    expect(saved.groupId).toBeNull();
    expect(saved.days[0].sets[1].sets[0].exerciseId).toBe(newExercise.id);
    expect(saved.days[0].sets[2].entries[0].exerciseId).toBe(newExercise.id);
    expect(PlanSchema.safeParse(saved).success).toBe(true);

    const events = (await db.getAll('syncQueue')).map(e => e.store).sort();
    expect(events).toEqual(['exercises', 'plans']);
  });

  it('ordnet eine Übung per Name + Kategorie zu, wenn die id unbekannt ist', async () => {
    const local = { ...exercise(), id: '55555555-5555-4555-8555-555555555555', name: 'kraul-beinschlag ' };
    await db.putWithoutSync('exercises', local);
    const { plan: saved, createdExercises } = await importPlan(buildPlanExport(plan(), { groups, exercises: [exercise()] }));
    expect(createdExercises).toBe(0);
    expect(saved.days[0].sets[1].sets[0].exerciseId).toBe(local.id);
  });

  it('ergänzt fehlende optionale Felder und verwirft unbekannte Übungsverweise', async () => {
    const dump = {
      format: PLAN_EXPORT_FORMAT,
      plan: { name: '', groupName: 'Gibt es nicht', days: [{ date: '2026-03-17', sets: [{ kind: 'set', exerciseId: 'nicht-im-dump' }] }] },
    };
    const { plan: saved } = await importPlan(dump);
    expect(saved.days[0].poolLength).toBeNull();
    expect(saved.days[0].sets[0]).toMatchObject({ reps: 1, distance: null, exerciseId: null });
    expect(saved.status).toBe('aktiv');
    expect(saved.groupId).toBeNull();
    expect(PlanSchema.safeParse(saved).success).toBe(true);
  });
});

// Issue #133: eine Datei, die die Server-Schemas verletzt, wird als Ganzes
// abgelehnt, statt Datensätze anzulegen, die nie synchronisieren.
describe('Import schema-widriger Dateien', () => {
  const validDay = { date: '2026-03-17', sets: [] };
  const fileWith = (plan, exercises = []) => JSON.stringify({ format: PLAN_EXPORT_FORMAT, plan: { name: 'KW', weekStart: '2026-03-16', status: 'aktiv', days: [validDay], ...plan }, exercises });

  it('lehnt die Datei aus Issue #133 ab und schreibt nichts', async () => {
    const raw = JSON.stringify({ format: 'lane1-plan-export-v1',
      plan: { name: 'x'.repeat(500), weekStart: '2026-03-16', status: 'aktiv',
        days: [{ date: '2026-03-17', sets: [
          { kind: 'set', description: 42, intensity: { a: 1 }, reps: 1 },
          { kind: 'block', label: 7, sets: [] } ] }] },
      exercises: [{ id: 'e1', name: 'y'.repeat(500), category: 'Technik', tags: [1, 2] }] });

    expect(() => parsePlanImport(raw)).toThrow(ImportValidationError);
    await expect(importPlan(JSON.parse(raw))).rejects.toThrow(ImportValidationError);
    expect(await db.getAll('plans')).toEqual([]);
    expect(await db.getAll('exercises')).toEqual([]);
    expect(await db.getSyncQueue()).toEqual([]);
  });

  it.each([
    ['falscher Typ (Beschreibung)', { days: [{ ...validDay, sets: [{ kind: 'set', description: 42 }] }] }],
    ['falscher Typ (Intensität)', { days: [{ ...validDay, sets: [{ kind: 'set', intensity: { a: 1 } }] }] }],
    ['zu langer Name', { name: 'x'.repeat(201) }],
    ['zu lange Satzbeschreibung', { days: [{ ...validDay, sets: [{ kind: 'set', description: 'x'.repeat(2001) }] }] }],
    ['zu viele Tage', { days: Array.from({ length: 61 }, () => validDay) }],
    ['zu viele Sätze an einem Tag', { days: [{ ...validDay, sets: Array.from({ length: 201 }, () => ({ kind: 'set' })) }] }],
    ['zu viele Sätze in einem Block', { days: [{ ...validDay, sets: [{ kind: 'block', sets: Array.from({ length: 51 }, () => ({ kind: 'set' })) }] }] }],
    ['verschachtelter Block', { days: [{ ...validDay, sets: [{ kind: 'block', sets: [{ kind: 'block', sets: [] }] }] }] }],
    ['Abschnitt im Abschnitt', { days: [{ ...validDay, sets: [{ kind: 'section', entries: [{ kind: 'section', entries: [] }] }] }] }],
    ['unbekannte Satzart', { days: [{ ...validDay, sets: [{ kind: 'foo' }] }] }],
    ['negative Wiederholungen', { days: [{ ...validDay, sets: [{ kind: 'set', reps: -2 }] }] }],
    ['ungültiges Datum', { days: [{ date: 'kein Datum', sets: [] }] }],
    ['ungültige Beckenlänge', { days: [{ ...validDay, poolLength: 'XYZ' }] }],
    ['ungültiger Status', { status: 'unbekannt' }],
    ['Material kein String', { days: [{ ...validDay, sets: [{ kind: 'set', equipment: [1] }] }] }],
  ])('lehnt ab: %s', (_label, plan) => {
    expect(() => parsePlanImport(fileWith(plan))).toThrow(ImportValidationError);
  });

  it.each([
    ['Tags keine Strings', { id: 'e1', name: 'Ü', category: 'Technik', tags: [1] }],
    ['zu langer Übungsname', { id: 'e1', name: 'y'.repeat(201), category: 'Technik' }],
    ['zu viele Tags', { id: 'e1', name: 'Ü', category: 'Technik', tags: Array.from({ length: 51 }, () => 't') }],
    ['Übung ohne id', { name: 'Ü', category: 'Technik' }],
    ['Übung ohne Kategorie', { id: 'e1', name: 'Ü' }],
  ])('lehnt eingebettete Übung ab: %s', (_label, exercise) => {
    expect(() => parsePlanImport(fileWith({}, [exercise]))).toThrow(ImportValidationError);
  });

  it('ein Export ist unverändert importierbar und ergibt schema-gültige Datensätze', async () => {
    await db.put('exercises', { ...exercise(), clubId: CLUB_ID });
    const raw = JSON.stringify(buildPlanExport(plan(), { groups, exercises: [exercise()] }));
    await db.wipeAll();
    const { plan: saved } = await importPlan(parsePlanImport(raw));
    expect(PlanSchema.safeParse(saved).success).toBe(true);
    for (const ex of await db.getAll('exercises')) expect(ExerciseSchema.safeParse(ex).success).toBe(true);
  });
});
