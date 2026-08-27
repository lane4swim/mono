// apps/web/test/setEditor.test.js
//
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

const { moveEntry, insertEntry, totalDistance } = await import('../js/modules/setEditor.js');

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
