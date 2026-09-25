// Trainingsmodus ("live mode") für Trainingspläne, analog zum
// Wettkampfmodus in competitionLive.js (Issue #78). Nur für Trainer:innen/
// Admins (Rollenprüfung sitzt beim Aufrufer, siehe plans.js) — im
// Unterschied zum Wettkampfmodus, dessen Lauf-Position über die URL
// reload-fest ist (siehe dortiger Dateikopf), gilt das hier NUR für die
// Plan-/Tagauswahl: welche Sätze eines Trainingstages bereits abgehakt
// sind, lebt bewusst ausschließlich als In-Memory-Zustand in diesem
// Render-Aufruf (buildDayChecklist()/buildSetRow() unten) und ist beim
// Verlassen des Trainingsmodus — auch bei einem bloßen Reload — wieder
// weg, wie in Issue #78 gefordert ("wird nicht dauerhaft gespeichert").
import { getAll } from '../db.js';
import { el, beginRender } from '../dom.js';
import { badge, emptyState, laneWave } from '../ui.js';
import { fmtDateLong } from '../dates.js';
import { navigate } from '../router.js';
import { t, trLabel } from '../i18n.js';
import { EQUIPMENT_ITEMS, SET_INTENSITIES } from '../refdata.js';
import { equipmentForEntry, formatDuration } from './setEditor.js';
import { acquireWakeLock } from '../wakeLock.js';

// Flacht die (ggf. verschachtelten) Einträge eines Trainingstages auf eine
// einfache Liste einzeln abhakbarer Sätze ab. Wiederholungsblöcke und
// Abschnitte sind reine Anzeige-/Gruppierungskonstrukte (siehe setEditor.js
// Dateikopf) — im Trainingsmodus zählt jeder enthaltene Satz für sich als
// EIN abhakbarer Eintrag, unabhängig von `reps` (Wiederholungen
// INNERHALB eines Satzes) oder dem `repeatCount` eines umgebenden Blocks
// (Wiederholungen des GANZEN Blocks): beides bleibt reine Anzeigeangabe
// in der Zeile, exakt wie in der bestehenden schreibgeschützten
// Plananzeige (appendEntryRows() in plans.js), die dieselbe Distanz/Zeit
// ebenfalls nur als eine Zeile zeigt statt sie zu vervielfachen.
export function buildDayChecklist(items, sectionHeading = null) {
  const rows = [];
  (items || []).forEach(entry => {
    if (entry.kind === 'block') {
      // blockId markiert, welche aufeinanderfolgenden Zeilen zu EINEM
      // Wiederholungsblock gehören — renderLiveMode() gruppiert Zeilen mit
      // derselben blockId visuell in einer gemeinsamen Box (siehe dort),
      // statt wie zuvor auf jeder Zeile einzeln denselben "N× Wiederholung"-
      // Hinweis zu wiederholen (Ursache der Mehrdeutigkeit aus Issue: war
      // nicht erkennbar, ob "Satz 1 x2, Satz 2 x2" oder "(Satz 1, Satz 2) x2"
      // gemeint war).
      buildDayChecklist(entry.sets || [], sectionHeading).forEach(row => rows.push({
        ...row, blockId: entry.id, blockLabel: entry.label, blockRepeatCount: entry.repeatCount || 1,
      }));
    } else if (entry.kind === 'section') {
      rows.push(...buildDayChecklist(entry.entries || [], entry.heading));
    } else {
      rows.push({ id: entry.id, entry, sectionHeading, blockId: null, blockLabel: null, blockRepeatCount: null });
    }
  });
  return rows;
}

