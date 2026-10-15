// JSON-Export/Import eines EINZELNEN Trainingsplans (plans) — Gegenstück
// zu libraryTransfer.js, das Vorlagen/Übungskatalog als Bundle überträgt.
//
// Wie dort gilt: Der Export enthält weder clubId noch Kommentare (inkl.
// authorName/authorId, siehe CommentSchema in
// packages/shared-types/src/entities.ts) noch die Plan-id — die Datei ist
// damit frei zwischen Trainer:innen und Vereinen teilbar. Die Gruppe wird
// nur über ihren NAMEN referenziert (groupName), da groups.id vereins-
// gebunden ist; beim Import wird sie per Namensgleichheit einer
// vorhandenen Gruppe zugeordnet, sonst bleibt groupId null (PlanSchema
// erlaubt das).
//
// Übungsverknüpfungen (sets[].exerciseId): Der Export bettet die im Plan
// referenzierten Katalogübungen mit ein. Beim Import wird jede davon
// zuerst über die exportierte id (Rück-Import in denselben Verein), dann
// über Name + Kategorie (Groß-/Kleinschreibung egal) einer vorhandenen
// Übung zugeordnet und nur, wenn beides fehlschlägt, neu angelegt — ein
// mehrfach importierter Plan dupliziert den Katalog also nicht.
//
// Plan-id und neue Übungs-ids kommen aus uid() (db.js, UUID — siehe die
// Begründung in libraryTransfer.js); eingebettete Set-/Block-/Abschnitts-
// ids aus localId() (dom.js).
import { getAll, put, uid } from '../db.js';
import { getCurrentUser } from '../state.js';
import { el, localId } from '../dom.js';
import { toast } from '../ui.js';
import { openModal } from '../modal.js';
import { navigate } from '../router.js';
import { dateOnly, toIsoDateTime, startOfWeek, todayISO } from '../dates.js';
import { COURSES } from '../refdata.js';
import { t } from '../i18n.js';
import { downloadJSON } from './libraryTransfer.js';

export const PLAN_EXPORT_FORMAT = 'lane1-plan-export-v1';

const COURSE_VALUES = new Set(COURSES.map(c => c.value));

function stripSetEntry(entry) {
  if (entry.kind === 'block') {
    return {
      kind: 'block',
      label: entry.label || '',
      repeatCount: entry.repeatCount || 1,
      sets: (entry.sets || []).map(stripSetEntry),
    };
  }
  if (entry.kind === 'section') {
    return {
      kind: 'section',
      heading: entry.heading || '',
      entries: (entry.entries || []).map(stripSetEntry),
    };
  }
  return {
    kind: 'set',
    description: entry.description || '',
    distance: entry.distance ?? null,
    durationSec: entry.durationSec ?? null,
    reps: entry.reps ?? 1,
    intensity: entry.intensity || '',
    restSec: entry.restSec ?? 0,
    exerciseId: entry.exerciseId || null,
    // Fehlendes Feld ≠ leeres Array (siehe PlainSetSchema.equipment) —
    // daher nur übernehmen, wenn tatsächlich gesetzt.
    ...(Array.isArray(entry.equipment) ? { equipment: [...entry.equipment] } : {}),
  };
}

function collectExerciseIds(entries, ids = new Set()) {
  (entries || []).forEach(entry => {
    if (entry.kind === 'block') collectExerciseIds(entry.sets, ids);
    else if (entry.kind === 'section') collectExerciseIds(entry.entries, ids);
    else if (entry.exerciseId) ids.add(entry.exerciseId);
  });
  return ids;
}

