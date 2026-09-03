// apps/web/test/dsv7Parser.test.js
//
// Der Fixture-Text unten ist das offizielle Beispiel für eine
// "Wettkampfergebnisliste" aus dem DSV-Standard-Dokument ("DSV Standard",
// Format 7, DSV, Abschnitt 5.4, Beispiel-Dateiname
// "2002-03-10-Duisburg-Pr.DSV7") — vom DSV selbst zur Illustration
// veröffentlicht, keine realen Personendaten. Ergänzt um handgeschriebene
// Zeilen für Fälle, die das offizielle Beispiel nicht abdeckt
// (Disqualifikation, nicht zuordenbares Event, inline-Kommentar).
import { describe, it, expect } from 'vitest';
import { parseDsv7Line, parseDsv7WettkampfergebnisListe, Dsv7ParseError } from '../js/resultsImport/dsv7Parser.js';

const OFFICIAL_EXAMPLE = `
FORMAT:WETTKAMPFERGEBNISLISTE;7;
ERZEUGER:Schwimmsoftware;1.01;info@meinewebseite.de;
VERANSTALTUNG:EDV-Testwettkampf des SV NRW;Duisburg;25;HANDZEIT;
VERANSTALTER:Schwimmverband NRW;
AUSRICHTER:SC Duisburg;Biene, Petra;Wabenstr. 69;47055;Duisburg;GER;0888/22222;0888/22223;PetraBiene@GibtsNicht.de;
ABSCHNITT:1;09.03.2002;16:00;;
ABSCHNITT:2;10.03.2002;16:00;;
KAMPFGERICHT:1;SPR;Heinze, Wolfgang; SV Hansa Adorf;
WETTKAMPF:1;V;1;;100;F;GL;W;SW;;;
WETTKAMPF:2;V;1;;50;R;GL;M;SW;;;
WETTKAMPF:3;E;2;;200;S;GL;W;SW;;;
WETTKAMPF:4;E;2;4;100;B;GL;M;SW;;;
WETTKAMPF:5;E;1;;100;F;GL;W;SW;;;
WETTKAMPF:101;F;1;;100;F;GL;W;SW;1;V;
WERTUNG:1;V;1;JG;0;9999;;OFFENE WERTUNG;
WERTUNG:1;V,2;JG;1989;;;JAHRGANG 1989;
WERTUNG:1;V;3;JG;1990;;;JAHRGANG 1990;
WERTUNG:2;V;4;JG;0;9999;;OFFENE WERTUNG;
WERTUNG:3;E;5;JG;0;9999;;OFFENE WERTUNG;
WERTUNG:4;E;6;JG;0;9999;;OFFENE WERTUNG;
WERTUNG:5;F,7;JG;0;9999;;OFFENE WERTUNG;
VEREIN:SV Hansa Adorf;1234;17;GER;
VEREIN:Delphin Burgstadt;1235;10;GER;
VEREIN:SC Wfr. Cleve;1236;10;GER;
VEREIN:SC Duisburg;1237;10;GER;
VEREIN:SG Essen-Nord;1238;10;GER;
PNERGEBNIS:1;V;1;7;;Keller, Simone;123456;4711;W;1990;;SV Hansa Adorf;1234;00:01:00,82;;;GER;;;
PNERGEBNIS:1;V;3;1;;Keller, Simone;123456;4711;W;1990;;SV Hansa Adorf;1234;00:01:00,82;;;GER;;;
PNZWISCHENZEIT:4711;1;V;50;00:00:29,06;
PNERGEBNIS:1;V;1;8;;Evers, Claudia;123459;5001;W;1990;;SC Duisburg;1237;00:01:00,93;;;GER;;;
PNERGEBNIS:1;V;3;2;;Evers, Claudia;123459;5001;W;1990;;SC Duisburg;1237;00:01:00,93;;;GER;;;
PNZWISCHENZEIT:5001;1;V;50;00:00:29,07;
PNERGEBNIS:1;V;1;9;;Post, Nicola;123440;5002;W;1990;;SG Essen-Nord;1238;1:01,44;;;GER;;;
PNERGEBNIS:1;V;3;5;;Post, Nicola;123440;5002;W;1990;;SG Essen-Nord;1238;1:01,44;;;GER;;;
PNZWISCHENZEIT:5002;1;V;50;0:30,00;
STERGEBNIS:4;E;6;1;;1;2012;Delphin Burgstadt;1235;00:04:29,74;;;;
STAFFELPERSON:2012;4;E;Lücke, Volker;123437;1;M;1989;;GER;;;
STAFFELPERSON:2012;4;E;Heider, Oliver;123435;2;M;1990;;GER;;;
STAFFELPERSON:2012;4;E;Berger, Thomas;123438;3;M;1990;;GER;;;
STAFFELPERSON:2012;4;E;Schön, Holger;123439;4;M;1989;;GER;;;
STZWISCHENZEIT:2012;4;E;1;100;00:01:04,11;
STZWISCHENZEIT:2012;4;E;2;200;00:02:10,82;
STZWISCHENZEIT:2012;4;E;3;300;00:03:20,73;
STZWISCHENZEIT:2012;4;E;4;400;00:04:29,74;
DATEIENDE
`;

