// Testet die "Duplizieren"-Funktion für Übungskatalog, Vorlagen,
// Abschnitts-Vorlagen und Trainingspläne: duplicateExercise() (catalog.js),
// duplicateTemplate() (templates.js), duplicateSectionTemplate()
// (sectionTemplates.js), duplicatePlan() (plans.js). Alle vier bauen aus
// einem bestehenden Datensatz eine unabhängige Kopie, die anschließend per
// put() (js/db.js) neu angelegt wird (frische id/Zeitstempel, siehe
// dortiger Kommentar).
//
// db.js/state.js ziehen transitiv demoMode.js nach, das auf Modulebene
// `location.pathname` liest (siehe libraryTransfer.test.js-Kommentar) —
// in reiner Node-Testumgebung gestubbt. plans.js braucht zusätzlich
// state.js::isTrainerOrAdmin() (Live-Modus-Button in renderDetail).
import { describe, it, expect, beforeEach, vi } from 'vitest';

const CLUB_ID = '11111111-1111-4111-8111-111111111111';
const EXERCISE_ID = '22222222-2222-4222-8222-222222222222'; // exerciseId muss laut PlainSetSchema eine UUID sein
vi.mock('../js/state.js', () => ({ getCurrentUser: vi.fn(() => ({ clubId: CLUB_ID })), isTrainerOrAdmin: () => true }));
vi.mock('../js/demoMode.js', () => ({ IS_DEMO: false }));

import * as db from '../js/db.js';
import { duplicateExercise } from '../js/modules/catalog.js';
import { duplicateTemplate } from '../js/modules/templates.js';
import { duplicateSectionTemplate } from '../js/modules/sectionTemplates.js';
import { duplicatePlan } from '../js/modules/plans.js';
import { ExerciseSchema, TemplateSchema, SectionTemplateSchema, PlanSchema } from '../../../packages/shared-types/src/entities.js';

beforeEach(async () => {
  await db.wipeAll();
});

const baseExercise = () => ({
  id: EXERCISE_ID, clubId: CLUB_ID, name: 'Kraul-Beinschlag', category: 'Technik', stroke: 'Kraul',
  description: 'Mit Brett', defaultDistance: 100, tags: ['Kraul'], equipment: ['Brett'],
  comments: [{ id: 'c1', text: 'Fremdkommentar', authorId: 'other-user', authorName: 'Andere Person', createdAt: '2026-01-01T00:00:00.000Z' }],
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z',
});

const plainSet = (id, extra = {}) => ({
  kind: 'set', id, description: 'Satz', distance: 100, reps: 1, intensity: '', restSec: 0, exerciseId: EXERCISE_ID,
  comments: [{ id: 'sc1', text: 'Rückfrage', authorId: 'other-user', authorName: 'Andere Person', createdAt: '2026-01-01T00:00:00.000Z' }],
  ...extra,
});

describe('duplicateExercise()', () => {
  it('entfernt id/Zeitstempel und hängt "(Kopie)" an den Namen', () => {
    const dup = duplicateExercise(baseExercise());
    expect(dup.id).toBeUndefined();
    expect(dup.createdAt).toBeUndefined();
    expect(dup.updatedAt).toBeUndefined();
    expect(dup.name).toBe('Kraul-Beinschlag (Kopie)');
  });

  it('übernimmt clubId und die übrigen Fachfelder unverändert', () => {
    const dup = duplicateExercise(baseExercise());
    expect(dup.clubId).toBe(CLUB_ID);
    expect(dup.category).toBe('Technik');
    expect(dup.tags).toEqual(['Kraul']);
    expect(dup.equipment).toEqual(['Brett']);
    expect(dup.defaultDistance).toBe(100);
  });

  // sync.commentAuthorship.ts (apps/api) lehnt einen fremdautorisierten
  // Kommentar unter einer neuen id ab — die Kopie darf ihn deshalb nicht
  // übernehmen (siehe Kommentar in catalog.js).
  it('übernimmt keine Kommentare des Originals', () => {
    const dup = duplicateExercise(baseExercise());
    expect(dup.comments).toEqual([]);
  });

  it('legt sich über put() als eigenständiger, schemagültiger Datensatz mit neuer id an', async () => {
    const original = baseExercise();
    await db.putWithoutSync('exercises', original);
    const saved = await db.put('exercises', duplicateExercise(original));

    expect(saved.id).not.toBe(original.id);
    expect(ExerciseSchema.safeParse(saved).success).toBe(true);
    const queue = await db.getSyncQueue();
    expect(queue.find(e => e.entityId === saved.id)).toMatchObject({ store: 'exercises', action: 'create' });
  });
});

