// apps/web/test/refdata.dsv7EventLabel.test.js
//
// dsv7EventLabel() bildet DSV7-WETTKAMPF-Attribute (Technik, Einzelstrecke,
// AnzahlStarter) auf einen EVENTS-String ab — Grundlage für das
// Event-Matching beim Ergebnisimport (siehe
// docs/dsv7-lenex-import-plan.md Abschnitt 3.5). Ungemapptes soll `null`
// liefern statt eines erfundenen Strings, damit die Importvorschau es
// zuverlässig als "nicht zuordenbar" erkennt.
import { describe, it, expect } from 'vitest';
import { EVENTS, dsv7EventLabel } from '../js/refdata.js';

describe('dsv7EventLabel()', () => {
  it('bildet eine Einzelstrecke auf den passenden EVENTS-String ab', () => {
    expect(dsv7EventLabel({ technik: 'F', distanzM: 100, isRelay: false, relaySize: 1 })).toBe('100 Freistil');
    expect(dsv7EventLabel({ technik: 'L', distanzM: 400, isRelay: false, relaySize: 1 })).toBe('400 Lagen');
  });

  it('bildet eine Staffel auf den "<Anzahl>x<Strecke> <Technik>"-String ab', () => {
    expect(dsv7EventLabel({ technik: 'F', distanzM: 100, isRelay: true, relaySize: 4 })).toBe('4x100 Freistil');
    expect(dsv7EventLabel({ technik: 'L', distanzM: 50, isRelay: true, relaySize: 4 })).toBe('4x50 Lagen');
  });

  it('liefert null für einen unbekannten Technik-Code (z. B. Sonderform X)', () => {
    expect(dsv7EventLabel({ technik: 'X', distanzM: 100, isRelay: false, relaySize: 1 })).toBeNull();
  });

  it('liefert null für eine Strecke/Staffelgröße ohne Entsprechung in EVENTS', () => {
    expect(dsv7EventLabel({ technik: 'R', distanzM: 25, isRelay: false, relaySize: 1 })).toBeNull();
    expect(dsv7EventLabel({ technik: 'B', distanzM: 100, isRelay: true, relaySize: 6 })).toBeNull();
  });

  it('liefert null ohne Distanzangabe', () => {
    expect(dsv7EventLabel({ technik: 'F', distanzM: 0, isRelay: false, relaySize: 1 })).toBeNull();
  });

  it('jedes zurückgegebene Label ist tatsächlich in EVENTS enthalten', () => {
    expect(EVENTS).toContain(dsv7EventLabel({ technik: 'S', distanzM: 200, isRelay: false, relaySize: 1 }));
  });
});