export function buildPlanExport(plan, { groups = [], exercises = [] } = {}) {
  const usedIds = new Set();
  (plan.days || []).forEach(d => collectExerciseIds(d.sets, usedIds));
  const group = groups.find(g => g.id === plan.groupId);
  return {
    format: PLAN_EXPORT_FORMAT,
    exportedAt: new Date().toISOString(),
    plan: {
      name: plan.name,
      weekStart: plan.weekStart,
      status: plan.status,
      groupName: group?.name ?? null,
      days: (plan.days || []).map(d => ({
        date: d.date,
        poolLength: d.poolLength ?? null,
        sets: (d.sets || []).map(stripSetEntry),
      })),
    },
    exercises: exercises.filter(ex => usedIds.has(ex.id)).map(ex => ({
      id: ex.id,
      name: ex.name,
      category: ex.category,
      stroke: ex.stroke ?? null,
      description: ex.description || '',
      defaultDistance: ex.defaultDistance ?? null,
      defaultDurationSec: ex.defaultDurationSec ?? null,
      tags: ex.tags || [],
      equipment: ex.equipment || [],
    })),
  };
}

export function parsePlanImport(raw) {
  let dump;
  try { dump = JSON.parse(raw); } catch { throw new Error('invalid-json'); }
  if (!dump || dump.format !== PLAN_EXPORT_FORMAT || !dump.plan || typeof dump.plan !== 'object') throw new Error('invalid-format');
  return dump;
}

function isValidDate(value) {
  const d = dateOnly(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d + 'T00:00:00.000Z'));
}

function intOr(value, fallback, { min = 0 } = {}) {
  return Number.isInteger(value) && value >= min ? value : fallback;
}

function remapSetEntry(entry, idMap) {
  if (entry?.kind === 'block') {
    return {
      kind: 'block',
      id: localId('block'),
      label: entry.label || '',
      repeatCount: intOr(entry.repeatCount, 1, { min: 1 }),
      sets: (entry.sets || []).filter(s => s?.kind !== 'block' && s?.kind !== 'section').map(s => remapSetEntry(s, idMap)),
    };
  }
  if (entry?.kind === 'section') {
    return {
      kind: 'section',
      id: localId('section'),
      heading: entry.heading || '',
      entries: (entry.entries || []).filter(s => s?.kind !== 'section').map(s => remapSetEntry(s, idMap)),
    };
  }
  return {
    kind: 'set',
    id: localId('set'),
    description: entry?.description || '',
    distance: intOr(entry?.distance, null),
    durationSec: intOr(entry?.durationSec, null, { min: 1 }),
    reps: intOr(entry?.reps, 1, { min: 1 }),
    intensity: entry?.intensity || '',
    restSec: intOr(entry?.restSec, 0),
    comments: [],
    exerciseId: entry?.exerciseId && idMap.has(entry.exerciseId) ? idMap.get(entry.exerciseId) : null,
    ...(Array.isArray(entry?.equipment) ? { equipment: entry.equipment.filter(eq => typeof eq === 'string') } : {}),
  };
}

const exerciseKey = (ex) => `${String(ex.name).trim().toLowerCase()}\u0000${String(ex.category).trim().toLowerCase()}`;

