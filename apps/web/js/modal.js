// ============================================================
// modal.js — Modal-Dialog und die darauf aufbauende Bestätigungs-Abfrage.
//
// Code-Review, Befund L4: aus utils.js herausgelöst (siehe dom.js für
// den vollständigen Hintergrund der Aufteilung).
// ============================================================
import { el, clear } from './dom.js';
import { t } from './i18n.js';

// Review 30.08.2026, Befund U1: openModal() ist der EINZIGE Dialog-
// Einstiegspunkt der Anwendung — jedes Anlegen-/Bearbeiten-/Löschformular
// läuft hindurch. Bislang fehlten sämtliche Bausteine eines für Tastatur
// und Screenreader nutzbaren Dialogs (Rolle/Name, Fokus hinein, Fokusfalle,
// Fokusrückgabe, ein für den Rest der Seite inerter Hintergrund) — wer
// keine Maus benutzt, konnte keinen Datensatz anlegen, bearbeiten oder
// löschen. Alles unten ist an dieser einen Stelle behoben, ohne dass
// irgendeine der ~20 Aufrufstellen angepasst werden muss.
const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

let modalIdCounter = 0;

export function openModal({ title, bodyNode, wide }) {
  const root = document.getElementById('modal-root');
  clear(root);
  const titleId = `modal-title-${++modalIdCounter}`;
  const box = el('div', {
    class: 'modal-box',
    style: wide ? 'max-width:820px' : '',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-labelledby': titleId,
    tabindex: '-1',
  }, [
    el('div', { class: 'modal-head' }, [
      el('h3', { class: 'mt-0', id: titleId }, title),
      el('button', { class: 'modal-close', 'aria-label': t('common.close'), onclick: () => close() }, '×'),
    ]),
    bodyNode,
  ]);
  root.appendChild(box);
  root.hidden = false;

  // Der Rest der Seite wird für Tastatur/Screenreader unerreichbar, solange
  // der Dialog offen ist — ohne "inert" durchliefe ein Screenreader die
  // verdeckte Ansicht dahinter, als sei kein Dialog offen.
  const appShell = document.getElementById('app-shell');
  appShell?.setAttribute('inert', '');

  // Fokus hinein: auf das erste fokussierbare Element im INHALT (bodyNode),
  // nicht auf das × im Kopf — das steht im DOM vor bodyNode und wäre sonst
  // immer das erste Ergebnis, obwohl es fast nie das ist, was die
  // aufrufende Stelle als sinnvollen Startpunkt meint (das erste Formular-
  // feld, oder bei confirmAction() der "Abbrechen"-Knopf). Ersatzweise die
  // Dialogbox selbst, wenn der Inhalt kein Steuerelement enthält (z. B.
  // ein reiner Info-Text). Die Fokusfalle unten schließt das × trotzdem
  // ein — nur die anfängliche Platzierung überspringt es.
  const previouslyFocused = document.activeElement;
  const firstFocusable =
    bodyNode && typeof bodyNode.matches === 'function' && bodyNode.matches(FOCUSABLE_SELECTOR)
      ? bodyNode
      : bodyNode?.querySelector?.(FOCUSABLE_SELECTOR);
  (firstFocusable || box).focus();

  function onBackdrop(e){ if (e.target === root) close(); }
  root.addEventListener('click', onBackdrop);

  function onKey(e){
    if (e.key === 'Escape') { close(); return; }
    if (e.key !== 'Tab') return;
    // Fokusfalle: Tab am letzten fokussierbaren Element springt zum ersten
    // zurück (und umgekehrt bei Shift+Tab) — ohne das verlässt Tab den
    // Dialog in die (nur visuell verdeckte) Seite dahinter.
    const focusable = [...box.querySelectorAll(FOCUSABLE_SELECTOR)];
    if (focusable.length === 0) { e.preventDefault(); return; }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault(); last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault(); first.focus();
    }
  }
  document.addEventListener('keydown', onKey);

  function close() {
    root.hidden = true; clear(root);
    root.removeEventListener('click', onBackdrop);
    document.removeEventListener('keydown', onKey);
    appShell?.removeAttribute('inert');
    // Fokusrückgabe: ohne diese landet der Fokus nach dem Schließen auf
    // <body>, und die Position in der aufrufenden Liste/Ansicht ist verloren.
    if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
      previouslyFocused.focus();
    }
  }
  return { close, box };
}

export function confirmAction(message, onConfirm, opts = {}) {
  const body = el('div', {}, [
    el('p', {}, message),
    el('div', { class: 'form-actions' }, [
      el('button', { class: 'btn btn-ghost', onclick: () => close() }, t('common.cancel')),
      el('button', { class: 'btn btn-danger', onclick: () => { close(); onConfirm(); } }, opts.confirmLabel || t('common.delete')),
    ]),
  ]);
  const { close } = openModal({ title: opts.title || t('common.confirmTitle'), bodyNode: body });
}
