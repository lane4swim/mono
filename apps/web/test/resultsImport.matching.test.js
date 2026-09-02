// apps/web/test/resultsImport.matching.test.js
//
// Unit-Tests für resultsImport/matching.js — siehe
// docs/dsv7-lenex-import-plan.md Abschnitt 5 für die fachlichen Regeln,
// die hier abgesichert werden.
import { describe, it, expect } from 'vitest';
import { matchOwnClub, filterResultsForClub, matchAthlete, resolveEventLabel, buildImportPlan } from '../js/resultsImport/matching.js';
import { unmappedEventKey } from '../js/resultsImport/dsv7Parser.js';

function importedResult(overrides = {}) {
  return {
    athleteMatchHint: { name: 'Muster, Max', nationalIDType: undefined, nationalID: undefined, birthYear: 2000, gender: 'm' },
    eventCode: { distanceM: 100, stroke: 'F', isRelay: false, relaySize: 1, label: '100 Freistil' },
    round: 'E',
    time: 60,
    place: 1,
    status: 'OK',
    statusNote: undefined,
    splits: [],
    clubName: 'SC Test',
    clubNationalIDType: 'DSV',
    clubNationalID: '9999',
    ...overrides,
  };
}

describe('matchOwnClub()', () => {
  const parsedClubs = [
    { name: 'SC Test', nationalIDType: 'DSV', nationalID: '9999' },
    { name: 'SC Andere', nationalIDType: 'DSV', nationalID: '1111' },
  ];

  it('findet den eigenen Verein über nationalID/nationalIDType', () => {
    const localClub = { nationalIDType: 'DSV', nationalID: '9999' };
    expect(matchOwnClub(parsedClubs, localClub)).toEqual(parsedClubs[0]);
  });

  it('liefert null, wenn der eigene Verein keine Kennung hinterlegt hat', () => {
    expect(matchOwnClub(parsedClubs, { nationalIDType: null, nationalID: null })).toBeNull();
    expect(matchOwnClub(parsedClubs, null)).toBeNull();
  });

  it('liefert null, wenn keine Datei-Zeile zur Kennung passt', () => {
    expect(matchOwnClub(parsedClubs, { nationalIDType: 'DSV', nationalID: '4242' })).toBeNull();
  });
});

describe('filterResultsForClub()', () => {
  it('filtert auf Ergebnisse des ausgewählten Vereinsnamens', () => {
    const results = [importedResult({ clubName: 'SC Test' }), importedResult({ clubName: 'SC Andere' })];
    expect(filterResultsForClub(results, { name: 'SC Test' })).toHaveLength(1);
  });
});

describe('matchAthlete()', () => {
  const athletes = [
    { id: 'a1', firstName: 'Max', lastName: 'Muster', nationalIDType: 'DSV', nationalID: '404306', birthdate: '2000-05-01T00:00:00.000Z' },
    { id: 'a2', firstName: 'Erika', lastName: 'Musterfrau', nationalIDType: null, nationalID: null, birthdate: '2001-01-01T00:00:00.000Z' },
  ];

  it('matcht bevorzugt über nationalID', () => {
    const hint = { name: 'Anderer Name', nationalIDType: 'DSV', nationalID: '404306' };
    expect(matchAthlete(hint, athletes)).toBe(athletes[0]);
  });

  it('fällt auf eindeutigen Namensabgleich zurück, wenn keine nationalID gesetzt ist', () => {
    const hint = { name: 'Musterfrau, Erika' };
    expect(matchAthlete(hint, athletes)).toBe(athletes[1]);
  });

  it('löst Namensgleichheit über das Geburtsjahr auf', () => {
    const twins = [
      { id: 'b1', firstName: 'Jan', lastName: 'Zwilling', birthdate: '2009-01-01T00:00:00.000Z' },
      { id: 'b2', firstName: 'Jan', lastName: 'Zwilling', birthdate: '2011-01-01T00:00:00.000Z' },
    ];
    const hint = { name: 'Zwilling, Jan', birthYear: 2011 };
    expect(matchAthlete(hint, twins)).toBe(twins[1]);
  });

  it('liefert null bei nicht auflösbarer Namensgleichheit (kein/mehrdeutiges Geburtsjahr)', () => {
    const twins = [
      { id: 'b1', firstName: 'Jan', lastName: 'Zwilling', birthdate: '2009-01-01T00:00:00.000Z' },
      { id: 'b2', firstName: 'Jan', lastName: 'Zwilling', birthdate: '2011-01-01T00:00:00.000Z' },
    ];
    expect(matchAthlete({ name: 'Zwilling, Jan' }, twins)).toBeNull();
  });

  it('liefert null ohne jeden Treffer (kein automatisches Anlegen)', () => {
    expect(matchAthlete({ name: 'Unbekannt, Person' }, athletes)).toBeNull();
  });
});

