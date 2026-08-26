// ============================================================
// modules/libraryTransfer.js — JSON-Export/Import für Vorlagen (templates)
// und Übungskatalog (exercises), gemeinsam als ein Bundle.
//
// Export schließt bewusst clubId (Mandantenbindung) und persönliche Daten
// (Kommentare inkl. authorName, siehe CommentSchema in
// packages/shared-types/src/entities.ts) aus — die exportierte Datei ist
// damit frei zwischen Vereinen teilbar, ohne Trainer:innen-Namen oder die
// exportierende Vereins-ID preiszugeben.
//
// Import setzt clubId NIE aus der Datei, sondern lässt db.js's put()
// automatisch die clubId des aktuell eingeloggten Nutzers eintragen (siehe
// dortige CLUB_SCOPED_STORES-Logik). IDs werden beim Import immer neu
// vergeben (uid() aus db.js) statt der exportierten IDs — die `id` einer
// exportierten Übung dient nur innerhalb der Datei als Referenz, damit
// Vorlagen-Sätze (sets[].exerciseId) nach dem Import wieder auf die neu
// angelegte, club-eigene Übung zeigen. Ohne diese Neuvergabe könnten zwei
// Vereine, die dieselbe Datei importieren, in Konflikt geraten — `id` ist
// in der Datenbank global eindeutig (Primärschlüssel), nicht je Verein.
// `uid()` kommt hier bewusst aus db.js (crypto.randomUUID()), NICHT aus
// dom.js: exercises.id/templates.id sind fachliche Primärschlüssel, für
// die ExerciseSchema/TemplateSchema (packages/shared-types/src/entities.ts)
// `z.string().uuid()` verlangen — ein per Sync-Push importierter Datensatz
// mit einer Nicht-UUID-id scheitert sonst dauerhaft an der Server-Validierung.
// Für die EINGEBETTETEN Set-/Block-ids in remapSetEntry() unten gilt das
// nicht (PlainSetSchema.id/RepeatBlockSchema.id sind nur `z.string()`) —
// dort kommt weiterhin localId() aus dom.js zum Einsatz.
// ============================================================
import { getAll, bulkPut, bulkEnqueueSyncEvents, uid } from '../db.js';
import { getCurrentUser } from '../state.js';
import { el, localId } from '../dom.js';
import { toast } from '../ui.js';
import { openModal } from '../modal.js';
import { t } from '../i18n.js';

export const LIBRARY_EXPORT_FORMAT = 'lane1-library-export-v1';

function stripSetEntry(entry) {
  if (entry.kind === 'block') {
    return {
      kind: 'block',
      label: entry.label || '',
      repeatCount: entry.repeatCount || 1,
      sets: (entry.sets || []).map(stripSetEntry),
    };
  }
  return {
    kind: 'set',
    description: entry.description || '',
    distance: entry.distance ?? null,
    reps: entry.reps ?? 1,
    intensity: entry.intensity || '',
    restSec: entry.restSec ?? 0,
    exerciseId: entry.exerciseId || null,
  };
}

export async function buildLibraryExport() {
  const [exercises, templates] = await Promise.all([getAll('exercises'), getAll('templates')]);
  return {
    format: LIBRARY_EXPORT_FORMAT,
    exportedAt: new Date().toISOString(),
    exercises: exercises.map(ex => ({
      id: ex.id,
      name: ex.name,
      category: ex.category,
      stroke: ex.stroke ?? null,
      description: ex.description || '',
      defaultDistance: ex.defaultDistance ?? null,
      tags: ex.tags || [],
      equipment: ex.equipment || [],
    })),
    templates: templates.map(tpl => ({
      id: tpl.id,
      name: tpl.name,
      description: tpl.description || '',
      tags: tpl.tags || [],
      sets: (tpl.sets || []).map(stripSetEntry),
    })),
  };
}

export function parseLibraryImport(raw) {
  let dump;
  try { dump = JSON.parse(raw); } catch { throw new Error('invalid-json'); }
  if (!dump || dump.format !== LIBRARY_EXPORT_FORMAT) throw new Error('invalid-format');
  return dump;
}

function remapSetEntry(entry, idMap) {
  if (entry?.kind === 'block') {
    return {
      kind: 'block',
      id: localId('block'),
      label: entry.label || '',
      repeatCount: entry.repeatCount || 1,
      sets: (entry.sets || []).map(s => remapSetEntry(s, idMap)),
    };
  }
  return {
    kind: 'set',
    id: localId('set'),
    description: entry?.description || '',
    distance: entry?.distance ?? null,
    reps: entry?.reps || 1,
    intensity: entry?.intensity || '',
    restSec: entry?.restSec ?? 0,
    comments: [],
    exerciseId: entry?.exerciseId && idMap.has(entry.exerciseId) ? idMap.get(entry.exerciseId) : null,
  };
}