describe('parseDsv7Line()', () => {
  it('zerlegt eine Datenzeile in Typ und Attribute', () => {
    expect(parseDsv7Line('FORMAT:Wettkampfergebnisliste;7;')).toEqual({ type: 'FORMAT', fields: ['Wettkampfergebnisliste', '7', ''] });
  });

  it('toleriert ein Leerzeichen nach dem Doppelpunkt (reale EasyWk-Exporte)', () => {
    expect(parseDsv7Line('FORMAT: Wettkampfergebnisliste;7;')).toEqual({ type: 'FORMAT', fields: ['Wettkampfergebnisliste', '7', ''] });
  });

  it('schneidet einen inline-Kommentar am Zeilenende ab', () => {
    expect(parseDsv7Line('WETTKAMPF: 1;E;1;1;100;F;GL;M;SW;;; (* 100m Freistil männlich *)'))
      .toEqual({ type: 'WETTKAMPF', fields: ['1', 'E', '1', '1', '100', 'F', 'GL', 'M', 'SW', '', '', ''] });
  });

  it('liefert null für reine Kommentar- oder Leerzeilen', () => {
    expect(parseDsv7Line('(* Dieses ist eine Kommentarzeile *)')).toBeNull();
    expect(parseDsv7Line('   ')).toBeNull();
  });

  it('behandelt ein Element ohne Attribute (DATEIENDE, kein Doppelpunkt)', () => {
    expect(parseDsv7Line('DATEIENDE')).toEqual({ type: 'DATEIENDE', fields: [] });
  });
});

