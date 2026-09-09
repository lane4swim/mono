// @vitest-environment jsdom
//
// Regressionstest für Issue #55: appendEquipmentEditor() (setEditor.js)
// mutierte `s.equipment` bereits beim bloßen Rendern des Editors
// (`s.equipment = s.equipment || []`) — unabhängig davon, ob die Person
// das Material-Feld überhaupt anfasst. Für einen an eine Katalog-Übung
// geknüpften Satz ohne eigenen Material-Wert (bislang `undefined`, "erbt
// vom Katalog") führte das dazu, dass ein bloßes Öffnen+Speichern das
// geerbte Material stillschweigend durch "kein Material" (`[]`) ersetzte.
import { describe, it, expect } from 'vitest';
import { renderSetEditor } from '../js/modules/setEditor.js';

describe('renderSetEditor() — Material-Vererbung (Issue #55)', () => {
  it('mutiert entry.equipment NICHT beim bloßen Rendern, wenn kein eigener Wert gesetzt ist', () => {
    const exercises = [{ id: 'ex1', name: 'Kraul', category: 'ausdauer', equipment: ['flossen'] }];
    const items = [{ kind: 'set', id: 's1', description: 'Kraul', distance: 100, reps: 1, exerciseId: 'ex1' }];

    const host = document.createElement('div');
    renderSetEditor(host, items, exercises);

    expect(items[0].equipment).toBeUndefined();
  });

  it('zeigt im Editor weiterhin das geerbte Katalog-Material an, bevor jemand es anfasst', () => {
    const exercises = [{ id: 'ex1', name: 'Kraul', category: 'ausdauer', equipment: ['flossen'] }];
    const items = [{ kind: 'set', id: 's1', description: 'Kraul', distance: 100, reps: 1, exerciseId: 'ex1' }];

    const host = document.createElement('div');
    renderSetEditor(host, items, exercises);

    expect(host.textContent).toContain('Flossen');
  });

  it('lässt einen bereits explizit gesetzten (auch leeren) Wert unverändert', () => {
    const exercises = [{ id: 'ex1', name: 'Kraul', category: 'ausdauer', equipment: ['flossen'] }];
    const items = [{ kind: 'set', id: 's1', description: 'Kraul', distance: 100, reps: 1, exerciseId: 'ex1', equipment: [] }];

    const host = document.createElement('div');
    renderSetEditor(host, items, exercises);

    expect(items[0].equipment).toEqual([]);
    expect(host.textContent).not.toContain('Flossen');
  });
});
