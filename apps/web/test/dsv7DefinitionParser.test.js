// Fixture angelehnt an das Beispiel einer "Wettkampfdefinitionsliste" aus
// dem DSV-Standard-Dokument ("DSV Standard", Format 7, Abschnitt 5.1),
// ergänzt um Staffel, Teilübung (Beine), Sonderform und inline-Kommentare.
import { describe, it, expect } from 'vitest';
import { parseDsv7Wettkampfdefinitionsliste } from '../js/resultsImport/dsv7DefinitionParser.js';
import { Dsv7ParseError } from '../js/resultsImport/dsv7Parser.js';
import { dsv7DisciplineEventLabel } from '../js/refdata.js';

const DEFINITION = `
FORMAT: Wettkampfdefinitionsliste;7;
ERZEUGER:Schwimmsoftware;1.01;info@meinewebseite.de;
VERANSTALTUNG:EDV-Testwettkampf des SV NRW;Duisburg;25;HANDZEIT;
ABSCHNITT:1;09.03.2002;15:00;15:30;16:00;;
WETTKAMPF:1;V;1;;100;F;GL;W;SW;;; (* 100m Freistil weiblich *)
WETTKAMPF:2;E;1;;50;R;GL;M;SW;;;
WETTKAMPF:3;E;1;4;50;L;GL;X;SW;;;
WETTKAMPF:4;E;1;;25;F;BE;W;KG;;;
WETTKAMPF:5;E;1;;100;X;GL;M;KG;;;
WETTKAMPF:101;F;1;;100;F;GL;W;SW;1;V;
WETTKAMPF:101;F;1;;100;F;GL;W;SW;1;V;
WETTKAMPF:;E;1;;100;F;GL;W;SW;;;
WERTUNG:1;V;1;JG;0;9999;;OFFENE WERTUNG;
DATEIENDE
`;

describe('parseDsv7Wettkampfdefinitionsliste', () => {
  const { meta, disciplines } = parseDsv7Wettkampfdefinitionsliste(DEFINITION);

  it('liest Veranstaltung und Ort', () => {
    expect(meta).toEqual({ veranstaltung: 'EDV-Testwettkampf des SV NRW', ort: 'Duisburg' });
  });

  it('übernimmt jeden WETTKAMPF einmal, in Datei-Reihenfolge', () => {
    expect(disciplines.map(d => `${d.number}${d.round}`)).toEqual(['1V', '2E', '3E', '4E', '5E', '101F']);
  });

  it('bildet Einzel-, Staffel- und Teilübungs-Labels', () => {
    expect(disciplines[0]).toEqual({ number: '1', round: 'V', session: 1, distanceM: 100, stroke: 'F', style: 'GL', relaySize: 1, gender: 'W', event: '100 Freistil' });
    expect(disciplines[2]).toMatchObject({ relaySize: 4, gender: 'X', event: '4x50 Lagen' });
    expect(disciplines[3].event).toBe('25 Freistil Beine');
    expect(disciplines[4].event).toBeNull();
  });

  it('lehnt andere Listenarten ab', () => {
    expect(() => parseDsv7Wettkampfdefinitionsliste('FORMAT:Wettkampfergebnisliste;7;\n')).toThrow(Dsv7ParseError);
  });

  it('lehnt Dateien ohne FORMAT-Element ab', () => {
    expect(() => parseDsv7Wettkampfdefinitionsliste('WETTKAMPF:1;E;1;;100;F;GL;W;SW;;;\n')).toThrow(Dsv7ParseError);
  });
});

describe('dsv7DisciplineEventLabel', () => {
  it('bildet Labels auch außerhalb von EVENTS', () => {
    expect(dsv7DisciplineEventLabel({ technik: 'B', distanzM: 25, relaySize: 1, style: 'GL' })).toBe('25 Brust');
    expect(dsv7DisciplineEventLabel({ technik: 'F', distanzM: 50, relaySize: 8, style: '' })).toBe('8x50 Freistil');
    expect(dsv7DisciplineEventLabel({ technik: 'X', distanzM: 50, relaySize: 1, style: 'GL' })).toBeNull();
  });
});
