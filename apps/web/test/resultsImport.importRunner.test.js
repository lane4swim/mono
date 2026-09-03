// apps/web/test/resultsImport.importRunner.test.js
//
// executeImportPlan() ist der einzige Teil des Ergebnisimports, der
// tatsächlich IndexedDB schreibt — dieser Test läuft daher gegen ein
// echtes (fake-indexeddb-gestütztes) db.js statt gegen Mocks, wie schon
// db.test.js. syncClient.js wird gemockt, damit kein Netzwerk-Push
// versucht wird; nur seine Aufrufe werden geprüft.
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../js/demoMode.js', () => ({ IS_DEMO: false }));

// vi.mock()-Fabriken werden an den Dateianfang gehoben — vi.hoisted() macht
// die Mock-Funktionen für den beforeEach()-Reset unten trotzdem zugreifbar
// (siehe z. B. test/state.moduleDeprovisioning.test.js für dasselbe Muster).
const syncClientMock = vi.hoisted(() => ({ pull: vi.fn(async () => {}), push: vi.fn(async () => {}) }));
vi.mock('../js/syncClient.js', () => syncClientMock);

import * as db from '../js/db.js';
import { loadImportContext, executeImportPlan } from '../js/resultsImport/importRunner.js';

db.setClubIdProvider(() => 'club1');

beforeEach(async () => {
  await db.wipeAll();
  syncClientMock.pull.mockClear();
  syncClientMock.push.mockClear();
});

describe('loadImportContext()', () => {
  it('pullt zuerst den Server-Stand und liefert dann Athlet:innen/Ergebnisse', async () => {
    await db.put('athletes', { firstName: 'Max', lastName: 'Muster' });
    await db.put('results', { athleteId: 'x', event: '100 Freistil', time: 60, date: '2026-01-01T00:00:00.000Z', course: 'LCM', competitionId: 'comp1', isPB: false, comments: [] });
    await db.put('results', { athleteId: 'y', event: '100 Freistil', time: 61, date: '2026-01-01T00:00:00.000Z', course: 'LCM', competitionId: 'comp2', isPB: false, comments: [] });

    const ctx = await loadImportContext('comp1');

    expect(syncClientMock.pull).toHaveBeenCalledTimes(1);
    expect(ctx.athletes).toHaveLength(1);
    expect(ctx.allResults).toHaveLength(2);
    expect(ctx.existingResults).toHaveLength(1);
    expect(ctx.existingResults[0].competitionId).toBe('comp1');
  });
});

