// @vitest-environment jsdom
//
// Zeit- und Pausenfeld einer Satzzeile im Satz-Editor: beide nutzen die
// mm:ss-Eingabemaske (maskMinSec(), eigene Tests in setEditor.test.js) und
// schreiben Sekunden in durationSec bzw. restSec zurück.
import { describe, it, expect } from 'vitest';
import { renderSetEditor, minSecInput } from '../js/modules/setEditor.js';

function setup(s) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  renderSetEditor(host, [s], []);
  const row = host.querySelector('.set-row:not(.set-row-head)');
  // Spaltenreihenfolge: Distanz, Zeit, Beschreibung, Wdh., Pause.
  const inputs = row.querySelectorAll(':scope > input');
  return { duration: inputs[1], rest: inputs[4] };
}

function type(input, value, inputType = 'insertText') {
  input.value = value;
  input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType }));
}

const newSet = () => ({ kind: 'set', id: 'a', description: '', distance: 100, durationSec: null, reps: 1, restSec: 90, equipment: [] });

describe('Satz-Editor — mm:ss-Felder für Zeit und Pause', () => {
  it('zeigt die Pause als mm:ss statt als Sekundenzahl', () => {
    const { rest } = setup(newSet());
    expect(rest.type).toBe('text');
    expect(rest.value).toBe('1:30');
  });

  it('maskiert die Zeiteingabe und schreibt Sekunden in durationSec', () => {
    const s = newSet();
    const { duration } = setup(s);
    type(duration, '1a');
    expect(duration.value).toBe('1');
    type(duration, '12');
    expect(duration.value).toBe('12:');
    expect(s.durationSec).toBe(720);
    type(duration, '12:3');
    type(duration, '12:30');
    expect(s.durationSec).toBe(750);
  });

  it('maskiert die Pauseneingabe und schreibt Sekunden in restSec (leer = 0)', () => {
    const s = newSet();
    const { rest } = setup(s);
    type(rest, '0045');
    expect(rest.value).toBe('00:45');
    expect(s.restSec).toBe(45);
    type(rest, '', 'deleteContentBackward');
    expect(s.restSec).toBe(0);
  });

  it('lässt den Doppelpunkt per Rücktaste löschen', () => {
    const { duration } = setup(newSet());
    type(duration, '12');
    type(duration, '12', 'deleteContentBackward');
    expect(duration.value).toBe('12');
  });

  it('normalisiert beim Verlassen des Feldes', () => {
    const { duration } = setup(newSet());
    type(duration, '1:5');
    duration.dispatchEvent(new FocusEvent('blur'));
    expect(duration.value).toBe('1:05');
  });
});

// Dieselbe Maske nutzt das Dauerfeld im Übungskatalog (catalog.js) direkt
// über minSecInput().
describe('minSecInput()', () => {
  it('meldet die geparsten Sekunden an den Callback und übernimmt den Platzhalter', () => {
    let value;
    const input = minSecInput(null, (sec) => value = sec, { placeholder: 'Dauer' });
    expect(input.placeholder).toBe('Dauer');
    expect(input.value).toBe('');
    type(input, 'x05');
    expect(input.value).toBe('05:');
    expect(value).toBe(300);
    type(input, '05:', 'deleteContentBackward');
    type(input, '', 'deleteContentBackward');
    expect(value).toBeNull();
  });
});
