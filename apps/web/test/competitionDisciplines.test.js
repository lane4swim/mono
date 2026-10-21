// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';

vi.mock('../js/demoMode.js', () => ({ IS_DEMO: false }));
const dbMock = vi.hoisted(() => ({ put: vi.fn(async () => {}) }));
vi.mock('../js/db.js', () => dbMock);

import { disciplinesLoadButton, disciplineSelect, disciplineMatchesAthlete, findDisciplineIndex, disciplineLabel } from '../js/modules/competitionDisciplines.js';
import { selectInput, textInput } from '../js/forms.js';

const DISCIPLINES = [
  { number: '1', round: 'V', distanceM: 100, stroke: 'F', style: 'GL', relaySize: 1, gender: 'W', event: '100 Freistil' },
  { number: '2', round: 'E', distanceM: 50, stroke: 'R', style: 'GL', relaySize: 1, gender: 'M', event: '50 Rücken' },
  { number: '3', round: 'E', distanceM: 25, stroke: 'F', style: 'BE', relaySize: 1, gender: 'X', event: '25 Freistil Beine' },
];

function setup(athlete, entry = null) {
  const eventSelect = selectInput([{ value: '100 Freistil', label: '100 Freistil' }, { value: '50 Rücken', label: '50 Rücken' }], '100 Freistil');
  const numberInput = textInput('');
  const picker = disciplineSelect(DISCIPLINES, { entry, eventSelect, numberInput, getAthlete: () => athlete });
  return { ...picker, eventSelect, numberInput };
}

describe('disciplineSelect', () => {
  it('filtert nach Geschlecht der Athlet:in und füllt Nummer/Disziplin vor', () => {
    const { select, eventSelect, numberInput } = setup({ gender: 'm' });
    // Index 0 (weiblich) entfällt, männlich und mixed bleiben.
    expect([...select.options].map(o => o.value)).toEqual(['', '1', '2']);
    select.value = '2';
    select.dispatchEvent(new Event('change'));
    expect(numberInput.value).toBe('3');
    // Nicht in EVENTS geführte Disziplin wird als Option ergänzt.
    expect(eventSelect.value).toBe('25 Freistil Beine');
  });

  it('wählt beim Bearbeiten die passende Disziplin vor', () => {
    const { select } = setup({ gender: 'w' }, { eventNumber: '1', event: '100 Freistil' });
    expect(select.value).toBe('0');
  });
});

describe('disciplineMatchesAthlete', () => {
  it('lässt offene Wettkämpfe und Athlet:innen ohne Geschlecht immer zu', () => {
    expect(disciplineMatchesAthlete(DISCIPLINES[0], { gender: 'm' })).toBe(false);
    expect(disciplineMatchesAthlete(DISCIPLINES[2], { gender: 'm' })).toBe(true);
    expect(disciplineMatchesAthlete(DISCIPLINES[0], { gender: 'd' })).toBe(true);
    expect(disciplineMatchesAthlete(DISCIPLINES[0], undefined)).toBe(true);
  });
});

describe('findDisciplineIndex / disciplineLabel', () => {
  it('findet über die Wettkampfnummer', () => {
    expect(findDisciplineIndex(DISCIPLINES, { eventNumber: '2', event: 'x' })).toBe(1);
    expect(findDisciplineIndex(DISCIPLINES, { eventNumber: '9' })).toBe(-1);
    expect(findDisciplineIndex(DISCIPLINES, null)).toBe(-1);
  });
  it('nennt Nummer, Disziplin, Geschlecht und Wettkampfart', () => {
    expect(disciplineLabel(DISCIPLINES[0])).toBe('Nr. 1 · 100 Freistil · weiblich · Vorlauf');
    expect(disciplineLabel(DISCIPLINES[1])).toBe('Nr. 2 · 50 Rücken · männlich');
  });
});

describe('disciplinesLoadButton', () => {
  function pick(file) {
    const onLoaded = vi.fn();
    const wrap = disciplinesLoadButton({ id: 'c1', disciplines: [] }, onLoaded);
    const input = wrap.querySelector('input[type=file]');
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change'));
    return onLoaded;
  }

  it('liest Dateien über 1 MB gar nicht erst ein', async () => {
    dbMock.put.mockClear();
    const file = new File(['x'], 'riesig.dsv7');
    Object.defineProperty(file, 'size', { value: 2 * 1024 * 1024 });
    file.text = vi.fn(async () => 'FORMAT:Wettkampfdefinitionsliste;7;\nWETTKAMPF:1;E;1;;100;F;GL;M;SW;;;');
    const onLoaded = pick(file);
    await new Promise(r => setTimeout(r, 0));
    expect(file.text).not.toHaveBeenCalled();
    expect(dbMock.put).not.toHaveBeenCalled();
    expect(onLoaded).not.toHaveBeenCalled();
  });

  it('speichert nur die gültigen Disziplinen einer teils fehlerhaften Datei', async () => {
    dbMock.put.mockClear();
    const file = new File(['x'], 'wk.dsv7');
    file.text = async () => 'FORMAT:Wettkampfdefinitionsliste;7;\nWETTKAMPF:1;E;1;;100;FREISTIL;GL;M;SW;;;\nWETTKAMPF:2;E;1;;100;F;GL;M;SW;;;';
    const onLoaded = pick(file);
    await vi.waitFor(() => expect(onLoaded).toHaveBeenCalled());
    expect(dbMock.put).toHaveBeenCalledTimes(1);
    expect(dbMock.put.mock.calls[0][1].disciplines.map(d => d.number)).toEqual(['2']);
  });
});
