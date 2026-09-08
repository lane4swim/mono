// Testet die reine Funktion buildPlansFromCycle() aus
// js/modules/planCycles.js (Phase 1, Abschnitt 3.1 —
// docs/trainingsplanung-phase1-plan.md).
import { describe, it, expect } from 'vitest';
import { vi } from 'vitest';

// planCycles.js zieht über setEditor.js/db.js demoMode.js nach (siehe
// setEditor.test.js) — in reiner Node-Umgebung ohne `location` gestubbt.
vi.mock('../js/demoMode.js', () => ({ IS_DEMO: false }));

const { buildPlansFromCycle } = await import('../js/modules/planCycles.js');

function template(id, distance) {
  return { id, name: `Vorlage ${id}`, sets: [{ kind: 'set', id: 's1', description: '', distance, reps: 1, intensity: '', restSec: 0, comments: [] }] };
}

describe('buildPlansFromCycle()', () => {
  it('erzeugt einen Plan je Zyklus-Woche mit korrekt versetztem weekStart', () => {
    const cycle = {
      name: 'Aufbauzyklus',
      weeks: [
        { weekOffset: 0, label: 'Grundlage', days: [{ dayOfWeek: 0, templateId: 'a' }] },
        { weekOffset: 1, label: 'Intensiv', days: [{ dayOfWeek: 2, templateId: 'b' }] },
      ],
    };
    const templates = [template('a', 1000), template('b', 2000)];
    const plans = buildPlansFromCycle(cycle, templates, '2026-01-05', 'g1'); // Montag

    expect(plans).toHaveLength(2);
    expect(plans[0]).toMatchObject({ name: 'Aufbauzyklus — Grundlage', weekStart: '2026-01-05', groupId: 'g1', status: 'aktiv' });
    expect(plans[0].days).toEqual([{ date: '2026-01-05', sets: expect.arrayContaining([expect.objectContaining({ distance: 1000 })]) }]);
    expect(plans[1].weekStart).toBe('2026-01-12'); // eine Woche später
    expect(plans[1].days[0].date).toBe('2026-01-14'); // Mittwoch (dayOfWeek 2) derselben Woche
  });

  it('normalisiert ein Startdatum mitten in der Woche auf deren Wochenanfang', () => {
    const cycle = { name: 'X', weeks: [{ weekOffset: 0, label: '', days: [] }] };
    const plans = buildPlansFromCycle(cycle, [], '2026-01-08', 'g1'); // Donnerstag derselben Woche
    expect(plans[0].weekStart).toBe('2026-01-05'); // auf Montag zurückgerundet
  });

  it('vergibt einen Standardnamen ohne Wochen-Label', () => {
    const cycle = { name: 'Zyklus', weeks: [{ weekOffset: 0, label: '', days: [] }] };
    const plans = buildPlansFromCycle(cycle, [], '2026-01-05', 'g1');
    expect(plans[0].name).toBe('Zyklus — Woche 1');
  });

  it('erzeugt einen Snapshot der Vorlagen-Sets (Vorlagenänderung wirkt sich nicht rückwirkend aus)', () => {
    const cycle = { name: 'X', weeks: [{ weekOffset: 0, label: '', days: [{ dayOfWeek: 0, templateId: 'a' }] }] };
    const tpl = template('a', 1000);
    const plans = buildPlansFromCycle(cycle, [tpl], '2026-01-05', 'g1');
    expect(plans[0].days[0].sets[0].id).not.toBe(tpl.sets[0].id); // neue id, kein geteilter Objektbezug
    tpl.sets[0].distance = 9999;
    expect(plans[0].days[0].sets[0].distance).toBe(1000); // unverändert
  });

  it('leert die Sets, wenn die referenzierte Vorlage nicht (mehr) existiert', () => {
    const cycle = { name: 'X', weeks: [{ weekOffset: 0, label: '', days: [{ dayOfWeek: 0, templateId: 'gelöscht' }] }] };
    const plans = buildPlansFromCycle(cycle, [], '2026-01-05', 'g1');
    expect(plans[0].days[0].sets).toEqual([]);
  });
});