// Legt den importierten Plan als NEUEN Plan im Verein der eingeloggten
// Person an (clubId/Zeitstempel/Sync-Event übernimmt put(), siehe db.js).
// Gibt den gespeicherten Plan sowie die Zahl neu angelegter Übungen zurück.
export async function importPlan(dump) {
  const src = dump.plan;
  const [existingExercises, groups] = await Promise.all([getAll('exercises'), getAll('groups')]);
  const byId = new Map(existingExercises.map(ex => [ex.id, ex]));
  const byKey = new Map(existingExercises.map(ex => [exerciseKey(ex), ex]));
  // Wie in libraryTransfer.js explizit gesetzt statt nur auf put()'s
  // clubIdProvider zu vertrauen — die clubId stammt nie aus der Datei.
  const clubId = getCurrentUser()?.clubId;
  const club = clubId ? { clubId } : {};

  const idMap = new Map(); // exportierte exercise.id -> id im eigenen Verein
  let createdExercises = 0;
  const fileExercises = (Array.isArray(dump.exercises) ? dump.exercises : []).filter(ex => ex && ex.id && ex.name && ex.category);
  for (const ex of fileExercises) {
    const match = byId.get(ex.id) || byKey.get(exerciseKey(ex));
    if (match) { idMap.set(ex.id, match.id); continue; }
    const saved = await put('exercises', {
      id: uid(),
      ...club,
      name: ex.name,
      category: ex.category,
      stroke: ex.stroke ?? null,
      description: ex.description || '',
      defaultDistance: ex.defaultDistance ?? null,
      defaultDurationSec: ex.defaultDurationSec ?? null,
      tags: Array.isArray(ex.tags) ? ex.tags : [],
      equipment: Array.isArray(ex.equipment) ? ex.equipment : [],
      comments: [],
    });
    idMap.set(ex.id, saved.id);
    byKey.set(exerciseKey(saved), saved);
    createdExercises++;
  }

  const groupName = typeof src.groupName === 'string' ? src.groupName.trim().toLowerCase() : '';
  const group = groupName ? groups.find(g => String(g.name).trim().toLowerCase() === groupName) : null;
  const weekStart = isValidDate(src.weekStart) ? dateOnly(src.weekStart) : startOfWeek(todayISO());

  const plan = await put('plans', {
    id: uid(),
    ...club,
    name: (typeof src.name === 'string' && src.name.trim()) || t('planTransfer.importedPlanName'),
    weekStart: toIsoDateTime(weekStart),
    groupId: group?.id ?? null,
    status: src.status === 'archiv' ? 'archiv' : 'aktiv',
    comments: [],
    days: (Array.isArray(src.days) ? src.days : []).filter(d => d && isValidDate(d.date)).map(d => ({
      date: toIsoDateTime(d.date),
      poolLength: COURSE_VALUES.has(d.poolLength) ? d.poolLength : null,
      sets: (Array.isArray(d.sets) ? d.sets : []).map(s => remapSetEntry(s, idMap)),
    })),
  });
  return { plan, createdExercises };
}

function safeFilename(name) {
  return String(name || 'plan').normalize('NFKD').replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'plan';
}

export async function exportPlanToJson(plan) {
  const [groups, exercises] = await Promise.all([getAll('groups'), getAll('exercises')]);
  const dump = buildPlanExport(plan, { groups, exercises });
  downloadJSON(`lane1-plan-${safeFilename(plan.name)}.json`, dump);
  toast(t('planTransfer.exportStarted'));
}

function openImportConfirmModal(dump) {
  const days = Array.isArray(dump.plan.days) ? dump.plan.days.length : 0;
  const body = el('div', {}, [
    el('p', {}, t('planTransfer.importConfirm', { name: dump.plan.name || '—', days })),
    el('div', { class: 'form-actions' }, [
      el('button', { class: 'btn btn-ghost', onclick: () => close() }, t('common.cancel')),
      el('button', {
        class: 'btn btn-primary',
        onclick: async () => {
          close();
          try {
            const { plan, createdExercises } = await importPlan(dump);
            toast(createdExercises > 0 ? t('planTransfer.importDoneWithExercises', { count: createdExercises }) : t('planTransfer.importDone'));
            navigate('plans', plan.id);
          } catch {
            toast(t('planTransfer.importError'), 'error');
          }
        },
      }, t('planTransfer.importButton')),
    ]),
  ]);
  const { close } = openModal({ title: t('planTransfer.importConfirmTitle'), bodyNode: body });
}

// "Import (JSON)"-Button für die Planliste — liest eine per
// exportPlanToJson() erzeugte Datei und legt daraus einen neuen Plan an.
export function planImportButton() {
  const fileInput = el('input', {
    type: 'file', accept: 'application/json,.json', style: 'display:none',
    onchange: async (e) => {
      const file = e.target.files[0];
      fileInput.value = '';
      if (!file) return;
      try {
        openImportConfirmModal(parsePlanImport(await file.text()));
      } catch {
        toast(t('planTransfer.importError'), 'error');
      }
    },
  });
  const btn = el('button', { class: 'btn btn-ghost', onclick: () => fileInput.click() }, t('planTransfer.importButton'));
  return el('span', { style: 'display:inline-flex' }, [btn, fileInput]);
}
