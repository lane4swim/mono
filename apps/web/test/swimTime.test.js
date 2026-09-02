// apps/web/test/swimTime.test.js
//
// timeToSec() wurde um dreisegmentige Zeiten (hh:mm:ss.cc) erweitert, damit
// der DSV7-Ergebnisimport (Zeitformat HH:MM:SS,hh, siehe
// docs/dsv7-lenex-import-plan.md Abschnitt 1.1) sie wiederverwenden kann,
// statt einen eigenen Zeit-Parser mitzubringen. Vormals griff `const [m, s]
// = str.split(':')` bei drei Segmenten stillschweigend daneben (die
// Sekunden gingen verloren) — dieser Test hält das fest.
import { describe, it, expect } from 'vitest';
import { timeToSec, secToTime } from '../js/swimTime.js';

describe('timeToSec()', () => {
  it('parst reine Sekunden mit Komma oder Punkt', () => {
    expect(timeToSec('29,03')).toBeCloseTo(29.03);
    expect(timeToSec('29.03')).toBeCloseTo(29.03);
  });

  it('parst mm:ss,cc (bestehendes Verhalten der App-Eingabefelder)', () => {
    expect(timeToSec('1:00,82')).toBeCloseTo(60.82);
    expect(timeToSec('4:30,04')).toBeCloseTo(270.04);
  });

  it('parst hh:mm:ss,cc korrekt (vormals verlorene Sekunden bei drei Segmenten)', () => {
    expect(timeToSec('00:01:04,30')).toBeCloseTo(64.30);
    expect(timeToSec('01:02:03,00')).toBeCloseTo(3723);
  });

  it('toleriert fehlende führende Nullen/Segmente wie in realen DSV7-Exporten', () => {
    expect(timeToSec('0:30,00')).toBeCloseTo(30);
    expect(timeToSec('1:01,44')).toBeCloseTo(61.44);
  });

  it('liefert null für leere Eingabe', () => {
    expect(timeToSec('')).toBeNull();
    expect(timeToSec(null)).toBeNull();
  });

  it('liefert NaN für nicht-numerische Eingabe', () => {
    expect(timeToSec('abc')).toBeNaN();
  });

  it('ist zu secToTime() für Rundenzeiten unter einer Stunde invers', () => {
    expect(timeToSec(secToTime(64.3))).toBeCloseTo(64.3);
  });
});