describe('parseDsv7WettkampfergebnisListe() — offizielles Spezifikations-Beispiel', () => {
  const parsed = parseDsv7WettkampfergebnisListe(OFFICIAL_EXAMPLE);

  it('liest Veranstaltungsname/-ort', () => {
    expect(parsed.meta).toEqual({ veranstaltung: 'EDV-Testwettkampf des SV NRW', ort: 'Duisburg' });
  });

  it('sammelt alle Vereine mit ihrer DSV-Vereinskennzahl', () => {
    expect(parsed.clubs).toContainEqual({ name: 'SV Hansa Adorf', nationalIDType: 'DSV', nationalID: '1234' });
    expect(parsed.clubs).toHaveLength(5);
  });

  it('dedupliziert PNERGEBNIS-Zeilen desselben Schwimmversuchs über mehrere Wertungsklassen hinweg', () => {
    // Keller, Simone hat zwei PNERGEBNIS-Zeilen für denselben Versuch
    // (Wettkampf 1, Vorlauf: Platz 7 offene Wertung, Platz 1 Jahrgang
    // 1990) — nur EIN ImportedResult darf daraus entstehen.
    const kellerResults = parsed.results.filter((r) => r.athleteMatchHint.name === 'Keller, Simone');
    expect(kellerResults).toHaveLength(1);
    expect(kellerResults[0].place).toBe(7); // die zuerst genannte (offene) Wertung gewinnt
  });

  it('bildet die Einzelstrecke korrekt auf das Event ab und parst die Zeit', () => {
    const keller = parsed.results.find((r) => r.athleteMatchHint.name === 'Keller, Simone');
    expect(keller.eventCode.label).toBe('100 Freistil');
    expect(keller.round).toBe('V');
    expect(keller.time).toBeCloseTo(60.82);
    expect(keller.status).toBe('OK');
    expect(keller.clubName).toBe('SV Hansa Adorf');
    expect(keller.clubNationalID).toBe('1234');
  });

  it('ordnet PNZWISCHENZEIT der richtigen Person zu', () => {
    const keller = parsed.results.find((r) => r.athleteMatchHint.name === 'Keller, Simone');
    expect(keller.splits).toEqual([{ distanceM: 50, time: expect.closeTo(29.06, 2) }]);
  });

  it('parst Zeiten ohne führende Stunden-/Minutenanteile (reale Kurzformen)', () => {
    const post = parsed.results.find((r) => r.athleteMatchHint.name === 'Post, Nicola');
    expect(post.time).toBeCloseTo(61.44);
    expect(post.splits[0].time).toBeCloseTo(30);
  });

  it('bildet eine Staffel als je ein ImportedResult pro Teammitglied ab, mit gemeinsamer Teamzeit/-platzierung', () => {
    // WETTKAMPF 4 im Beispiel ist eine 4x100-Brust-"Staffel" (Testdaten des
    // DSV-Beispiels, keine reale Wettkampfdisziplin) — nicht in EVENTS
    // (nur Freistil-/Lagenstaffeln), landet also korrekt in
    // unmappedEvents statt in einem erfundenen Label.
    const relayMembers = parsed.results.filter((r) => r.relay);
    expect(relayMembers).toHaveLength(4);
    for (const member of relayMembers) {
      expect(member.eventCode.label).toBeNull();
      expect(member.eventCode.isRelay).toBe(true);
      expect(member.eventCode.relaySize).toBe(4);
      expect(member.time).toBeCloseTo(269.74); // 00:04:29,74
      expect(member.place).toBe(1);
      expect(member.clubName).toBe('Delphin Burgstadt');
    }
    const legIndices = relayMembers.map((m) => m.relay.legIndex).sort();
    expect(legIndices).toEqual([1, 2, 3, 4]);
    expect(parsed.unmappedEvents).toContainEqual({ technik: 'B', distanzM: 100, isRelay: true, relaySize: 4 });
  });

  it('gibt jedem Staffelmitglied dieselben (vollständigen) Team-Zwischenzeiten mit', () => {
    const relayMembers = parsed.results.filter((r) => r.relay);
    for (const member of relayMembers) {
      expect(member.splits).toHaveLength(4);
      expect(member.splits.map((s) => s.distanceM)).toEqual([100, 200, 300, 400]);
    }
  });
});

describe('parseDsv7WettkampfergebnisListe() — Sonderfälle', () => {
  it('setzt bei Disqualifikation/Nichtantritt status statt einer Zeit und place=null', () => {
    const text = `FORMAT:Wettkampfergebnisliste;7;
VERANSTALTUNG:Test;Ort;25;HANDZEIT;
VERANSTALTER:Test;
AUSRICHTER:Test;Test;;;;;;;;
ABSCHNITT:1;01.01.2026;10:00;;
WETTKAMPF:1;E;1;1;100;F;GL;M;SW;;;
WERTUNG:1;E;1;JG;0;9999;;OFFENE WERTUNG;
VEREIN:SC Test;9999;1;GER;
PNERGEBNIS:1;E;1;0;NA;Muster, Max;0;1;M;2000;;SC Test;9999;00:00:00,00;Nicht angetreten;;;;;
DATEIENDE`;
    const parsed = parseDsv7WettkampfergebnisListe(text);
    expect(parsed.results).toHaveLength(1);
    const [result] = parsed.results;
    expect(result.status).toBe('NA');
    expect(result.statusNote).toBe('Nicht angetreten');
    expect(result.time).toBeNull();
    expect(result.place).toBeNull();
  });

  it('meldet ein WETTKAMPF ohne EVENTS-Entsprechung als unmappedEvents statt es zu verwerfen', () => {
    const text = `FORMAT:Wettkampfergebnisliste;7;
VERANSTALTUNG:Test;Ort;25;HANDZEIT;
VERANSTALTER:Test;
AUSRICHTER:Test;Test;;;;;;;;
ABSCHNITT:1;01.01.2026;10:00;;
WETTKAMPF:1;E;1;1;25;R;GL;M;SW;;;
WERTUNG:1;E;1;JG;0;9999;;OFFENE WERTUNG;
VEREIN:SC Test;9999;1;GER;
PNERGEBNIS:1;E;1;1;;Muster, Max;0;1;M;2000;;SC Test;9999;00:00:15,00;;;;;;
DATEIENDE`;
    const parsed = parseDsv7WettkampfergebnisListe(text);
    expect(parsed.unmappedEvents).toEqual([{ technik: 'R', distanzM: 25, isRelay: false, relaySize: 1 }]);
    expect(parsed.results[0].eventCode.label).toBeNull();
  });

  it('lehnt eine Datei ab, deren FORMAT-Element nicht "Wettkampfergebnisliste" ist', () => {
    const text = 'FORMAT:Vereinsmeldeliste;7;\nDATEIENDE';
    expect(() => parseDsv7WettkampfergebnisListe(text)).toThrow(Dsv7ParseError);
  });

  it('lehnt eine Datei ohne FORMAT-Element ab', () => {
    expect(() => parseDsv7WettkampfergebnisListe('DATEIENDE')).toThrow(Dsv7ParseError);
  });
});

