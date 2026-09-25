// @vitest-environment jsdom
//
// apps/web/test/ui.tabbedView.test.js
//
// tabbedView() teilt Modulseiten mit mehreren Aufgaben (Nutzerverwaltung,
// Mein Profil, Qualifikationen, Kampfrichter, Statistiken, Athleten & Team)
// in Reiter auf. Geprüft wird: Reiterleiste entfällt bei nur einem Reiter,
// Panels werden erst beim ersten Öffnen gebaut und danach behalten, und
// der aktive Reiter überlebt einen Neuaufbau der Ansicht (refresh()).
import { describe, it, expect, vi } from 'vitest';
import { el } from '../js/dom.js';
import { tabbedView } from '../js/ui.js';

function tab(id, render = () => el('p', {}, id)) {
  return { id, label: id.toUpperCase(), render: vi.fn(render) };
}

describe('tabbedView()', () => {
  it('rendert bei nur einem (sichtbaren) Reiter direkt dessen Inhalt ohne Reiterleiste', () => {
    const only = tab('own');
    const node = tabbedView('t-single', [only, false, null]);
    expect(node.querySelector('[role="tablist"]')).toBeNull();
    expect(node.textContent).toBe('own');
    expect(only.render).toHaveBeenCalledTimes(1);
  });

  it('baut Panels erst beim ersten Öffnen und blendet danach nur um', () => {
    const a = tab('a');
    const b = tab('b');
    const node = tabbedView('t-lazy', [a, b]);
    const [btnA, btnB] = node.querySelectorAll('[role="tab"]');

    expect(btnA.getAttribute('aria-selected')).toBe('true');
    expect(a.render).toHaveBeenCalledTimes(1);
    expect(b.render).not.toHaveBeenCalled();

    btnB.click();
    btnA.click();
    btnB.click();
    expect(b.render).toHaveBeenCalledTimes(1);
    expect(a.render).toHaveBeenCalledTimes(1);

    const panels = node.querySelectorAll('[role="tabpanel"]');
    expect(panels).toHaveLength(2);
    expect([...panels].map((p) => p.hidden)).toEqual([true, false]);
    expect(btnB.getAttribute('aria-selected')).toBe('true');
  });

  it('merkt sich den aktiven Reiter je Schlüssel über einen Neuaufbau hinweg', () => {
    const first = tabbedView('t-remember', [tab('x'), tab('y')]);
    first.querySelectorAll('[role="tab"]')[1].click();

    const rebuilt = tabbedView('t-remember', [tab('x'), tab('y')]);
    expect(rebuilt.querySelector('[aria-selected="true"]').textContent).toBe('Y');

    // Ein Reiter, den es nach dem Neuaufbau nicht mehr gibt (z. B. Rolle
    // entzogen), fällt auf den ersten zurück.
    const withoutY = tabbedView('t-remember', [tab('x'), tab('z')]);
    expect(withoutY.querySelector('[aria-selected="true"]').textContent).toBe('X');
  });

  it('wechselt per Pfeiltasten zyklisch zwischen den Reitern', () => {
    const node = tabbedView('t-keys', [tab('a'), tab('b'), tab('c')]);
    const [btnA] = node.querySelectorAll('[role="tab"]');
    btnA.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(node.querySelector('[aria-selected="true"]').textContent).toBe('C');
  });
});