export async function renderLiveMode(container, planId, dayIndex) {
  // Issue #78: der Trainingsmodus läuft am Beckenrand, wo niemand
  // zwischen zwei Sätzen Zeit hat, den Bildschirm manuell wieder
  // einzuschalten — siehe wakeLock.js zur zentralen Freigabe beim
  // Verlassen (shell.js: renderRoute()).
  acquireWakeLock();
  // Code-Review: zwei sequenzielle awaits unten (getAll('plans'), dann
  // bedingt getAll('exercises')) — ein überholter, langsamerer Aufruf
  // (schnelles Doppelklicken auf "Nächster Tag"/Vor-Zurück-Navigation)
  // darf nach einem neueren Render nicht mehr selbst ins DOM schreiben,
  // siehe dom.js: beginRender().
  const isCurrent = beginRender(container);
  const plans = await getAll('plans');
  if (!isCurrent()) return;
  const plan = plans.find(p => p.id === planId);

  const wrap = el('div');
  wrap.appendChild(el('button', { class: 'btn btn-ghost btn-sm mb-16', onclick: () => navigate('plans', planId) }, t('plans.backToPlan')));

  if (!plan) {
    wrap.appendChild(emptyState(t('common.notFoundTitle'), t('plans.notFoundMsg'), el('button', { class: 'btn btn-primary', onclick: () => navigate('plans') }, t('common.back'))));
    container.appendChild(wrap);
    return;
  }

  const exercises = await getAll('exercises');
  if (!isCurrent()) return;
  const days = (plan.days || []).slice().sort((a, b) => a.date.localeCompare(b.date));

  wrap.appendChild(el('div', { class: 'page-head' }, [
    el('div', {}, [el('div', { class: 'page-eyebrow' }, plan.name), el('h1', { class: 'mt-0' }, t('plans.liveModeTitle'))]),
  ]));
  wrap.appendChild(laneWave());

  if (days.length === 0) {
    wrap.appendChild(emptyState(t('common.nothingHereTitle'), t('plans.liveModeNoDays'), null));
    container.appendChild(wrap);
    return;
  }

  const idx = Math.min(Math.max(dayIndex, 0), days.length - 1);
  const day = days[idx];
  const isLast = idx >= days.length - 1;

  const headerCard = el('div', { class: 'card mb-16' }, [
    el('div', { class: 'flex justify-between items-center', style: 'flex-wrap:wrap;gap:12px' }, [
      el('div', {}, [
        el('div', { class: 'page-eyebrow' }, t('plans.liveModePosition', { current: idx + 1, total: days.length })),
        el('h2', { class: 'mt-0', style: 'margin-bottom:0' }, fmtDateLong(day.date)),
      ]),
      isLast
        ? badge(t('plans.liveModeLastDay'), 'done')
        : el('button', { class: 'btn btn-primary', onclick: () => navigate('plans', planId, 'live', String(idx + 1)) }, t('plans.liveModeNextDay')),
    ]),
  ]);
  wrap.appendChild(headerCard);

  const rows = buildDayChecklist(day.sets || []);
  if (rows.length === 0) {
    wrap.appendChild(emptyState(t('common.nothingHereTitle'), t('plans.noSetsPlanned'), null));
  } else {
    // Bewusst NICHT über put() persistiert (siehe Dateikopf) — lebt nur,
    // solange dieser Render-Aufruf besteht.
    const checkedIds = new Set();
    appendChecklistGroups(wrap, rows, exercises, checkedIds);
  }

  wrap.appendChild(el('button', { class: 'btn btn-ghost mt-16', onclick: () => navigate('plans', planId) }, t('plans.liveModeEnd')));

  container.appendChild(wrap);
}

// Hängt rows als eine Folge von Tabellen/Boxen an host an: einzelne Sätze
// (blockId === null) landen wie bisher zusammen in einer flachen Tabelle;
// aufeinanderfolgende Zeilen mit derselben blockId (siehe buildDayChecklist())
// gehören zu EINEM Wiederholungsblock und werden stattdessen gemeinsam in
// eine umrandete Box mit genau EINEM "N× Wiederholung"-Badge gepackt (Optik
// angelehnt an renderBlockBox() in plans.js). Das macht sichtbar, dass sich
// die GESAMTE Abfolge der Box N-mal wiederholt (2 × (Satz 1, Satz 2)) statt,
// wie zuvor bei einem Hinweistext auf jeder einzelnen Zeile, fälschlich zu
// suggerieren, jeder Satz für sich wiederhole sich (Satz 1 × 2, Satz 2 × 2).
function appendChecklistGroups(host, rows, exercises, checkedIds) {
  let pending = [];
  const flushPending = () => {
    if (pending.length === 0) return;
    host.appendChild(el('div', { class: 'table-wrap' }, buildChecklistTable(pending, exercises, checkedIds)));
    pending = [];
  };
  let i = 0;
  while (i < rows.length) {
    const row = rows[i];
    if (row.blockId) {
      flushPending();
      const groupRows = [];
      while (i < rows.length && rows[i].blockId === row.blockId) { groupRows.push(rows[i]); i++; }
      host.appendChild(buildBlockBox(row.blockLabel, row.blockRepeatCount, groupRows, exercises, checkedIds));
    } else {
      pending.push(row);
      i++;
    }
  }
  flushPending();
}