// Code-Review 2026-09-02, Befund K1: ResultSplitSchema.distanceM
// (packages/shared-types/src/entities.ts) ist `z.number().positive()` —
// ein Pflichtfeld. Eine Zwischenzeit ohne bekannte Distanz erzeugte vormals
// `{ distanceM: undefined, time: ... }`, das dieses Schema dauerhaft
// ablehnt (der Import meldet Erfolg, jeder Sync-Push scheitert). Ergebnis
// ohne Distanz-Angabe muss verworfen werden, nicht mit einer
// schema-verletzenden Lücke weitergereicht.
describe('parseDsv7WettkampfergebnisListe() — Befund K1 (Zwischenzeiten/Zeit ohne gültigen Wert)', () => {
  it('verwirft eine PNZWISCHENZEIT ohne Distanz-Angabe statt eine ungültige Split-Zeile zu erzeugen', () => {
    const text = `FORMAT:Wettkampfergebnisliste;7;
VERANSTALTUNG:Test;Ort;25;HANDZEIT;
VERANSTALTER:Test;
AUSRICHTER:Test;Test;;;;;;;;
ABSCHNITT:1;01.01.2026;10:00;;
WETTKAMPF:1;E;1;1;100;F;GL;M;SW;;;
WERTUNG:1;E;1;JG;0;9999;;OFFENE WERTUNG;
VEREIN:SC Test;9999;1;GER;
PNERGEBNIS:1;E;1;1;;Muster, Max;404306;149;M;2009;;SC Test;9999;00:01:04,30;;;;;;
PNZWISCHENZEIT:149;1;E;;00:00:30,10;
DATEIENDE`;
    const parsed = parseDsv7WettkampfergebnisListe(text);
    expect(parsed.results[0].splits).toEqual([]);
  });

  it('verwirft eine PNZWISCHENZEIT mit Distanz 0 ebenso (ResultSplitSchema verlangt .positive())', () => {
    const text = `FORMAT:Wettkampfergebnisliste;7;
VERANSTALTUNG:Test;Ort;25;HANDZEIT;
VERANSTALTER:Test;
AUSRICHTER:Test;Test;;;;;;;;
ABSCHNITT:1;01.01.2026;10:00;;
WETTKAMPF:1;E;1;1;100;F;GL;M;SW;;;
WERTUNG:1;E;1;JG;0;9999;;OFFENE WERTUNG;
VEREIN:SC Test;9999;1;GER;
PNERGEBNIS:1;E;1;1;;Muster, Max;404306;149;M;2009;;SC Test;9999;00:01:04,30;;;;;;
PNZWISCHENZEIT:149;1;E;0;00:00:30,10;
DATEIENDE`;
    const parsed = parseDsv7WettkampfergebnisListe(text);
    expect(parsed.results[0].splits).toEqual([]);
  });

  it('bildet eine als "OK" markierte Zeile mit Platzhalter-Endzeit (00:00:00,00) auf time: null statt 0 ab', () => {
    // ResultSchema.time ist `z.number().positive().nullable()` — `0` ist
    // ungültig. Ein solcher Datenfehler der Exportquelle (status "OK" ohne
    // echte Zeit) darf nicht als schema-verletzendes `time: 0` weitergereicht
    // werden.
    const text = `FORMAT:Wettkampfergebnisliste;7;
VERANSTALTUNG:Test;Ort;25;HANDZEIT;
VERANSTALTER:Test;
AUSRICHTER:Test;Test;;;;;;;;
ABSCHNITT:1;01.01.2026;10:00;;
WETTKAMPF:1;E;1;1;100;F;GL;M;SW;;;
WERTUNG:1;E;1;JG;0;9999;;OFFENE WERTUNG;
VEREIN:SC Test;9999;1;GER;
PNERGEBNIS:1;E;1;1;;Muster, Max;404306;149;M;2009;;SC Test;9999;00:00:00,00;;;;;;
DATEIENDE`;
    const parsed = parseDsv7WettkampfergebnisListe(text);
    expect(parsed.results[0].time).toBeNull();
  });

  it('verwirft eine STZWISCHENZEIT ohne gültige Distanz ebenso', () => {
    const text = `FORMAT:Wettkampfergebnisliste;7;
VERANSTALTUNG:Test;Ort;25;HANDZEIT;
VERANSTALTER:Test;
AUSRICHTER:Test;Test;;;;;;;;
ABSCHNITT:1;01.01.2026;10:00;;
WETTKAMPF:1;E;1;4;100;F;GL;M;SW;;;
WERTUNG:1;E;1;JG;0;9999;;OFFENE WERTUNG;
VEREIN:SC Test;9999;1;GER;
STERGEBNIS:1;E;1;1;;1;154;SC Test;9999;00:04:00,00;;;;
STAFFELPERSON:154;1;E;Muster, Max;404306;1;M;2009;;;;;
STZWISCHENZEIT:154;1;E;1;;00:01:00,00;
DATEIENDE`;
    const parsed = parseDsv7WettkampfergebnisListe(text);
    expect(parsed.results[0].splits).toEqual([]);
  });
});

