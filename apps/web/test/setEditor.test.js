// Testet die reine Listenlogik aus js/modules/setEditor.js — das
// Umsortieren (moveEntry) und das Einfügen an beliebiger Stelle
// (insertEntry), auf denen die Umsortier-/Einfüge-Bedienelemente des
// Satz-Editors aufsetzen. Beide Funktionen sind bewusst DOM-frei
// gehalten, damit genau das hier ohne Browser-Umgebung prüfbar ist
// (vitest läuft in apps/web mit environment: 'node').
//
// setEditor.js zieht über db.js das Modul demoMode.js nach, das auf
// Modulebene `location.pathname` liest — in einer reinen Node-Umgebung
// gibt es kein `location`, deshalb wird demoMode.js (wie in db.test.js)
// durch einen minimalen Stub ersetzt.
import { describe, it, expect } from 'vitest';
import { vi } from 'vitest';

vi.mock('../js/demoMode.js', () => ({ IS_DEMO: false }));

const { moveEntry, insertEntry, totalDistance, totalDuration, formatQuantity, formatTotalDuration } = await import('../js/modules/setEditor.js');

const set = (id, distance = 100) => ({ kind: 'set', id, description: id, distance, reps: 1 });
const ids = (list) => list.map(e => e.id);

describe('moveEntry()', () => {
  it('verschiebt einen Eintrag eine Position nach oben', () => {
    const list = [set('a'), set('b'), set('c')];
    expect(moveEntry(list, 2, -1)).toBe(true);
    expect(ids(list)).toEqual(['a', 'c', 'b']);
  });

  it('verschiebt einen Eintrag eine Position nach unten', () => {
    const list = [set('a'), set('b'), set('c')];
    expect(moveEntry(list, 0, 1)).toBe(true);
    expect(ids(list)).toEqual(['b', 'a', 'c']);
  });

  it('lässt die Liste am oberen Rand unverändert', () => {
    const list = [set('a'), set('b')];
    expect(moveEntry(list, 0, -1)).toBe(false);
    expect(ids(list)).toEqual(['a', 'b']);
  });

  it('lässt die Liste am unteren Rand unverändert', () => {
    const list = [set('a'), set('b')];
    expect(moveEntry(list, 1, 1)).toBe(false);
    expect(ids(list)).toEqual(['a', 'b']);
  });

  it('verschiebt einen Wiederholungsblock wie jeden anderen Eintrag', () => {
    const block = { kind: 'block', id: 'blk', repeatCount: 3, sets: [set('x', 50)] };
    const list = [set('a'), block, set('c')];
    expect(moveEntry(list, 1, -1)).toBe(true);
    expect(ids(list)).toEqual(['blk', 'a', 'c']);
    // Der Block bleibt dasselbe Objekt (kein Kopieren) — Kommentare und
    // ids innerhalb des Blocks überstehen das Umsortieren unverändert.
    expect(list[0]).toBe(block);
  });

  it('ändert die Gesamtdistanz durch Umsortieren nicht', () => {
    const list = [set('a', 100), { kind: 'block', id: 'blk', repeatCount: 2, sets: [set('x', 50)] }];
    const before = totalDistance(list);
    moveEntry(list, 1, -1);
    expect(totalDistance(list)).toBe(before);
  });

  it('verschiebt einen Abschnitt wie jeden anderen Eintrag, ohne seine eigene entries-Liste anzurühren', () => {
    const section = { kind: 'section', id: 'sec', heading: 'Hauptteil', entries: [set('x', 50)] };
    const list = [set('a'), section, set('c')];
    expect(moveEntry(list, 1, -1)).toBe(true);
    expect(ids(list)).toEqual(['sec', 'a', 'c']);
    expect(list[0]).toBe(section);
    expect(section.entries).toEqual([set('x', 50)]);
  });

  it('weist ungültige Indizes und Nicht-Arrays ab', () => {
    expect(moveEntry([set('a')], -1, 1)).toBe(false);
    expect(moveEntry([set('a')], 5, -1)).toBe(false);
    expect(moveEntry([set('a'), set('b')], 0, 0)).toBe(false);
    expect(moveEntry(null, 0, 1)).toBe(false);
    expect(moveEntry(undefined, 0, 1)).toBe(false);
  });
});

describe('insertEntry()', () => {
  it('fügt zwischen zwei bestehenden Einträgen ein', () => {
    const list = [set('a'), set('c')];
    expect(insertEntry(list, 1, set('b'))).toBe(1);
    expect(ids(list)).toEqual(['a', 'b', 'c']);
  });

  it('fügt an erster Stelle ein', () => {
    const list = [set('b'), set('c')];
    insertEntry(list, 0, set('a'));
    expect(ids(list)).toEqual(['a', 'b', 'c']);
  });

  it('fügt am Ende ein', () => {
    const list = [set('a')];
    insertEntry(list, 1, set('b'));
    expect(ids(list)).toEqual(['a', 'b']);
  });

  it('begrenzt einen zu großen oder negativen Index auf den gültigen Bereich', () => {
    const list = [set('a'), set('b')];
    expect(insertEntry(list, 99, set('z'))).toBe(2);
    expect(insertEntry(list, -5, set('y'))).toBe(0);
    expect(ids(list)).toEqual(['y', 'a', 'b', 'z']);
  });

  it('fügt in die leere Liste ein', () => {
    const list = [];
    expect(insertEntry(list, 0, set('a'))).toBe(0);
    expect(ids(list)).toEqual(['a']);
  });

  it('erhöht die Gesamtdistanz um den eingefügten Satz', () => {
    const list = [set('a', 100), set('c', 100)];
    insertEntry(list, 1, set('b', 200));
    expect(totalDistance(list)).toBe(400);
  });
});