function buildChecklistTable(rows, exercises, checkedIds) {
  const table = el('table');
  table.appendChild(el('thead', {}, el('tr', {}, [
    el('th', {}, t('plans.colDescription')),
    el('th', {}, t('plans.colIntensity')),
    el('th', {}, t('plans.colDistance')),
    el('th', {}, t('plans.colDuration')),
    el('th', {}, t('plans.colReps')),
    el('th', {}, t('plans.colRest')),
  ])));
  const tbody = el('tbody');
  rows.forEach(row => tbody.appendChild(buildSetRow(row, exercises, checkedIds)));
  table.appendChild(tbody);
  return table;
}

// Eine Box je Wiederholungsblock: EIN Badge/Hinweis oberhalb der (in sich
// flachen) Tabelle der Blocksätze statt eines je Zeile wiederholten
// Hinweistexts (siehe appendChecklistGroups() oben zur Begründung).
function buildBlockBox(label, repeatCount, rows, exercises, checkedIds) {
  const box = el('div', { class: 'day-block', style: 'margin:4px 0 12px;border-style:dashed;border-color:var(--c-chlorine-d);background:var(--c-foam-2)' });
  box.appendChild(el('div', { class: 'day-block-head' }, [
    el('div', { class: 'flex items-center gap-8' }, [badge(t('plans.repeatBlockLabel', { n: repeatCount }), 'progress'), el('strong', {}, label || t('templates.defaultBlockLabel'))]),
  ]));
  box.appendChild(el('p', { class: 'hint', style: 'margin:0 0 10px' }, t('plans.liveModeBlockHint', { n: repeatCount })));
  box.appendChild(el('div', { class: 'table-wrap' }, buildChecklistTable(rows, exercises, checkedIds)));
  return box;
}

// Eine Tabellenzeile je abhakbarem Satz — Spalten/Optik bewusst identisch
// zur schreibgeschützten Plananzeige (appendEntryRows() in plans.js), nur
// um eine Abhak-Checkbox sowie die Kontextzeile (Abschnitt, siehe
// buildDayChecklist() oben) in der Beschreibungszelle ergänzt. Der
// Wiederholungsblock-Hinweis steht NICHT mehr hier (siehe buildBlockBox()
// oben) — genau das war die Ursache der Mehrdeutigkeit. Abgehakte Zeilen
// bekommen die Klasse live-row-done (siehe styles.css), analog zur
// früheren Kartenoptik.
function buildSetRow(row, exercises, checkedIds) {
  const { entry } = row;
  const equipment = equipmentForEntry(entry, exercises);
  const tr = el('tr');

  const checkbox = el('input', { type: 'checkbox' });
  checkbox.addEventListener('change', () => {
    if (checkbox.checked) checkedIds.add(row.id); else checkedIds.delete(row.id);
    tr.classList.toggle('live-row-done', checkbox.checked);
  });

  const descCell = el('div');
  descCell.appendChild(el('label', { class: 'flex items-center gap-8', style: 'cursor:pointer' }, [
    checkbox,
    el('strong', { class: 'live-set-desc' }, entry.description || t('plans.liveModeUnnamedSet')),
  ]));
  if (row.sectionHeading) descCell.appendChild(el('p', { class: 'text-sm hint', style: 'margin:4px 0 0' }, row.sectionHeading));
  if (equipment.length > 0) {
    descCell.appendChild(el('div', { class: 'pill-group', style: 'margin-top:4px' }, equipment.map(eq => badge(trLabel(EQUIPMENT_ITEMS, eq, 'equipment'), 'pb'))));
  }
  tr.appendChild(el('td', {}, descCell));

  tr.appendChild(el('td', {}, trLabel(SET_INTENSITIES, entry.intensity || 'ga1', 'setIntensities')));
  tr.appendChild(el('td', {}, `${entry.distance ?? '—'} m`));
  tr.appendChild(el('td', {}, entry.durationSec != null ? formatDuration(entry.durationSec) : '—'));
  tr.appendChild(el('td', {}, entry.reps));
  tr.appendChild(el('td', {}, `${entry.restSec || 0}s`));
  return tr;
}
