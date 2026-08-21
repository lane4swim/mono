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
// vergeben (uid()) statt der exportierten IDs — die `id` einer exportierten
// Übung dient nur innerhalb der Datei als Referenz, damit Vorlagen-Sätze
// (sets[].exerciseId) nach dem Import wieder auf die neu angelegte,
// club-eigene Übung zeigen. Ohne diese Neuvergabe könnten zwei Vereine, die
// dieselbe Datei importieren, in Konflikt geraten — `id` ist in der
// Datenbank global eindeutig (Primärschlüssel), nicht je Verein.
// ============================================================
import { getAll, put } from '../db.js';
import { el, uid, toast, openModal } from '../utils.js';
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
      id: uid('block'),
      label: entry.label || '',
      repeatCount: entry.repeatCount || 1,
      sets: (entry.sets || []).map(s => remapSetEntry(s, idMap)),
    };
  }
  return {
    kind: 'set',
    id: uid('set'),
    description: entry?.description || '',
    distance: entry?.distance ?? null,
    reps: entry?.reps || 1,
    intensity: entry?.intensity || '',
    restSec: entry?.restSec ?? 0,
    comments: [],
    exerciseId: entry?.exerciseId && idMap.has(entry.exerciseId) ? idMap.get(entry.exerciseId) : null,
  };
}

// clubId wird bewusst NICHT hier gesetzt — put() (siehe db.js) ergänzt sie
// automatisch anhand des eingeloggten Nutzers, sofern sie im übergebenen
// Objekt fehlt.
export async function importLibrary(dump) {
  const exercises = (Array.isArray(dump.exercises) ? dump.exercises : []).filter(ex => ex && ex.name && ex.category);
  const templates = (Array.isArray(dump.templates) ? dump.templates : []).filter(tpl => tpl && tpl.name);

  const idMap = new Map(); // exportierte exercise.id -> neu vergebene id
  for (const ex of exercises) {
    const saved = await put('exercises', {
      name: ex.name,
      category: ex.category,
      stroke: ex.stroke ?? null,
      description: ex.description || '',
      defaultDistance: ex.defaultDistance ?? null,
      tags: ex.tags || [],
      equipment: ex.equipment || [],
      comments: [],
    });
    if (ex.id) idMap.set(ex.id, saved.id);
  }

  for (const tpl of templates) {
    await put('templates', {
      name: tpl.name,
      description: tpl.description || '',
      tags: tpl.tags || [],
      sets: (tpl.sets || []).map(s => remapSetEntry(s, idMap)),
    });
  }

  return { exercises: exercises.length, templates: templates.length };
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
