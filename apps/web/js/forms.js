// ============================================================
// forms.js — Formularfeld-Hilfsfunktionen.
//
// Code-Review, Befund L4: aus utils.js herausgelöst (siehe dom.js für
// den vollständigen Hintergrund der Aufteilung).
// ============================================================
import { el } from './dom.js';
import { dateOnly } from './dates.js';
import { t } from './i18n.js';

export function field(labelText, inputNode, opts = {}) {
  return el('div', { class: `field ${opts.span2 ? 'span-2' : ''}` }, [
    el('label', {}, labelText),
    inputNode,
    opts.hint ? el('div', { class: 'hint' }, opts.hint) : null,
  ]);
}

// Der Cancel/Submit-Knopfblock, den praktisch jedes Formular-Modal am
// Fußende braucht — bislang in jedem der ~16 openXModal()-Helfer über das
// ganze Frontend hinweg wortgleich (bis auf `submitLabel`) ausgeschrieben.
// `submitLabel` bleibt bewusst ein einfacher String statt eines
// `isEdit`-Flags: die aufrufende Stelle kennt ihre eigene Beschriftungs-
// logik (meist `isEdit ? t('common.save') : t('common.create')`, aber
// nicht überall — z. B. immer "Speichern" bei Ergebnissen/Zeiten, oder ein
// aus einem anderen Schlüssel abgeleiteter Text) — diese Funktion muss sie
// dafür nicht kennen. Gibt zusätzlich zum fertigen Element auch den
// Submit-Button selbst zurück: einige Aufrufer (z. B. Formulare mit
// serverseitigem Fehler-Feedback statt eines einfachen toast()) müssen ihn
// während eines laufenden Speichervorgangs deaktivieren können.
export function formActions({ onCancel, submitLabel, extraClass = '', spanFull = true }) {
  const submitBtn = el('button', { type: 'submit', class: 'btn btn-primary' }, submitLabel);
  const row = el('div', { class: `form-actions ${extraClass}`.trim(), style: spanFull ? 'grid-column:1/-1' : '' }, [
    el('button', { type: 'button', class: 'btn btn-ghost', onclick: onCancel }, t('common.cancel')),
    submitBtn,
  ]);
  return { row, submitBtn };
}

export function textInput(value = '', attrs = {}) {
  return el('input', { type: 'text', value: value ?? '', ...attrs });
}
// <input type="date"> akzeptiert als value ausschließlich "YYYY-MM-DD" —
// dateOnly() sorgt dafür, dass ein bereits synchronisierter, als
// vollständiger ISO-Zeitstempel vorliegender Wert (siehe dates.js:
// dateOnly()) hier nicht zu einem leeren/kaputten Feld führt.
export function dateInput(value = '', attrs = {}) {
  return el('input', { type: 'date', value: dateOnly(value), ...attrs });
}
export function selectInput(options, value, attrs = {}) {
  const sel = el('select', attrs);
  for (const opt of options) {
    const o = el('option', { value: opt.value }, opt.label);
    if (String(opt.value) === String(value)) o.setAttribute('selected', '');
    sel.appendChild(o);
  }
  return sel;
}