describe('totalDistance() mit Abschnitten', () => {
  it('summiert die entries-Liste eines Abschnitts (auch mit Wiederholungsblock darin)', () => {
    const section = {
      kind: 'section', id: 'sec', heading: 'Hauptteil',
      entries: [set('a', 100), { kind: 'block', id: 'blk', repeatCount: 3, sets: [set('x', 50)] }],
    };
    // 100 (Satz) + 50×3 (Block) = 250
    expect(totalDistance([section])).toBe(250);
  });

  it('summiert mehrere Abschnitte plus Einträge außerhalb jedes Abschnitts', () => {
    const list = [
      set('warmup', 400),
      { kind: 'section', id: 'sec1', heading: 'Hauptteil', entries: [set('a', 100)] },
      { kind: 'section', id: 'sec2', heading: 'Ausschwimmen', entries: [set('b', 200)] },
    ];
    expect(totalDistance(list)).toBe(700);
  });
});

// timedSet() ergänzt set() (oben) um durationSec/restSec/reps für die
// Gesamtzeit-Tests unten — set() bleibt unverändert, damit die
// bestehenden totalDistance()-Tests weiterhin exakt dieselben Objekte
// bekommen.
const timedSet = (id, durationSec, { restSec = 0, reps = 1, distance = null } = {}) =>
  ({ kind: 'set', id, description: id, distance, durationSec, reps, restSec });

describe('totalDuration()', () => {
  it('zählt bei einem reinen Zeit-Satz Dauer × Wiederholungen plus Pause × Wiederholungen', () => {
    // 3 × (45s Übung + 15s Pause) = 180s
    expect(totalDuration([timedSet('a', 45, { restSec: 15, reps: 3 })])).toBe(180);
  });

  it('trägt bei einem reinen Distanz-Satz (ohne durationSec) GAR NICHTS bei, auch nicht die Pause', () => {
    // Sonst wäre die Summe für praktisch jeden Bestandsplan > 0, da restSec
    // ein Pflichtfeld mit typischen Default-Werten (15-40s) ist — und die
    // "planDuration > 0"-Anzeigebedingung in plans.js/planPdfExport.js
    // liefe leer (siehe Code-Review-Korrektur in totalDuration()).
    const distanceOnly = { kind: 'set', id: 'a', distance: 100, durationSec: null, reps: 4, restSec: 20 };
    expect(totalDuration([distanceOnly])).toBe(0);
  });

  it('multipliziert die Blockinnensumme mit repeatCount, wie totalDistance()', () => {
    const block = { kind: 'block', id: 'blk', repeatCount: 3, sets: [timedSet('x', 45, { restSec: 15 })] };
    expect(totalDuration([block])).toBe(180); // 3 × (45+15)
  });

  it('summiert die entries-Liste eines Abschnitts', () => {
    const section = { kind: 'section', id: 'sec', heading: 'Kraft', entries: [timedSet('a', 30, { restSec: 10, reps: 2 })] };
    expect(totalDuration([section])).toBe(80); // 2 × (30+10)
  });

  it('liefert 0 für eine reine Distanz-Liste ohne jede Pause', () => {
    expect(totalDuration([set('a', 100), set('b', 200)])).toBe(0);
  });
});

describe('formatQuantity()', () => {
  it('zeigt nur die Distanz, wenn keine Dauer gesetzt ist', () => {
    expect(formatQuantity({ reps: 3, distance: 100, durationSec: null })).toBe('3×100 m');
  });

  it('zeigt nur die Zeit, wenn keine Distanz gesetzt ist', () => {
    expect(formatQuantity({ reps: 3, distance: null, durationSec: 45 })).toBe('3×45 Sek');
  });

  it('kombiniert Distanz UND Zeit als zwei getrennte Angaben, nicht als zweiten Multiplikationsfaktor', () => {
    // Bewusst NICHT "3×100 m×45 Sek" (läse sich wie ein zweiter ×-Faktor).
    expect(formatQuantity({ reps: 3, distance: 100, durationSec: 45 })).toBe('3×100 m · 45 Sek');
  });

  it('zeigt "—", wenn weder Distanz noch Zeit gesetzt ist', () => {
    expect(formatQuantity({ reps: 1, distance: null, durationSec: null })).toBe('1×—');
  });

  it('formatiert Zeiten ab einer Minute als m:ss', () => {
    expect(formatQuantity({ reps: 1, distance: null, durationSec: 90 })).toBe('1×1:30 Min');
  });
});

describe('formatTotalDuration()', () => {
  it('rundet auf ganze Minuten', () => {
    expect(formatTotalDuration(150)).toBe('3 Min'); // 2:30 → aufgerundet
  });

  it('zeigt Stunden, sobald die Gesamtzeit eine Stunde erreicht', () => {
    expect(formatTotalDuration(3900)).toBe('1 Std 5 Min'); // 65 Min
  });
});
