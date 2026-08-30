// @vitest-environment jsdom
//
// apps/web/test/forms.test.js
//
// Regressionstests für Review 30.08.2026, Befund U2: field() rendert
// Label und Eingabefeld bislang als Geschwister ohne "for"/"id" — jedes
// Formularfeld der Anwendung lief dadurch für Screenreader als
// unbeschriftet, und ein Klick auf das Label fokussierte das Feld nicht.
import { describe, it, expect } from 'vitest';
import { field, textInput, selectInput } from '../js/forms.js';
import { el } from '../js/dom.js';

describe('field() — Label-Verknüpfung (Befund U2)', () => {
  it('verknüpft das <label> per for/id mit dem Eingabefeld', () => {
    const input = textInput('Mara');
    const wrapper = field('Vorname', input);
    const label = wrapper.querySelector('label');
    expect(label.htmlFor).toBe(input.id);
    expect(input.id).not.toBe('');
  });

  it('vergibt für unterschiedliche Felder unterschiedliche IDs (kein Kollisions-Risiko bei mehreren Formularen auf derselben Seite)', () => {
    const inputA = textInput('A');
    const inputB = textInput('B');
    field('Feld A', inputA);
    field('Feld B', inputB);
    expect(inputA.id).not.toBe(inputB.id);
  });

  it('verknüpft einen "hint" per aria-describedby mit dem Eingabefeld', () => {
    const input = textInput('');
    const wrapper = field('Passwort', input, { hint: 'Mindestens 8 Zeichen.' });
    const hintNode = wrapper.querySelector('.hint');
    expect(hintNode.id).toBeTruthy();
    expect(input.getAttribute('aria-describedby')).toBe(hintNode.id);
  });

  it('funktioniert unverändert für ein <select>', () => {
    const select = selectInput([{ value: 'a', label: 'A' }], 'a');
    const wrapper = field('Gruppe', select);
    const label = wrapper.querySelector('label');
    expect(label.htmlFor).toBe(select.id);
  });

  it('verknüpft bei einem umschließenden Wrapper (z. B. Kästchen + Begleittext) das Label mit dem tatsächlichen Steuerelement, nicht mit dem Wrapper', () => {
    const checkbox = el('input', { type: 'checkbox' });
    const wrapper = field('Status', el('div', { class: 'flex' }, [checkbox, el('span', {}, 'Aktiv')]));
    const label = wrapper.querySelector('label');
    expect(label.htmlFor).toBe(checkbox.id);
  });

  it('lässt das <label> ohne "for", wenn kein fokussierbares Steuerelement gefunden wird', () => {
    const wrapper = field('Nur Text', el('div', {}, 'kein Eingabefeld'));
    const label = wrapper.querySelector('label');
    expect(label.hasAttribute('for')).toBe(false);
  });
});
