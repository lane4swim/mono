// @vitest-environment jsdom
//
// apps/web/test/resultsImportUI.test.js
//
// End-to-End-Rauchtest für den DSV7-Import-UI-Flow (siehe
// docs/dsv7-lenex-import-plan.md Abschnitt 6): Datei auswählen ->
// Vereinsauswahl (kein automatischer Treffer, da keine nationalID
// hinterlegt) -> Vorschau -> Bestätigen -> Ergebnis landet in
// IndexedDB. Die Parser-/Matching-Logik selbst ist bereits in
// dsv7Parser.test.js/resultsImport.matching.test.js abgedeckt — hier geht
// es um die WIRING (Modal-Kette, Datenfluss, tatsächlicher Schreibzugriff).
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../js/demoMode.js', () => ({ IS_DEMO: false }));

const syncClientMock = vi.hoisted(() => ({ pull: vi.fn(async () => {}), push: vi.fn(async () => {}) }));
vi.mock('../js/syncClient.js', () => syncClientMock);

const stateMock = vi.hoisted(() => ({ getCurrentUser: vi.fn(() => ({ clubId: 'club1', clubNationalIDType: null, clubNationalID: null })) }));
vi.mock('../js/state.js', () => stateMock);

import * as db from '../js/db.js';
import { resultsImportButton } from '../js/modules/resultsImportUI.js';

// Diese jsdom-Version implementiert File.prototype.text() nicht (jeder
// echte Browser tut das) — resultsImportUI.js ruft es beim Datei-Select
// auf. FileReader.readAsText() steht in jsdom zur Verfügung und liefert
// dasselbe Ergebnis, daher hier als Test-Only-Polyfill nachgerüstet statt
// die Produktionslogik auf die ältere FileReader-API umzustellen.
if (typeof File.prototype.text !== 'function') {
  File.prototype.text = function () {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsText(this);
    });
  };
}

db.setClubIdProvider(() => 'club1');

// Offizielles DSV-Beispiel (siehe dsv7Parser.test.js) — enthält u. a.
// "Keller, Simone" (SV Hansa Adorf, 100 Freistil, 00:01:00,82).
const OFFICIAL_EXAMPLE = `
FORMAT:WETTKAMPFERGEBNISLISTE;7;
VERANSTALTUNG:EDV-Testwettkampf des SV NRW;Duisburg;25;HANDZEIT;
VERANSTALTER:Schwimmverband NRW;
AUSRICHTER:SC Duisburg;Biene, Petra;;;;;;;;
ABSCHNITT:1;09.03.2002;16:00;;
WETTKAMPF:1;V;1;;100;F;GL;W;SW;;;
WERTUNG:1;V;1;JG;0;9999;;OFFENE WERTUNG;
VEREIN:SV Hansa Adorf;1234;17;GER;
VEREIN:SC Duisburg;1237;10;GER;
PNERGEBNIS:1;V;1;7;;Keller, Simone;123456;4711;W;1990;;SV Hansa Adorf;1234;00:01:00,82;;;GER;;;
DATEIENDE
`;

function setupDom() {
  document.body.innerHTML = '';
  const appShell = document.createElement('div');
  appShell.id = 'app-shell';
  document.body.appendChild(appShell);
  const modalRoot = document.createElement('div');
  modalRoot.id = 'modal-root';
  modalRoot.hidden = true;
  document.body.appendChild(modalRoot);
}

function makeDsv7File(text) {
  const file = new File([text], 'test.dsv7', { type: 'text/plain' });
  // jsdom's File.text() reliably returns the given content (Blob.text()).
  return file;
}

async function selectFile(fileInput, file) {
  Object.defineProperty(fileInput, 'files', { value: [file], configurable: true });
  fileInput.dispatchEvent(new Event('change'));
  // Der change-Handler ist async (file.text() + Modal-Aufbau) — auf den
  // Mikrotask-Umlauf warten, damit das Modal im DOM steht, bevor der Test
  // weitermacht.
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}

beforeEach(async () => {
  setupDom();
  await db.wipeAll();
  syncClientMock.pull.mockClear();
  syncClientMock.push.mockClear();
  await db.put('athletes', { id: 'a-simone', firstName: 'Simone', lastName: 'Keller' });
});

describe('resultsImportButton() — voller Ablauf', () => {
  it('führt vom Datei-Select über Vereinsauswahl und Vorschau bis zum gespeicherten Ergebnis', async () => {
    const onImported = vi.fn();
    const comp = { id: 'comp1', date: '2026-01-01T00:00:00.000Z', course: 'LCM' };
    const wrapper = resultsImportButton(comp, onImported);
    document.body.appendChild(wrapper);
    const fileInput = wrapper.querySelector('input[type="file"]');

    await selectFile(fileInput, makeDsv7File(OFFICIAL_EXAMPLE));

    // Schritt 1: Vereinsauswahl (kein nationalID-Treffer hinterlegt).
    const modalRoot = document.getElementById('modal-root');
    expect(modalRoot.hidden).toBe(false);
    const clubOptions = [...modalRoot.querySelectorAll('option')].map((o) => o.value);
    expect(clubOptions).toEqual(['SV Hansa Adorf', 'SC Duisburg']);

    const clubSelect = modalRoot.querySelector('select');
    clubSelect.value = 'SV Hansa Adorf';
    modalRoot.querySelector('form').dispatchEvent(new Event('submit', { cancelable: true }));
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    // Schritt 2: keine unmappten Events für "100 Freistil" -> direkt Vorschau.
    expect(syncClientMock.pull).toHaveBeenCalledTimes(1);
    const bodyText = modalRoot.textContent;
    expect(bodyText).toContain('Keller');

    const confirmBtn = [...modalRoot.querySelectorAll('button')].find((b) => b.textContent.includes('importieren'));
    expect(confirmBtn).toBeTruthy();
    confirmBtn.click();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    const saved = await db.getAll('results');
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ athleteId: 'a-simone', event: '100 Freistil', time: 60.82, place: 7, status: 'OK' });
    expect(syncClientMock.push).toHaveBeenCalledTimes(1);
    expect(onImported).toHaveBeenCalledTimes(1);
  });

  it('zeigt einen Fehler-Toast statt eines Modals bei einer ungültigen Datei', async () => {
    const comp = { id: 'comp1', date: '2026-01-01T00:00:00.000Z', course: 'LCM' };
    const wrapper = resultsImportButton(comp, vi.fn());
    document.body.appendChild(wrapper);
    const fileInput = wrapper.querySelector('input[type="file"]');

    await selectFile(fileInput, makeDsv7File('nicht eine dsv7 datei'));

    const modalRoot = document.getElementById('modal-root');
    expect(modalRoot.hidden).toBe(true);
  });
});