describe('executeImportPlan()', () => {
  it('schreibt nur new/update-Zeilen, überspringt unmatched-*', async () => {
    const rows = [
      { kind: 'unmatched-athlete', imported: {} },
      { kind: 'unmatched-event', imported: {}, athlete: {} },
      { kind: 'new', proposed: { athleteId: 'a1', event: '100 Freistil', time: 60, place: 1, status: 'OK', date: '2026-01-01T00:00:00.000Z', course: 'LCM', competitionId: 'comp1', comments: [] } },
    ];
    const saved = await executeImportPlan(rows, []);
    expect(saved).toHaveLength(1);
    expect(await db.getAll('results')).toHaveLength(1);
    expect(syncClientMock.push).toHaveBeenCalledTimes(1);
  });

  it('berechnet isPB neu, statt einen Datei-Wert zu übernehmen', async () => {
    const rows = [
      { kind: 'new', proposed: { athleteId: 'a1', event: '100 Freistil', time: 60, place: 1, status: 'OK', date: '2026-01-01T00:00:00.000Z', course: 'LCM', competitionId: 'comp1', comments: [] } },
    ];
    const [saved] = await executeImportPlan(rows, []);
    expect(saved.isPB).toBe(true); // einziges Ergebnis dieser Athlet:in/dieses Events -> PB

    const fasterRows = [
      { kind: 'new', proposed: { athleteId: 'a1', event: '100 Freistil', time: 55, place: 1, status: 'OK', date: '2026-01-02T00:00:00.000Z', course: 'LCM', competitionId: 'comp2', comments: [] } },
    ];
    const [faster] = await executeImportPlan(fasterRows, [saved]);
    expect(faster.isPB).toBe(true);

    const slowerRows = [
      { kind: 'new', proposed: { athleteId: 'a1', event: '100 Freistil', time: 58, place: 2, status: 'OK', date: '2026-01-03T00:00:00.000Z', course: 'LCM', competitionId: 'comp3', comments: [] } },
    ];
    const [slower] = await executeImportPlan(slowerRows, [saved, faster]);
    expect(slower.isPB).toBe(false); // langsamer als der bestehende Bestwert (55s)
  });

  it('setzt isPB nie bei einem disqualifizierten/nicht angetretenen Ergebnis', async () => {
    const rows = [
      { kind: 'new', proposed: { athleteId: 'a1', event: '100 Freistil', time: null, place: null, status: 'DS', date: '2026-01-01T00:00:00.000Z', course: 'LCM', competitionId: 'comp1', comments: [] } },
    ];
    const [saved] = await executeImportPlan(rows, []);
    expect(saved.isPB).toBe(false);
  });

  // Code-Review 2026-09-02, Befund K2: der vormalige Vergleich
  // `others.every((r) => r.time != null && proposed.time < r.time)`
  // brach für ein ergebnisloses Geschwister-Ergebnis (time: null, z. B.
  // DS/NA/AB/AU/ZU) NICHT etwa nur für DIESES Ergebnis ab — `every()`
  // liefert für den `r.time != null`-Zweig `false`, wodurch `others.every`
  // insgesamt `false` wurde und die betroffene Person auf diesem Event NIE
  // wieder eine Bestzeit bekam, unabhängig davon, wie schnell sie
  // tatsächlich schwamm.
  it('erkennt eine echte Bestzeit trotz eines ergebnislosen (disqualifizierten) Geschwister-Ergebnisses', async () => {
    const dsq = await db.put('results', {
      athleteId: 'a1', event: '100 Freistil', time: null, place: null, status: 'DS', date: '2026-01-01T00:00:00.000Z', course: 'LCM', competitionId: 'comp1', comments: [],
    });
    const rows = [
      { kind: 'new', proposed: { athleteId: 'a1', event: '100 Freistil', time: 60, place: 1, status: 'OK', date: '2026-01-02T00:00:00.000Z', course: 'LCM', competitionId: 'comp2', comments: [] } },
    ];
    const [saved] = await executeImportPlan(rows, [dsq]);
    expect(saved.isPB).toBe(true);
  });

  it('behält id/comments eines bestehenden Ergebnisses beim Überschreiben bei', async () => {
    const existing = await db.put('results', {
      athleteId: 'a1', event: '100 Freistil', time: 70, place: 5, status: 'OK', date: '2026-01-01T00:00:00.000Z', course: 'LCM', competitionId: 'comp1',
      comments: [{ id: 'c1', authorName: 'Trainer', text: 'Guter Start', createdAt: '2026-01-01T00:00:00.000Z' }],
    });
    const rows = [
      { kind: 'update', proposed: { id: existing.id, athleteId: 'a1', event: '100 Freistil', time: 65, place: 2, status: 'OK', date: '2026-01-01T00:00:00.000Z', course: 'LCM', competitionId: 'comp1', comments: existing.comments, createdAt: existing.createdAt } },
    ];
    const [saved] = await executeImportPlan(rows, [existing]);
    expect(saved.id).toBe(existing.id);
    expect(saved.time).toBe(65);
    expect(saved.comments).toEqual(existing.comments);
    expect(saved.createdAt).toBe(existing.createdAt);
    expect(await db.getAll('results')).toHaveLength(1); // Überschreiben, kein Duplikat
  });

  it('pusht nicht, wenn es nichts zu schreiben gab', async () => {
    await executeImportPlan([{ kind: 'unmatched-athlete', imported: {} }], []);
    expect(syncClientMock.push).not.toHaveBeenCalled();
  });
});