describe('duplicateTemplate()', () => {
  const baseTemplate = () => ({
    id: 'tpl-1', clubId: CLUB_ID, name: 'Grundlagenausdauer', description: '', tags: [], poolLength: 'LCM',
    sets: [plainSet('s1'), { kind: 'block', id: 'b1', label: 'Serie', repeatCount: 3, sets: [plainSet('s2')] }],
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z',
  });

  it('entfernt id/Zeitstempel und hängt "(Kopie)" an den Namen', () => {
    const dup = duplicateTemplate(baseTemplate());
    expect(dup.id).toBeUndefined();
    expect(dup.createdAt).toBeUndefined();
    expect(dup.name).toBe('Grundlagenausdauer (Kopie)');
  });

  it('vergibt frischen Sätzen/Blöcken neue ids, ohne das Original zu verändern', () => {
    const original = baseTemplate();
    const dup = duplicateTemplate(original);
    expect(dup.sets[0].id).not.toBe('s1');
    expect(dup.sets[1].id).not.toBe('b1');
    expect(dup.sets[1].sets[0].id).not.toBe('s2');
    // Original bleibt unangetastet (kein geteiltes Objekt).
    expect(original.sets[0].id).toBe('s1');
  });

  it('behält exerciseId-Referenzen innerhalb der Sätze bei', () => {
    const dup = duplicateTemplate(baseTemplate());
    expect(dup.sets[0].exerciseId).toBe(EXERCISE_ID);
    expect(dup.sets[1].sets[0].exerciseId).toBe(EXERCISE_ID);
  });

  it('übernimmt keine Satz-Kommentare des Originals', () => {
    const dup = duplicateTemplate(baseTemplate());
    expect(dup.sets[0].comments).toEqual([]);
    expect(dup.sets[1].sets[0].comments).toEqual([]);
  });

  it('legt sich über put() als eigenständiger, schemagültiger Datensatz an', async () => {
    const original = baseTemplate();
    await db.putWithoutSync('templates', original);
    const saved = await db.put('templates', duplicateTemplate(original));
    expect(saved.id).not.toBe(original.id);
    expect(TemplateSchema.safeParse(saved).success).toBe(true);
  });
});

describe('duplicateSectionTemplate()', () => {
  const baseSectionTemplate = () => ({
    id: 'st-1', clubId: CLUB_ID, name: 'Einschwimmen', description: '', tags: [],
    entries: [plainSet('e1')],
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z',
  });

  it('entfernt id/Zeitstempel, hängt "(Kopie)" an und vergibt frische Eintrags-ids', () => {
    const original = baseSectionTemplate();
    const dup = duplicateSectionTemplate(original);
    expect(dup.id).toBeUndefined();
    expect(dup.name).toBe('Einschwimmen (Kopie)');
    expect(dup.entries[0].id).not.toBe('e1');
    expect(dup.entries[0].comments).toEqual([]);
  });

  it('legt sich über put() als eigenständiger, schemagültiger Datensatz an', async () => {
    const original = baseSectionTemplate();
    await db.putWithoutSync('sectionTemplates', original);
    const saved = await db.put('sectionTemplates', duplicateSectionTemplate(original));
    expect(saved.id).not.toBe(original.id);
    expect(SectionTemplateSchema.safeParse(saved).success).toBe(true);
  });
});

describe('duplicatePlan()', () => {
  const basePlan = (status = 'archiv') => ({
    id: 'plan-1', clubId: CLUB_ID, name: 'KW 12', weekStart: '2026-03-16T00:00:00.000Z',
    groupId: null, status,
    days: [{ date: '2026-03-16T00:00:00.000Z', poolLength: 'LCM', sets: [plainSet('s1')] }],
    comments: [{ id: 'pc1', text: 'Planweiter Hinweis', authorId: 'other-user', authorName: 'Andere Person', createdAt: '2026-01-01T00:00:00.000Z' }],
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z',
  });

  it('entfernt id/Zeitstempel und hängt "(Kopie)" an den Namen', () => {
    const dup = duplicatePlan(basePlan());
    expect(dup.id).toBeUndefined();
    expect(dup.createdAt).toBeUndefined();
    expect(dup.name).toBe('KW 12 (Kopie)');
  });

  // Produktentscheidung (siehe plans.js-Kommentar): weekStart bleibt
  // unverändert, status wird IMMER auf "aktiv" zurückgesetzt — auch wenn
  // das Original bereits archiviert war.
  it('behält weekStart bei und setzt status immer auf "aktiv" zurück', () => {
    const dupFromArchived = duplicatePlan(basePlan('archiv'));
    expect(dupFromArchived.weekStart).toBe('2026-03-16T00:00:00.000Z');
    expect(dupFromArchived.status).toBe('aktiv');

    const dupFromActive = duplicatePlan(basePlan('aktiv'));
    expect(dupFromActive.status).toBe('aktiv');
  });

  it('übernimmt weder Plan- noch Satz-Kommentare des Originals', () => {
    const dup = duplicatePlan(basePlan());
    expect(dup.comments).toEqual([]);
    expect(dup.days[0].sets[0].comments).toEqual([]);
  });

  it('vergibt den Sätzen jedes Tages frische ids, ohne das Original zu verändern', () => {
    const original = basePlan();
    const dup = duplicatePlan(original);
    expect(dup.days[0].sets[0].id).not.toBe('s1');
    expect(original.days[0].sets[0].id).toBe('s1');
  });

  it('legt sich über put() als eigenständiger, schemagültiger Datensatz an', async () => {
    const original = basePlan();
    await db.putWithoutSync('plans', original);
    const saved = await db.put('plans', duplicatePlan(original));
    expect(saved.id).not.toBe(original.id);
    expect(saved.status).toBe('aktiv');
    expect(PlanSchema.safeParse(saved).success).toBe(true);
  });
});
