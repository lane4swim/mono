// ============================================================
// forms.js — Formularfeld-Hilfsfunktionen.
//
// Code-Review, Befund L4: aus utils.js herausgelöst (siehe dom.js für
// den vollständigen Hintergrund der Aufteilung).
// ============================================================
import { el } from './dom.js';
import { dateOnly } from './dates.js';
import { t } from './i18n.js';

// Review 30.08.2026, Befund U2: field() rendert das <label> und das
// Eingabefeld nebeneinander im DOM, aber ohne jede programmatische
// Verbindung (kein "for"/"id") — Screenreader kündigten JEDES
// Formularfeld der Anwendung als "Eingabefeld, leer" an, unabhängig vom
// sichtbaren Beschriftungstext, und ein Klick auf die Beschriftung
// fokussierte das Feld nicht. Da praktisch jedes Formular der Anwendung
// über field() läuft, behebt eine Verbindung hier alle Aufrufstellen auf
// einmal, ohne dass eine von ihnen angefasst werden muss.
let fieldIdCounter = 0;

// inputNode ist meist das Eingabefeld selbst, gelegentlich (z. B.
// athletes.js: das Aktiv-Kästchen mit begleitendem Text) ein umschließendes
// <div> — in dem Fall gehört "for" auf das tatsächlich fokussierbare
// Steuerelement darin, nicht auf den Wrapper (ein <label for> auf ein
// nicht fokussierbares <div> wäre wirkungslos).
function resolveLabelTarget(node) {
  if (!node || typeof node.querySelector !== 'function') return null;
  if (node.tagName === 'INPUT' || node.tagName === 'SELECT' || node.tagName === 'TEXTAREA') return node;
  return node.querySelector('input, select, textarea');
}

export function field(labelText, inputNode, opts = {}) {
  const hintNode = opts.hint ? el('div', { class: 'hint' }, opts.hint) : null;
  const target = resolveLabelTarget(inputNode);
  if (target) {
    if (!target.id) target.id = `field-${++fieldIdCounter}`;
    if (hintNode) {
      if (!hintNode.id) hintNode.id = `${target.id}-hint`;
      target.setAttribute('aria-describedby', hintNode.id);
    }
  }
  return el('div', { class: `field ${opts.span2 ? 'span-2' : ''}` }, [
    el('label', target ? { for: target.id } : {}, labelText),
    inputNode,
    hintNode,
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
