// Pflichtzeiten von Hand und Normtabellen in der Oberfläche
// (js/modules/competitionRequiredTimes.js, requiredTimesEditor.js,
// requiredTimeSets.js — docs/Plans/pflichtzeiten-manuell-plan.md).
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = vi.hoisted(() => ({ stores: { competitions: [], requiredTimeSets: [] } }));
vi.mock('../js/demoMode.js', () => ({ IS_DEMO: false }));
vi.mock('../js/router.js', () => ({ navigate: vi.fn() }));
vi.mock('../js/db.js', () => ({
  getAll: vi.fn(async (store) => [...(db.stores[store] || [])]),
  put: vi.fn(async (store, obj) => {
    const list = (db.stores[store] ||= []);
    if (!obj.id) obj.id = `id-${list.length + 1}`;
    const i = list.findIndex((x) => x.id === obj.id);
    if (i >= 0) list[i] = obj; else list.push(obj);
    return obj;
  }),
  remove: vi.fn(async (store, id) => { db.stores[store] = db.stores[store].filter((x) => x.id !== id); }),
}));

import { requiredTimesCard, openManualRequirementsModal, applySet, manualRequirementsFrom } from '../js/modules/competitionRequiredTimes.js';
import { renderRequiredTimeSets, openRequiredTimeSetModal, setSummary } from '../js/modules/requiredTimeSets.js';
import { evaluateRequiredTime } from '../js/modules/requiredTimes.js';

const flush = () => new Promise((r) => setTimeout(r, 0));
const COMP = { id: 'c1', name: 'Bezirk', date: '2026-11-14T00:00:00.000Z', course: 'SCM' };
const SET = {
  id: 's1', name: 'Bezirk 2027', description: '', qualifyingWindow: { from: '2026-01-01', to: null, course: 'any' },
  rules: [{ event: '100 Freistil', gender: 'W', classType: 'AL', min: '11', max: '12', time: 72.5 }],
};

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div><div id="modal-root" hidden></div>';
  db.stores = { competitions: [{ ...COMP }], requiredTimeSets: [{ ...SET }] };
});

function setRow(i, { event, gender, classType, min, max, time }) {
  const tr = document.querySelectorAll('.rt-table tbody tr')[i];
  const [ev, ge, cl] = tr.querySelectorAll('select');
  const [mi, ma, ti] = tr.querySelectorAll('input');
  const set = (node, v) => { if (v === undefined) return; node.value = v; node.dispatchEvent(new Event('change')); };
  set(ev, event); set(ge, gender); set(cl, classType); set(mi, min); set(ma, max); set(ti, time);
}
const submit = () => document.querySelector('#modal-root form').dispatchEvent(new Event('submit', { cancelable: true }));

describe('Karte "Pflichtzeiten"', () => {
  it('zeigt Anzahl und Quelle', () => {
    const comp = { ...COMP, manualRequirements: manualRequirementsFrom({ rules: SET.rules, window: SET.qualifyingWindow, set: SET }) };
    const text = requiredTimesCard(comp, () => {}).textContent;
    expect(text).toContain('1 von Hand erfasste Pflichtzeiten');
    expect(text).toContain('Bezirk 2027');
    expect(requiredTimesCard(COMP, () => {}).textContent).toContain('keine Pflichtzeiten von Hand');
  });
});

describe('Erfassungsdialog', () => {
  it('speichert eine Regel, die die Startliste sofort auswertet', async () => {
    const onSaved = vi.fn();
    openManualRequirementsModal({ ...COMP }, onSaved);
    setRow(0, { event: '100 Freistil', gender: 'W', classType: 'AL', min: '15', max: '15', time: '1:10,00' });
    submit();
    await flush();
    expect(onSaved).toHaveBeenCalled();
    const saved = db.stores.competitions[0];
    expect(saved.manualRequirements.rules).toEqual([{ event: '100 Freistil', gender: 'W', classType: 'AL', min: '15', max: '15', time: 70 }]);
    expect(saved.manualRequirements.qualifyingWindow).toEqual({ from: null, to: null, course: null });
    const girl = { id: 'a1', gender: 'w', birthdate: '2011-03-01T00:00:00.000Z' };
    const entry = { competitionId: 'c1', athleteId: 'a1', eventNumber: '', event: '100 Freistil' };
    const results = [{ athleteId: 'a1', event: '100 Freistil', time: 69, date: '2026-10-01T00:00:00.000Z', course: 'SCM', competitionId: null, status: 'OK' }];
    expect(evaluateRequiredTime({ comp: saved, entry, athlete: girl, results })).toMatchObject({ status: 'training', source: 'manual' });
  });

  it('warnt bei Überlappung und speichert erst beim zweiten Absenden', async () => {
    openManualRequirementsModal({ ...COMP }, () => {});
    setRow(0, { event: '100 Freistil', classType: 'AL', min: '10', max: '12', time: '1:10' });
    document.querySelector('.rt-add button').click();
    setRow(1, { event: '100 Freistil', classType: 'AL', min: '12', max: '14', time: '1:08' });
    submit(); await flush();
    expect(document.querySelector('.rt-overlap').hidden).toBe(false);
    expect(db.stores.competitions[0].manualRequirements).toBeUndefined();
    submit(); await flush();
    expect(db.stores.competitions[0].manualRequirements.rules).toHaveLength(2);
  });

  it('blockiert ungültige Zeilen', async () => {
    openManualRequirementsModal({ ...COMP }, () => {});
    setRow(0, { event: '100 Freistil', time: 'schnell' });
    submit(); await flush();
    expect(db.stores.competitions[0].manualRequirements).toBeUndefined();
  });

  it('übernimmt eingefügte Zeilen', () => {
    openManualRequirementsModal({ ...COMP }, () => {});
    document.querySelector('.rt-paste').value = '100 Freistil;w;11;12;1:12,50\n50 Brust;m;;;0:45,00';
    document.querySelector('.rt-paste-actions button').click();
    expect(document.querySelectorAll('.rt-table tbody tr')).toHaveLength(2);
  });
});

describe('Normtabellen', () => {
  it('übernehmen kopiert Regeln und Nachweiszeitraum in den Wettkampf', async () => {
    const updated = await applySet({ ...COMP }, SET);
    expect(updated.manualRequirements).toEqual({ rules: SET.rules, qualifyingWindow: SET.qualifyingWindow, sourceSetId: 's1', sourceSetName: 'Bezirk 2027' });
    // Spätere Änderungen an der Tabelle wirken nicht zurück.
    SET.rules[0].time = 99;
    expect(db.stores.competitions[0].manualRequirements.rules[0].time).toBe(72.5);
    SET.rules[0].time = 72.5;
  });

  it('listet, legt an und löscht', async () => {
    const container = document.getElementById('app');
    await renderRequiredTimeSets(container);
    expect(container.textContent).toContain('Bezirk 2027');
    expect(setSummary(SET)).toContain('1 Pflichtzeiten');

    openRequiredTimeSetModal(null, () => {});
    document.querySelector('#modal-root input[maxlength="200"]').value = 'Land 2027';
    setRow(0, { event: '50 Brust', classType: 'JG', min: '2014', max: '2015', time: '0:44' });
    submit(); await flush();
    expect(db.stores.requiredTimeSets.map((s) => s.name)).toEqual(['Bezirk 2027', 'Land 2027']);
    expect(db.stores.requiredTimeSets[1].rules[0]).toMatchObject({ classType: 'JG', min: '2014', max: '2015', time: 44 });
  });
});
