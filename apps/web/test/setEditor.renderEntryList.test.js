// @vitest-environment jsdom
//
// Testet renderEntryList() (setEditor.js) — die gemeinsame Vorschau-Logik
// für Satz-/Block-/Abschnittseinträge, die vormals fast identisch inline
// in templates.js UND als entriesPreview() in sectionTemplates.js stand
// (siehe Issue #70). Prüft hier nur die Rendering-Verzweigung (Zeilenzahl,
// Klassen, section-Handling je nach allowSection) — die eigentlichen
// Formatierungshelfer (formatQuantity, totalDistance, equipmentForEntry)
// haben eigene Tests.
import { describe, it, expect } from 'vitest';
import { renderEntryList } from '../js/modules/setEditor.js';

const set = (id, distance = 100) => ({ kind: 'set', id, description: id, distance, reps: 1 });
const block = (id, sets) => ({ kind: 'block', id, label: id, repeatCount: 2, sets });
const section = (id, entries) => ({ kind: 'section', id, heading: id, entries });

describe('renderEntryList()', () => {
  it('rendert einen Satz-Eintrag als eine Zeile mit Beschreibung', () => {
    const list = renderEntryList([set('a')], []);
    const rows = list.querySelectorAll('.list-row');
    expect(rows.length).toBe(1);
    expect(rows[0].textContent).toContain('a');
  });

  it('rendert einen Wiederholungsblock als eine Zeile', () => {
    const list = renderEntryList([block('b', [set('x', 50)])], []);
    const rows = list.querySelectorAll('.list-row');
    expect(rows.length).toBe(1);
    expect(rows[0].textContent).toContain('2×');
  });

  it('rendert einen Abschnitt als eine Zeile, wenn allowSection nicht gesetzt (Default true) ist', () => {
    const list = renderEntryList([section('s', [set('x')])], []);
    expect(list.querySelectorAll('.list-row').length).toBe(1);
  });

  it('überspringt einen Abschnitt still, wenn allowSection: false ist', () => {
    const entries = [set('a'), section('s', [set('x')]), set('c')];
    const list = renderEntryList(entries, [], { allowSection: false });
    const rows = list.querySelectorAll('.list-row');
    expect(rows.length).toBe(2);
    expect(list.textContent).not.toContain('s');
  });

  it('zeigt Ausrüstungs-Pills für einen Satz mit verknüpfter Katalogübung', () => {
    const exercises = [{ id: 'ex1', name: 'Kraul', category: 'ausdauer', equipment: ['flossen'] }];
    const entry = { kind: 'set', id: 'a', description: 'Kraul', distance: 100, reps: 1, exerciseId: 'ex1' };
    const list = renderEntryList([entry], exercises);
    expect(list.querySelector('.pill-group')).not.toBeNull();
  });

  it('liefert eine leere Liste ohne Zeilen für eine leere Eingabe', () => {
    const list = renderEntryList([], []);
    expect(list.querySelectorAll('.list-row').length).toBe(0);
    expect(list.tagName).toBe('DIV');
  });
});
