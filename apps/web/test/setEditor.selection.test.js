// @vitest-environment jsdom
//
// Auswahl-/Einfüge-Bedienung des Satz-Editors: Aktionen (hoch/runter/
// entfernen, darüber/darunter einfügen) hängen am ausgewählten Eintrag,
// der Dialog zum Anlegen eines neuen Eintrags erscheint nur in einer
// leeren Liste oder an der per "darüber/darunter einfügen" gewählten Stelle.
import { describe, it, expect } from 'vitest';
import { renderSetEditor } from '../js/modules/setEditor.js';

const set = (id, distance = 100) => ({ kind: 'set', id, description: id, distance, reps: 1, restSec: 20, equipment: [] });

function setup(items, opts) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  renderSetEditor(host, items, [], opts);
  return host;
}

const rows = (host) => [...host.querySelectorAll('.set-row:not(.set-row-head)')];
const click = (node) => node.dispatchEvent(new MouseEvent('click', { bubbles: true }));
const addBlankButton = (scope) => [...scope.querySelectorAll('.add-controls button')].find(b => b.textContent.includes('leerer Satz'));

describe('renderSetEditor() — Auswahl & Einfügen', () => {
  it('zeigt die Hinzufügen-Steuerelemente nur in einem leeren Plan', () => {
    expect(setup([]).querySelector('.add-controls')).not.toBeNull();
    expect(setup([set('a')]).querySelector('.add-controls')).toBeNull();
  });

  it('markiert einen Eintrag erst beim Anklicken als ausgewählt', () => {
    const host = setup([set('a'), set('b')]);
    expect(host.querySelector('.is-selected')).toBeNull();
    click(rows(host)[1]);
    expect(rows(host)[1].classList.contains('is-selected')).toBe(true);
    click(rows(host)[0]);
    expect(rows(host)[0].classList.contains('is-selected')).toBe(true);
    expect(rows(host)[1].classList.contains('is-selected')).toBe(false);
  });

  it('wählt bei verschachtelten Einträgen nur den innersten aus', () => {
    const host = setup([{ kind: 'block', id: 'b1', label: '', repeatCount: 2, sets: [set('x')] }]);
    click(rows(host)[0].querySelector('input'));
    expect(rows(host)[0].classList.contains('is-selected')).toBe(true);
    expect(host.querySelector('.editor-block').classList.contains('is-selected')).toBe(false);
  });

  it('öffnet "darunter einfügen" den Dialog direkt unter dem Eintrag und fügt dort ein', () => {
    const items = [set('a'), set('b')];
    const host = setup(items);
    click(rows(host)[0]);
    click(rows(host)[0].querySelector('[data-entry-action="insert-below"]'));

    const panel = host.querySelector('.insert-panel');
    expect(panel).not.toBeNull();
    expect(panel.previousElementSibling).toBe(rows(host)[0]);
    expect(panel.nextElementSibling).toBe(rows(host)[1]);

    click(addBlankButton(panel));
    expect(items).toHaveLength(3);
    expect(items[0].id).toBe('a');
    expect(items[2].id).toBe('b');
    expect(host.querySelector('.insert-panel')).toBeNull();
    // Der neue Eintrag ist danach ausgewählt.
    expect(rows(host)[1].classList.contains('is-selected')).toBe(true);
  });

  it('fügt per "darüber einfügen" vor dem Eintrag ein — auch innerhalb eines Abschnitts', () => {
    const section = { kind: 'section', id: 's1', heading: 'Haupt', entries: [set('x')] };
    const host = setup([section]);
    click(rows(host)[0]);
    click(rows(host)[0].querySelector('[data-entry-action="insert-above"]'));
    click(addBlankButton(host.querySelector('.insert-panel')));
    expect(section.entries).toHaveLength(2);
    expect(section.entries[1].id).toBe('x');
  });

  it('schließt den Dialog über den Abbrechen-Knopf, ohne etwas einzufügen', () => {
    const items = [set('a')];
    const host = setup(items);
    click(rows(host)[0]);
    click(rows(host)[0].querySelector('[data-entry-action="insert-above"]'));
    click(host.querySelector('.insert-panel-head button'));
    expect(host.querySelector('.insert-panel')).toBeNull();
    expect(items).toHaveLength(1);
  });

  it('verschiebt und entfernt über die Aktionen des ausgewählten Eintrags', () => {
    const items = [set('a'), set('b')];
    const host = setup(items);
    click(rows(host)[0]);
    click(rows(host)[0].querySelector('[data-entry-action="down"]'));
    expect(items.map(e => e.id)).toEqual(['b', 'a']);
    // Auswahl wandert mit dem Eintrag.
    expect(rows(host)[1].classList.contains('is-selected')).toBe(true);

    click(rows(host)[1].querySelector('[data-entry-action="remove"]'));
    expect(items.map(e => e.id)).toEqual(['b']);
    expect(host.querySelector('.is-selected')).toBeNull();
  });

  it('zeigt die Hinzufügen-Steuerelemente in einem leeren Abschnitt', () => {
    const host = setup([{ kind: 'section', id: 's1', heading: '', entries: [] }]);
    expect(host.querySelector('.section-block .add-controls')).not.toBeNull();
  });
});
