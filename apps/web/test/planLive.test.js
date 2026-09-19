// Testet die reine Funktion buildDayChecklist() aus
// js/modules/planLive.js (Issue #78, Trainingsmodus).
import { describe, it, expect } from 'vitest';

// planLive.js zieht über setEditor.js/db.js demoMode.js nach (siehe
// planCycles.test.js), sowie über i18n.js — beides in reiner
// Node-Umgebung ohne `location`/echte Browser-APIs gestubbt.
import { vi } from 'vitest';
vi.mock('../js/demoMode.js', () => ({ IS_DEMO: false }));

const { buildDayChecklist } = await import('../js/modules/planLive.js');

function plainSet(id, overrides = {}) {
  return { kind: 'set', id, description: `Satz ${id}`, distance: 100, durationSec: null, reps: 1, intensity: 'ga1', restSec: 20, equipment: [], comments: [], ...overrides };
}

describe('buildDayChecklist()', () => {
  it('bildet für jeden einfachen Satz genau eine Zeile ohne Gruppierungsangaben', () => {
    const rows = buildDayChecklist([plainSet('a'), plainSet('b')]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ id: 'a', sectionHeading: null, blockId: null, blockLabel: null, blockRepeatCount: null });
    expect(rows[1]).toMatchObject({ id: 'b', sectionHeading: null, blockId: null, blockLabel: null, blockRepeatCount: null });
  });

  it('zählt einen Wiederholungsblock als seine EINZELNEN Sätze, nicht vervielfacht um repeatCount', () => {
    const block = { kind: 'block', id: 'blk1', label: 'Kraftblock', repeatCount: 3, sets: [plainSet('x'), plainSet('y')] };
    const rows = buildDayChecklist([block]);
    expect(rows).toHaveLength(2); // NICHT 6 (2 Sätze × repeatCount 3)
    expect(rows[0]).toMatchObject({ id: 'x', blockId: 'blk1', blockLabel: 'Kraftblock', blockRepeatCount: 3 });
    expect(rows[1]).toMatchObject({ id: 'y', blockId: 'blk1', blockLabel: 'Kraftblock', blockRepeatCount: 3 });
  });

  it('trägt bei aufeinanderfolgenden Blöcken unterschiedliche blockId, damit renderLiveMode() sie getrennt gruppieren kann', () => {
    const blockA = { kind: 'block', id: 'blkA', label: 'A', repeatCount: 2, sets: [plainSet('a1')] };
    const blockB = { kind: 'block', id: 'blkB', label: 'B', repeatCount: 3, sets: [plainSet('b1')] };
    const rows = buildDayChecklist([blockA, blockB]);
    expect(rows.map(r => r.blockId)).toEqual(['blkA', 'blkB']);
  });

  it('rekursiert in Abschnitte und trägt deren Überschrift auf jede enthaltene Zeile', () => {
    const section = { kind: 'section', id: 'sec1', heading: 'Einschwimmen', entries: [plainSet('a')] };
    const rows = buildDayChecklist([section]);
    expect(rows).toEqual([expect.objectContaining({ id: 'a', sectionHeading: 'Einschwimmen' })]);
  });

  it('kombiniert Abschnitt und darin verschachtelten Block korrekt', () => {
    const block = { kind: 'block', id: 'blk1', label: 'Serie', repeatCount: 4, sets: [plainSet('inner')] };
    const section = { kind: 'section', id: 'sec1', heading: 'Hauptteil', entries: [block] };
    const rows = buildDayChecklist([section]);
    expect(rows).toEqual([expect.objectContaining({ id: 'inner', sectionHeading: 'Hauptteil', blockLabel: 'Serie', blockRepeatCount: 4 })]);
  });

  it('liefert eine leere Liste für einen Tag ohne Sätze', () => {
    expect(buildDayChecklist([])).toEqual([]);
    expect(buildDayChecklist(undefined)).toEqual([]);
  });

  it('behält den vollständigen Satz-Datensatz unter `entry` für die Kartenanzeige', () => {
    const set = plainSet('a', { distance: 200, reps: 4 });
    const rows = buildDayChecklist([set]);
    expect(rows[0].entry).toBe(set);
  });
});