// clubId wird bewusst NICHT aus der Datei übernommen, sondern hier einmal
// anhand des eingeloggten Nutzers ermittelt (sofern vorhanden) und auf
// jeden importierten Datensatz angewendet — analog zu put()'s
// automatischer clubId-Ergänzung (siehe db.js), die hier NICHT genutzt
// wird (siehe Kommentar zu bulkPut() unten).
//
// Ineffizienz-Korrektur (Code-Review, Befund P7): put() pro Datensatz rief
// vormals sowohl eine eigene IndexedDB-Transaktion für den Datensatz
// selbst als auch (via enqueueSyncEvent()) eine zweite für dessen
// Sync-Event auf — bei einem Bundle mit 200 Übungen samt Vorlagen also bis
// zu 400 Transaktionen. bulkPut() (bereits vorhanden, bislang nur für
// Seeding/Vollimport ohne Sync-Events genutzt) schreibt alle Zeilen EINES
// Stores in einer einzigen Transaktion; bulkEnqueueSyncEvents() (neu,
// siehe db.js) tut dasselbe für die zugehörigen Sync-Events. Da bulkPut()
// (anders als put()) weder clubId/Zeitstempel automatisch ergänzt noch
// selbst ein Sync-Event erzeugt, übernimmt importLibrary() diese beiden
// Schritte jetzt explizit.
export async function importLibrary(dump) {
  const exercises = (Array.isArray(dump.exercises) ? dump.exercises : []).filter(ex => ex && ex.name && ex.category);
  const templates = (Array.isArray(dump.templates) ? dump.templates : []).filter(tpl => tpl && tpl.name);

  const clubId = getCurrentUser()?.clubId;
  const now = new Date().toISOString();

  const idMap = new Map(); // exportierte exercise.id -> neu vergebene id
  const exerciseRows = exercises.map(ex => {
    const id = uid();
    if (ex.id) idMap.set(ex.id, id);
    return {
      id,
      ...(clubId ? { clubId } : {}),
      name: ex.name,
      category: ex.category,
      stroke: ex.stroke ?? null,
      description: ex.description || '',
      defaultDistance: ex.defaultDistance ?? null,
      tags: ex.tags || [],
      equipment: ex.equipment || [],
      comments: [],
      createdAt: now,
      updatedAt: now,
    };
  });
  await bulkPut('exercises', exerciseRows);

  const templateRows = templates.map(tpl => ({
    id: uid(),
    ...(clubId ? { clubId } : {}),
    name: tpl.name,
    description: tpl.description || '',
    tags: tpl.tags || [],
    sets: (tpl.sets || []).map(s => remapSetEntry(s, idMap)),
    createdAt: now,
    updatedAt: now,
  }));
  await bulkPut('templates', templateRows);

  await bulkEnqueueSyncEvents([
    ...exerciseRows.map(row => ({ store: 'exercises', entityId: row.id, action: 'create', payload: row })),
    ...templateRows.map(row => ({ store: 'templates', entityId: row.id, action: 'create', payload: row })),
  ]);

  return { exercises: exerciseRows.length, templates: templateRows.length };
}

function downloadJSON(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function openImportConfirmModal(dump, onImported) {
  const exCount = Array.isArray(dump.exercises) ? dump.exercises.length : 0;
  const tplCount = Array.isArray(dump.templates) ? dump.templates.length : 0;
  const body = el('div', {}, [
    el('p', {}, t('libraryTransfer.importConfirm', { exercises: exCount, templates: tplCount })),
    el('div', { class: 'form-actions' }, [
      el('button', { class: 'btn btn-ghost', onclick: () => close() }, t('common.cancel')),
      el('button', {
        class: 'btn btn-primary',
        onclick: async () => {
          close();
          const result = await importLibrary(dump);
          toast(t('libraryTransfer.importDone', { exercises: result.exercises, templates: result.templates }));
          onImported?.();
        },
      }, t('libraryTransfer.importButton')),
    ]),
  ]);
  const { close } = openModal({ title: t('libraryTransfer.importConfirmTitle'), bodyNode: body });
}

// Rendert das "Export (JSON)"/"Import (JSON)"-Buttonpaar für templates.js
// und catalog.js — beide Module exportieren/importieren dasselbe
// kombinierte Bundle (Vorlagen + Übungskatalog), damit exerciseId-
// Referenzen zwischen Vorlagen-Sätzen und Katalogübungen erhalten bleiben.
export function libraryTransferButtons({ onImported } = {}) {
  const fileInput = el('input', {
    type: 'file', accept: 'application/json', style: 'display:none',
    onchange: async (e) => {
      const file = e.target.files[0];
      fileInput.value = '';
      if (!file) return;
      try {
        const dump = parseLibraryImport(await file.text());
        openImportConfirmModal(dump, onImported);
      } catch {
        toast(t('libraryTransfer.importError'), 'error');
      }
    },
  });
  const exportBtn = el('button', {
    class: 'btn btn-ghost',
    onclick: async () => {
      const dump = await buildLibraryExport();
      downloadJSON(`lane1-vorlagen-uebungskatalog-${new Date().toISOString().slice(0, 10)}.json`, dump);
      toast(t('libraryTransfer.exportStarted'));
    },
  }, t('libraryTransfer.exportButton'));
  const importBtn = el('button', { class: 'btn btn-ghost', onclick: () => fileInput.click() }, t('libraryTransfer.importButton'));
  return el('span', { class: 'flex gap-8', style: 'display:inline-flex' }, [exportBtn, importBtn, fileInput]);
}
