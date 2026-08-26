// apps/web/test/libraryTransfer.test.js
//
// Testet js/modules/libraryTransfer.js::importLibrary() gegen echtes
// js/db.js (per fake-indexeddb, siehe test/setup.js) — bislang
// ungetestet. Deckt insbesondere Befund P7 (Code-Review) ab.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const CLUB_ID = '11111111-1111-4111-8111-111111111111'; // UUID-Form, damit gespeicherte Datensätze zusätzlich gegen die Entity-Schemas geprüft werden können (siehe Test weiter unten)
vi.mock('../js/state.js', () => ({ getCurrentUser: vi.fn(() => ({ clubId: CLUB_ID })) }));
vi.mock('../js/demoMode.js', () => ({ IS_DEMO: false }));

import * as db from '../js/db.js';
import { importLibrary, LIBRARY_EXPORT_FORMAT } from '../js/modules/libraryTransfer.js';
import { ExerciseSchema, TemplateSchema } from '../../../packages/shared-types/src/entities.js';

beforeEach(async () => {
  await db.wipeAll();
});

describe('importLibrary()', () => {
  it('legt Übungen und Vorlagen mit neu vergebenen ids und der clubId des eingeloggten Nutzers an', async () => {
    const dump = {
      format: LIBRARY_EXPORT_FORMAT,
      exercises: [{ id: 'orig-ex-1', name: 'Kraul-Beinschlag', category: 'Technik', tags: ['Kraul'], equipment: [] }],
      templates: [{ id: 'orig-tpl-1', name: 'Einschwimmen', tags: [], sets: [{ kind: 'set', description: '', exerciseId: 'orig-ex-1' }] }],
    };

    const result = await importLibrary(dump);
    expect(result).toEqual({ exercises: 1, templates: 1 });

    const savedExercises = await db.getAll('exercises');
    expect(savedExercises).toHaveLength(1);
    expect(savedExercises[0].id).not.toBe('orig-ex-1'); // neu vergeben, nicht die exportierte id
    expect(savedExercises[0].clubId).toBe(CLUB_ID);
    expect(savedExercises[0].name).toBe('Kraul-Beinschlag');

    const savedTemplates = await db.getAll('templates');
    expect(savedTemplates).toHaveLength(1);
    expect(savedTemplates[0].clubId).toBe(CLUB_ID);
    // exerciseId im Vorlagen-Satz zeigt auf die NEU vergebene Übungs-id,
    // nicht mehr auf die exportierte "orig-ex-1".
    expect(savedTemplates[0].sets[0].exerciseId).toBe(savedExercises[0].id);
  });

  // exercises.id/templates.id müssen `z.string().uuid()`-Form haben (siehe
  // ExerciseSchema/TemplateSchema) — ein Datensatz mit einer anderen id-
  // Form scheitert dauerhaft am Sync-Push. Die vorigen Assertions prüfen
  // nur, DASS eine neue id vergeben wurde, nicht IN WELCHEM Format; dieser
  // Test prüft deshalb direkt gegen dasselbe Zod-Schema, das der Server
  // anwendet.
  it('vergibt für exercises.id/templates.id serverseitig gültige UUIDs', async () => {
    const dump = {
      format: LIBRARY_EXPORT_FORMAT,
      exercises: [{ id: 'orig-ex-1', name: 'Kraul-Beinschlag', category: 'Technik', tags: [], equipment: [] }],
      templates: [{ id: 'orig-tpl-1', name: 'Einschwimmen', tags: [], sets: [] }],
    };
    await importLibrary(dump);

    const [savedExercise] = await db.getAll('exercises');
    const [savedTemplate] = await db.getAll('templates');

    expect(ExerciseSchema.safeParse(savedExercise).success).toBe(true);
    expect(TemplateSchema.safeParse(savedTemplate).success).toBe(true);
  });

  it('reiht für jede importierte Übung/Vorlage ein "create"-Sync-Event ein', async () => {
    const dump = {
      format: LIBRARY_EXPORT_FORMAT,
      exercises: [{ name: 'A', category: 'Technik' }, { name: 'B', category: 'Technik' }],
      templates: [{ name: 'T1', sets: [] }],
    };

    await importLibrary(dump);

    const queue = await db.getSyncQueue();
    expect(queue).toHaveLength(3);
    expect(queue.every((e) => e.status === 'pending' && e.action === 'create')).toBe(true);
    expect(queue.filter((e) => e.store === 'exercises')).toHaveLength(2);
    expect(queue.filter((e) => e.store === 'templates')).toHaveLength(1);

    const savedExerciseIds = (await db.getAll('exercises')).map((e) => e.id).sort();
    expect(queue.filter((e) => e.store === 'exercises').map((e) => e.entityId).sort()).toEqual(savedExerciseIds);
  });

  it('ignoriert Einträge ohne Pflichtfelder (name/category bzw. name)', async () => {
    const dump = {
      format: LIBRARY_EXPORT_FORMAT,
      exercises: [{ name: 'Ohne Kategorie' }, { category: 'Ohne Namen' }, { name: 'Gültig', category: 'Technik' }],
      templates: [{ description: 'Ohne Namen' }],
    };

    const result = await importLibrary(dump);
    expect(result).toEqual({ exercises: 1, templates: 0 });
  });

  // Regressionstest für Befund P7 (Code-Review): put() pro Datensatz
  // öffnete vormals sowohl für den Datensatz selbst als auch (via
  // enqueueSyncEvent()) für dessen Sync-Event je eine EIGENE
  // IndexedDB-Transaktion — bei einem Bundle mit 50 Übungen + 50 Vorlagen
  // also bis zu 200 Transaktionen. Nach der Korrektur (bulkPut() +
  // bulkEnqueueSyncEvents()) genügen drei: eine je Store (exercises,
  // templates, syncQueue).
  it('öffnet für den gesamten Import GENAU DREI IndexedDB-Transaktionen, unabhängig von der Anzahl der Datensätze', async () => {
    const exercises = Array.from({ length: 50 }, (_, i) => ({ name: `Übung ${i}`, category: 'Technik' }));
    const templates = Array.from({ length: 50 }, (_, i) => ({ name: `Vorlage ${i}`, sets: [] }));
    const dump = { format: LIBRARY_EXPORT_FORMAT, exercises, templates };

    const transactionSpy = vi.spyOn(IDBDatabase.prototype, 'transaction');
    try {
      const result = await importLibrary(dump);
      expect(result).toEqual({ exercises: 50, templates: 50 });
      expect(transactionSpy).toHaveBeenCalledTimes(3);
    } finally {
      transactionSpy.mockRestore();
    }
  });
});
