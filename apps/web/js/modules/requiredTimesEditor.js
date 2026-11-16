// Gemeinsamer Editor für von Hand erfasste Pflichtzeiten — genutzt vom
// Erfassungsdialog eines Wettkampfs (competitionRequiredTimes.js) und von
// den Normtabellen (requiredTimeSets.js), siehe
// docs/Plans/pflichtzeiten-manuell-plan.md, Abschnitte 2.4 und 3.3.
// Prüf- und Einlese-Logik: requiredTimeRules.js (DOM-frei).
import { el, clear } from '../dom.js';
import { field, selectInput, textInput, dateInput } from '../forms.js';
import { EVENTS } from '../refdata.js';
import { t, trCode } from '../i18n.js';
import { toast } from '../ui.js';
import {
  emptyRow, ruleToRow, validateRows, findOverlaps, parsePastedRows, ruleEvents,
  windowFromInputs, windowError, RULE_GENDERS, RULE_CLASS_TYPES,
} from './requiredTimeRules.js';

const GENDER_KEYS = { '': 'genderAll', W: 'genderW', M: 'genderM' };
const CLASS_KEYS = { '': 'classNone', AL: 'classAL', JG: 'classJG' };

function eventOptions(extraEvents = []) {
  const events = ruleEvents(EVENTS);
  for (const e of extraEvents) if (e && !events.includes(e)) events.push(e);
  return events.map((e) => ({ value: e, label: trCode(e, 'events') }));
}