// Code-Review 2026-09-02, Befund K4: STERGEBNIS wiederholt sich — wie
// PNERGEBNIS — einmal je Wertungsklasse für dieselbe Staffel, mit
// identischer Teambesetzung und identischen Zwischenzeiten. Ohne Dedupe
// entstand pro Teammitglied EIN ImportedResult je Wertungsklasse
// (Duplikate in der Importvorschau), und die zweite Wertungszeile
// überschrieb außerdem die geteilte `splits`-Array-Referenz der Gruppe,
// sodass ältere Mitglieds-Ergebnisse ihre Zwischenzeiten verloren.
describe('parseDsv7WettkampfergebnisListe() — Befund K4 (STERGEBNIS über mehrere Wertungsklassen)', () => {
  const text = `FORMAT:Wettkampfergebnisliste;7;
VERANSTALTUNG:Test;Ort;25;HANDZEIT;
VERANSTALTER:Test;
AUSRICHTER:Test;Test;;;;;;;;
ABSCHNITT:1;01.01.2026;10:00;;
WETTKAMPF:26;E;1;4;50;F;GL;M;SW;;;
WERTUNG:26;E;1;JG;0;9999;;OFFENE WERTUNG;
VEREIN:SV Test;5623;1;GER;
STERGEBNIS:26;E;26001;1;;1;154;SV Test;5623;00:01:50,00;;;;
STAFFELPERSON:154;26;E;Muster, Max;404306;1;M;2009;;;;;
STZWISCHENZEIT:154;26;E;1;50;00:00:27,50;
STERGEBNIS:26;E;26002;1;;1;154;SV Test;5623;00:01:50,00;;;;
STAFFELPERSON:154;26;E;Muster, Max;404306;1;M;2009;;;;;
DATEIENDE`;
  const parsed = parseDsv7WettkampfergebnisListe(text);

  it('erzeugt genau ein ImportedResult je Teammitglied, nicht eines je Wertungsklasse', () => {
    expect(parsed.results).toHaveLength(1);
  });

  it('behält die Zwischenzeit der ersten Wertungsklasse (wird nicht durch die zweite überschrieben)', () => {
    expect(parsed.results[0].splits).toEqual([{ distanceM: 50, time: expect.closeTo(27.5, 2), legIndex: 1 }]);
  });
});
