// @vitest-environment jsdom
//
// apps/web/test/modal.test.js
//
// Regressionstests für Review 30.08.2026, Befund U1: openModal() ist der
// einzige Dialog-Einstiegspunkt der Anwendung (Anlegen-/Bearbeiten-/
// Löschformulare, confirmAction()) und trug bislang keinen der Bausteine,
// die einen Dialog für Tastatur- und Screenreader-Nutzung bedienbar
// machen — jeder Test unten fällt ohne den jeweiligen Fix nachweislich
// durch (per Hand gegen den vorherigen Stand geprüft).
import { describe, it, expect, beforeEach } from 'vitest';
import { openModal } from '../js/modal.js';
import { el } from '../js/dom.js';

function setupDom() {
  document.body.innerHTML = '';
  const trigger = document.createElement('button');
  trigger.textContent = 'Öffnen';
  document.body.appendChild(trigger);
  const appShell = document.createElement('div');
  appShell.id = 'app-shell';
  document.body.appendChild(appShell);
  const modalRoot = document.createElement('div');
  modalRoot.id = 'modal-root';
  modalRoot.hidden = true;
  document.body.appendChild(modalRoot);
  return { trigger, appShell, modalRoot };
}

function fireKey(target, key, opts = {}) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...opts });
  target.dispatchEvent(event);
  return event;
}

describe('openModal() — Barrierefreiheit (Befund U1)', () => {
  let dom;

  beforeEach(() => { dom = setupDom(); });

  it('kennzeichnet die Dialogbox mit role="dialog"/aria-modal und verknüpft sie mit dem Titel', () => {
    const { box } = openModal({ title: 'Athlet:in bearbeiten', bodyNode: el('p', {}, 'Inhalt') });
    expect(box.getAttribute('role')).toBe('dialog');
    expect(box.getAttribute('aria-modal')).toBe('true');
    const labelledBy = box.getAttribute('aria-labelledby');
    expect(labelledBy).toBeTruthy();
    const titleNode = document.getElementById(labelledBy);
    expect(titleNode?.textContent).toBe('Athlet:in bearbeiten');
  });

  it('setzt den Fokus beim Öffnen auf das erste fokussierbare Element im Dialog', () => {
    const input = el('input', { type: 'text' });
    openModal({ title: 'Formular', bodyNode: el('div', {}, [input]) });
    expect(document.activeElement).toBe(input);
  });

  it('fokussiert die Dialogbox selbst, wenn kein Steuerelement im Inhalt vorhanden ist', () => {
    const { box } = openModal({ title: 'Hinweis', bodyNode: el('p', {}, 'Nur Text, kein Formular.') });
    expect(document.activeElement).toBe(box);
  });

  it('macht den Rest der Anwendung inert, solange der Dialog offen ist, und hebt das beim Schließen wieder auf', () => {
    const { close } = openModal({ title: 'Formular', bodyNode: el('input', { type: 'text' }) });
    expect(dom.appShell.hasAttribute('inert')).toBe(true);
    close();
    expect(dom.appShell.hasAttribute('inert')).toBe(false);
  });

  it('gibt den Fokus beim Schließen an das zuvor fokussierte Element zurück', () => {
    dom.trigger.focus();
    expect(document.activeElement).toBe(dom.trigger);
    const { close } = openModal({ title: 'Formular', bodyNode: el('input', { type: 'text' }) });
    expect(document.activeElement).not.toBe(dom.trigger);
    close();
    expect(document.activeElement).toBe(dom.trigger);
  });

  // Die Fokusfalle umfasst den GESAMTEN Dialog (Kopf inkl. ×-Knopf +
  // Inhalt) — nur die anfängliche Fokusplatzierung oben überspringt das ×.
  // Im DOM steht das × vor bodyNode, ist also das erste Element der Falle.
  it('hält den Fokus in der Fokusfalle: Tab am letzten Element springt zurück zum ×-Knopf (erstes Element im Dialog)', () => {
    const last = el('button', { type: 'button' }, 'Speichern');
    const { box } = openModal({ title: 'Formular', bodyNode: el('div', {}, [el('input', { type: 'text' }), last]) });
    const closeButton = box.querySelector('.modal-close');

    last.focus();
    expect(document.activeElement).toBe(last);
    const event = fireKey(document, 'Tab');
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(closeButton);
  });

  it('hält die Fokusfalle rückwärts: Shift+Tab am ×-Knopf springt zum letzten Element im Dialog', () => {
    const last = el('button', { type: 'button' }, 'Speichern');
    const { box } = openModal({ title: 'Formular', bodyNode: el('div', {}, [el('input', { type: 'text' }), last]) });
    const closeButton = box.querySelector('.modal-close');

    closeButton.focus();
    const event = fireKey(document, 'Tab', { shiftKey: true });
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(last);
  });

  it('schließt den Dialog bei Escape und gibt den Fokus zurück', () => {
    dom.trigger.focus();
    openModal({ title: 'Formular', bodyNode: el('input', { type: 'text' }) });
    fireKey(document, 'Escape');
    expect(dom.modalRoot.hidden).toBe(true);
    expect(document.activeElement).toBe(dom.trigger);
  });

  it('schließt den Dialog bei einem Klick auf den Hintergrund (nicht auf die Box selbst)', () => {
    const { box } = openModal({ title: 'Formular', bodyNode: el('input', { type: 'text' }) });
    box.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(dom.modalRoot.hidden).toBe(false);
    dom.modalRoot.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(dom.modalRoot.hidden).toBe(true);
  });
});