describe('resolveEventLabel()', () => {
  const unmappedCode = { technik: 'X', distanzM: 25, isRelay: false, relaySize: 1 };
  const key = unmappedEventKey(unmappedCode);

  it('liefert das bereits vom Parser aufgelöste Label unverändert', () => {
    const imported = importedResult();
    expect(resolveEventLabel(imported, new Map())).toBe('100 Freistil');
  });

  it('löst ein unmapptes Event über eine Nutzerentscheidung auf ("map"/"create")', () => {
    const imported = importedResult({ eventCode: { ...unmappedCode, label: null } });
    const resolutions = new Map([[key, { action: 'map', event: '50 Rücken' }]]);
    expect(resolveEventLabel(imported, resolutions)).toBe('50 Rücken');
  });

  it('liefert null ohne Entscheidung oder bei "ignore"', () => {
    const imported = importedResult({ eventCode: { ...unmappedCode, label: null } });
    expect(resolveEventLabel(imported, new Map())).toBeNull();
    expect(resolveEventLabel(imported, new Map([[key, { action: 'ignore' }]]))).toBeNull();
  });
});

describe('buildImportPlan()', () => {
  const athlete = { id: 'a1', firstName: 'Max', lastName: 'Muster', nationalIDType: null, nationalID: null, birthdate: null };
  const baseArgs = {
    athletes: [athlete],
    eventResolutions: new Map(),
    clubId: 'club1',
    competitionId: 'comp1',
    competitionDate: '2026-01-01T00:00:00.000Z',
    competitionCourse: 'LCM',
  };

  it('markiert eine Zeile ohne Athlet:innen-Treffer als unmatched-athlete', () => {
    const rows = buildImportPlan({ ...baseArgs, importedResults: [importedResult({ athleteMatchHint: { name: 'Unbekannt, Wer' } })], existingResults: [] });
    expect(rows).toEqual([{ kind: 'unmatched-athlete', imported: expect.any(Object) }]);
  });

  it('markiert eine Zeile ohne Event-Auflösung als unmatched-event', () => {
    const imported = importedResult({ eventCode: { technik: 'X', distanzM: 25, isRelay: false, relaySize: 1, label: null } });
    const rows = buildImportPlan({ ...baseArgs, importedResults: [imported], existingResults: [] });
    expect(rows).toEqual([{ kind: 'unmatched-event', imported, athlete }]);
  });

  it('legt ein neues Result an, wenn noch keins existiert', () => {
    const rows = buildImportPlan({ ...baseArgs, importedResults: [importedResult()], existingResults: [] });
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe('new');
    expect(rows[0].proposed).toMatchObject({ athleteId: 'a1', event: '100 Freistil', time: 60, place: 1, status: 'OK', comments: [] });
  });

  it('überschreibt time/place/status/splits eines bestehenden Results, behält aber comments/id/createdAt', () => {
    const existingResult = {
      id: 'r1', athleteId: 'a1', event: '100 Freistil', competitionId: 'comp1',
      time: 99, place: 5, status: 'OK', isPB: true, createdAt: '2020-01-01T00:00:00.000Z',
      comments: [{ id: 'c1', authorName: 'Trainer', text: 'Toller Start', createdAt: '2020-01-01T00:00:00.000Z' }],
    };
    const rows = buildImportPlan({ ...baseArgs, importedResults: [importedResult({ time: 58.5, place: 2 })], existingResults: [existingResult] });
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe('update');
    expect(rows[0].proposed).toMatchObject({
      id: 'r1',
      time: 58.5,
      place: 2, // Platz wird IMMER aus der Datei übernommen (Plan Abschnitt 5.5), auch bei Abweichung
      createdAt: '2020-01-01T00:00:00.000Z',
      comments: existingResult.comments,
    });
  });

  it('reduziert mehrere Runden desselben Events auf die beste (Finale/Entscheidung vor Vorlauf)', () => {
    const heat = importedResult({ round: 'V', place: 3, time: 61 });
    const final = importedResult({ round: 'E', place: 1, time: 58 });
    const rows = buildImportPlan({ ...baseArgs, importedResults: [heat, final], existingResults: [] });
    expect(rows).toHaveLength(1);
    expect(rows[0].proposed.time).toBe(58);
    expect(rows[0].proposed.place).toBe(1);
  });

  it('setzt time auf null und place auf null bei Disqualifikation/Nichtantritt', () => {
    const dq = importedResult({ status: 'DS', time: null, place: null, statusNote: 'Frühstart' });
    const rows = buildImportPlan({ ...baseArgs, importedResults: [dq], existingResults: [] });
    expect(rows[0].proposed).toMatchObject({ time: null, place: null, status: 'DS', statusNote: 'Frühstart' });
  });
});