// Baut den Editor. `rules`/`window` = Ausgangswerte (RequiredTimeRule[] bzw.
// ManualQualifyingWindow). collect() liefert { ok, rules, window } oder
// zeigt die erste Fehlermeldung per toast() und liefert { ok: false }.
// Überlappende Zeilen: beim ersten collect() erscheint ein Hinweis im
// Editor und { ok: false, overlaps } — ein zweiter Aufruf ohne Änderung
// speichert trotzdem (ein Bestätigungsdialog würde dieses Modal schließen,
// siehe modal.js: openModal()).
export function buildRequiredTimesEditor({ rules = [], window = {} } = {}) {
  const rows = rules.length > 0 ? rules.map(ruleToRow) : [emptyRow()];
  const options = [{ value: '', label: '—' }, ...eventOptions(rules.map((r) => r.event))];
  const tableBody = el('tbody');
  const warning = el('div', { class: 'rt-overlap', hidden: true });
  let acknowledgedOverlap = null;

  function drawRows() {
    clear(tableBody);
    if (rows.length === 0) {
      tableBody.appendChild(el('tr', {}, el('td', { colspan: 7, class: 'text-sm' }, t('requiredTimes.noRows'))));
      return;
    }
    rows.forEach((row, i) => {
      const bind = (node, key) => {
        node.addEventListener('input', () => { row[key] = node.value; });
        node.addEventListener('change', () => { row[key] = node.value; });
        return node;
      };
      const label = (key) => ({ 'aria-label': `${t(`requiredTimes.${key}`)} ${i + 1}` });
      tableBody.appendChild(el('tr', {}, [
        el('td', {}, bind(selectInput(options, row.event, label('colEvent')), 'event')),
        el('td', {}, bind(selectInput(RULE_GENDERS.map((g) => ({ value: g, label: t(`requiredTimes.${GENDER_KEYS[g]}`) })), row.gender, label('colGender')), 'gender')),
        el('td', {}, bind(selectInput(RULE_CLASS_TYPES.map((c) => ({ value: c, label: t(`requiredTimes.${CLASS_KEYS[c]}`) })), row.classType, label('colClassType')), 'classType')),
        el('td', {}, bind(textInput(row.min, { inputmode: 'numeric', maxlength: 4, class: 'rt-bound', ...label('colMin') }), 'min')),
        el('td', {}, bind(textInput(row.max, { inputmode: 'numeric', maxlength: 4, class: 'rt-bound', ...label('colMax') }), 'max')),
        el('td', {}, bind(textInput(row.time, { placeholder: t('requiredTimes.timePlaceholder'), class: 'rt-time', ...label('colTime') }), 'time')),
        el('td', { class: 'rt-row-actions' }, [
          el('button', { type: 'button', class: 'btn btn-ghost btn-sm', title: t('requiredTimes.duplicateRow'), 'aria-label': `${t('requiredTimes.duplicateRow')} ${i + 1}`, onclick: () => { rows.splice(i + 1, 0, { ...row }); drawRows(); } }, '⧉'),
          el('button', { type: 'button', class: 'btn btn-ghost btn-sm', title: t('requiredTimes.removeRow'), 'aria-label': `${t('requiredTimes.removeRow')} ${i + 1}`, onclick: () => { rows.splice(i, 1); drawRows(); } }, '×'),
        ]),
      ]));
    });
  }

  const table = el('table', { class: 'rt-table' }, [
    el('thead', {}, el('tr', {}, ['colEvent', 'colGender', 'colClassType', 'colMin', 'colMax', 'colTime'].map((k) => el('th', {}, t(`requiredTimes.${k}`))).concat(el('th', {}, '')))),
    tableBody,
  ]);
  drawRows();

  // Aus Tabelle einfügen
  const pasteText = el('textarea', { rows: 4, class: 'rt-paste', 'aria-label': t('requiredTimes.pasteTitle') });
  const pasteClass = selectInput(RULE_CLASS_TYPES.map((c) => ({ value: c, label: t(`requiredTimes.${CLASS_KEYS[c]}`) })), 'AL');
  const pasteBtn = el('button', {
    type: 'button', class: 'btn btn-ghost btn-sm',
    onclick: () => {
      const { rows: added, errors } = parsePastedRows(pasteText.value, { classType: pasteClass.value, eventOptions: options.slice(1) });
      // Eine einzelne leere Ausgangszeile durch die eingefügten ersetzen.
      if (added.length > 0 && rows.length === 1 && !rows[0].event && !rows[0].time) rows.splice(0, 1);
      rows.push(...added);
      drawRows();
      if (added.length > 0) toast(t('requiredTimes.pasteAdded', { count: added.length }));
      if (errors.length > 0) {
        toast(t('requiredTimes.pasteErrors', { lines: errors.map((n) => t('requiredTimes.pasteLine', { n })).join(', ') }), 'error');
        // Nicht erkannte Zeilen zum Korrigieren stehen lassen.
        pasteText.value = pasteText.value.split(/\r?\n/).filter((_, i) => errors.includes(i + 1)).join('\n');
      } else pasteText.value = '';
    },
  }, t('requiredTimes.pasteButton'));
  const paste = el('details', { class: 'rt-paste-box' }, [
    el('summary', {}, t('requiredTimes.pasteTitle')),
    el('p', { class: 'hint' }, t('requiredTimes.pasteHint')),
    pasteText,
    el('div', { class: 'flex gap-8 items-center rt-paste-actions' }, [field(t('requiredTimes.pasteClassType'), pasteClass), pasteBtn]),
  ]);

  // Nachweiszeitraum
  const fFrom = dateInput(window.from || '');
  const fTo = dateInput(window.to || '');
  const fCourse = selectInput([
    { value: '', label: t('requiredTimes.courseCompetition') },
    { value: 'SCM', label: trCode('SCM', 'courses') },
    { value: 'LCM', label: trCode('LCM', 'courses') },
    { value: 'any', label: t('requiredTimes.courseAny') },
  ], window.course || '');
  const windowBox = el('fieldset', { class: 'rt-window' }, [
    el('legend', {}, t('requiredTimes.windowTitle')),
    el('div', { class: 'form-grid' }, [
      field(t('requiredTimes.windowFrom'), fFrom),
      field(t('requiredTimes.windowTo'), fTo),
      field(t('requiredTimes.windowCourse'), fCourse, { hint: t('requiredTimes.windowHint'), span2: true }),
    ]),
  ]);

  const node = el('div', { class: 'rt-editor' }, [
    el('p', { class: 'hint' }, t('requiredTimes.ageHint')),
    el('div', { class: 'table-wrap' }, table),
    el('div', { class: 'rt-add' }, el('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => { rows.push(emptyRow(rows.length ? { event: rows[rows.length - 1].event, gender: rows[rows.length - 1].gender, classType: rows[rows.length - 1].classType } : {})); drawRows(); } }, t('requiredTimes.addRow'))),
    paste,
    windowBox,
    warning,
  ]);

  function collect() {
    const { rules: valid, errors } = validateRows(rows);
    if (errors.length > 0) { toast(t(`requiredTimes.${errors[0].key}`, { n: errors[0].n }), 'error'); return { ok: false }; }
    const win = windowFromInputs({ from: fFrom.value, to: fTo.value, course: fCourse.value });
    const winErr = windowError(win);
    if (winErr) { toast(t(`requiredTimes.${winErr}`), 'error'); return { ok: false }; }
    const overlaps = findOverlaps(valid);
    const signature = JSON.stringify(valid);
    if (overlaps.length > 0 && acknowledgedOverlap !== signature) {
      acknowledgedOverlap = signature;
      warning.hidden = false;
      warning.textContent = t('requiredTimes.overlapConfirm', { pairs: overlaps.map(([a, b]) => `${a}/${b}`).join(', ') });
      warning.scrollIntoView?.({ block: 'nearest' });
      return { ok: false, overlaps };
    }
    warning.hidden = true;
    return { ok: true, rules: valid, window: win };
  }

  return { node, collect };
}
