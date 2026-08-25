// ============================================================
// modal.js — Modal-Dialog und die darauf aufbauende Bestätigungs-Abfrage.
//
// Code-Review, Befund L4: aus utils.js herausgelöst (siehe dom.js für
// den vollständigen Hintergrund der Aufteilung).
// ============================================================
import { el, clear } from './dom.js';
import { t } from './i18n.js';

export function openModal({ title, bodyNode, wide }) {
  const root = document.getElementById('modal-root');
  clear(root);
  const box = el('div', { class: 'modal-box', style: wide ? 'max-width:820px' : '' }, [
    el('div', { class: 'modal-head' }, [
      el('h3', { class: 'mt-0' }, title),
      el('button', { class: 'modal-close', 'aria-label': t('common.close'), onclick: () => close() }, '×'),
    ]),
    bodyNode,
  ]);
  root.appendChild(box);
  root.hidden = false;
  function onBackdrop(e){ if (e.target === root) close(); }
  root.addEventListener('click', onBackdrop);
  function onKey(e){ if (e.key === 'Escape') close(); }
  document.addEventListener('keydown', onKey);
  function close() {
    root.hidden = true; clear(root);
    root.removeEventListener('click', onBackdrop);
    document.removeEventListener('keydown', onKey);
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
