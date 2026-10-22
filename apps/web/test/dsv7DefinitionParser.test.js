// Fixture angelehnt an das Beispiel einer "Wettkampfdefinitionsliste" aus
// dem DSV-Standard-Dokument ("DSV Standard", Format 7, Abschnitt 5.1),
// ergänzt um Staffel, Teilübung (Beine), Sonderform und inline-Kommentare.
import { describe, it, expect } from 'vitest';
import { parseDsv7Wettkampfdefinitionsliste, parseDsvCompetition, MAX_DISCIPLINES } from '../js/resultsImport/dsv7DefinitionParser.js';
import { CompetitionDisciplineSchema, CompetitionSchema } from '../../../packages/shared-types/src/entities.js';
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

  it('liest Veranstaltung, Ort, Bahnlänge und Datum', () => {
    expect(meta).toEqual({ veranstaltung: 'EDV-Testwettkampf des SV NRW', ort: 'Duisburg', course: 'SCM', date: '2002-03-09', entryDeadline: null });
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

  it('zählt die Zeile ohne Wettkampfnummer als übersprungen', () => {
    expect(parseDsv7Wettkampfdefinitionsliste(DEFINITION).skipped).toBe(1);
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

// Absichtlich fehlerhafte Dateien: Nichts, was der Parser liefert, darf das
// Sync-Schema verletzen — sonst wäre der Wettkampf-Datensatz nach dem
// Laden dauerhaft nicht mehr synchronisierbar.
describe('parseDsv7Wettkampfdefinitionsliste mit fehlerhaften Zeilen', () => {
  const HEADER = 'FORMAT:Wettkampfdefinitionsliste;7;\n';
  const VALID = 'WETTKAMPF:1;E;1;;100;F;GL;M;SW;;;';
  const MALFORMED = [
    'WETTKAMPF:1;E;1;;100;FREISTIL;GL;M;SW;;;', // unbekannte Technik
    `WETTKAMPF:${'9'.repeat(51)};E;1;;100;F;GL;M;SW;;;`, // Nummer zu lang
    'WETTKAMPF:1;E;1;;99999999999999999999;F;GL;M;SW;;;', // Distanz kein sicherer Integer
    'WETTKAMPF:1;E;1;;30000;F;GL;M;SW;;;', // Distanz unplausibel
    'WETTKAMPF:1;E;1;;-50;F;GL;M;SW;;;', // negative Distanz
    'WETTKAMPF:1;E;1;;50m;F;GL;M;SW;;;', // Distanz nicht numerisch
    'WETTKAMPF:1;FINALE;1;;100;F;GL;M;SW;;;', // unbekannte Wettkampfart
    'WETTKAMPF:1;E;1;;100;F;BEINE;M;SW;;;', // unbekannte Ausübung
    'WETTKAMPF:1;E;1;;100;F;GL;MAENNLICH;SW;;;', // unbekanntes Geschlecht
    'WETTKAMPF:1;E;1;vier;100;F;GL;M;SW;;;', // Anzahl Starter nicht numerisch
    'WETTKAMPF:1;E',  // abgeschnittene Zeile
  ];

  it.each(MALFORMED)('verwirft %s', (line) => {
    const { disciplines, skipped } = parseDsv7Wettkampfdefinitionsliste(HEADER + line);
    expect(disciplines).toEqual([]);
    expect(skipped).toBe(1);
  });

  it('übernimmt gültige Zeilen neben fehlerhaften, alle schema-konform', () => {
    const text = HEADER + [...MALFORMED, VALID, 'WETTKAMPF:2;E;1000;8;50;F;GL;X;SW;;;'].join('\n');
    const { disciplines, skipped } = parseDsv7Wettkampfdefinitionsliste(text);
    expect(disciplines.map(d => d.number)).toEqual(['1', '2']);
    expect(skipped).toBe(MALFORMED.length);
    // Abschnittsnummer außerhalb des Bereichs wird weggelassen, nicht übernommen.
    expect('session' in disciplines[1]).toBe(false);
    for (const d of disciplines) expect(CompetitionDisciplineSchema.safeParse(d).success).toBe(true);
  });

  it('kürzt überlange Veranstaltungsangaben', () => {
    const { meta } = parseDsv7Wettkampfdefinitionsliste(`${HEADER}VERANSTALTUNG:${'x'.repeat(5000)};${'y'.repeat(5000)};25;HANDZEIT;\n${VALID}`);
    expect(meta.veranstaltung).toHaveLength(200);
    expect(meta.ort).toHaveLength(200);
  });

  it('lehnt mehr Wettkämpfe ab, als das Schema zulässt, statt still zu kürzen', () => {
    const lines = (n) => Array.from({ length: n }, (_, i) => `WETTKAMPF:${i + 1};E;1;;100;F;GL;M;SW;;;`).join('\n');
    const atLimit = parseDsv7Wettkampfdefinitionsliste(HEADER + lines(MAX_DISCIPLINES)).disciplines;
    expect(atLimit).toHaveLength(MAX_DISCIPLINES);
    const now = new Date().toISOString();
    const comp = { id: '11111111-1111-1111-1111-111111111111', clubId: '22222222-2222-2222-2222-222222222222', name: 'Test', date: now, course: 'SCM', createdAt: now, updatedAt: now, disciplines: atLimit };
    expect(CompetitionSchema.safeParse(comp).success).toBe(true);
    expect(() => parseDsv7Wettkampfdefinitionsliste(HEADER + lines(MAX_DISCIPLINES + 1))).toThrow(Dsv7ParseError);
  });
});

describe('parseDsvCompetition', () => {
  it('liest Format 8 wie Format 7 und übernimmt neue Ausübungs-Kürzel', () => {
    const text = [
      'FORMAT:Wettkampfdefinitionsliste;8;',
      'VERANSTALTUNG:Herbstpokal;Hannover;50;AUTOMATISCH;',
      'ABSCHNITT:2;16.11.2026;09:00;;10:00;;',
      'ABSCHNITT:1;15.11.2026;09:00;;10:00;;',
      'MELDESCHLUSS:01.11.2026;18:00;',
      'WETTKAMPF:1;E;1;;100;F;GL;W;SW;;;',
      'WETTKAMPF:2;E;1;;25;S;DR;M;KG;;;',
      'WETTKAMPF:3;E;1;;100;F;BEINE;M;SW;;;',
      'DATEIENDE',
    ].join('\n');
    const parsed = parseDsvCompetition(text);
    expect(parsed.formatVersion).toBe('8');
    expect(parsed.listArt).toBe('wettkampfdefinitionsliste');
    expect(parsed.meta).toEqual({ veranstaltung: 'Herbstpokal', ort: 'Hannover', course: 'LCM', date: '2026-11-15', entryDeadline: '2026-11-01' });
    expect(parsed.disciplines.map(d => d.event)).toEqual(['100 Freistil', '25 Schmetterling DR']);
    expect(parsed.skipped).toBe(1);
    for (const d of parsed.disciplines) expect(CompetitionDisciplineSchema.safeParse(d).success).toBe(true);
  });

  it('verwirft in Format 7 unbekannte Ausübungen weiterhin', () => {
    const { disciplines, skipped } = parseDsvCompetition('FORMAT:Wettkampfdefinitionsliste;7;\nWETTKAMPF:2;E;1;;25;S;DR;M;KG;;;');
    expect(disciplines).toEqual([]);
    expect(skipped).toBe(1);
  });

  it('liest Disziplinen und Eckdaten auch aus einer Wettkampfergebnisliste', () => {
    const text = 'FORMAT:Wettkampfergebnisliste;8;\nVERANSTALTUNG:Stadtmeisterschaft;Berlin;FW;HANDZEIT;\nABSCHNITT:1;31.02.2026;10:00;;\nWETTKAMPF:1;E;1;;50;B;GL;W;SW;;;\nPNERGEBNIS:1;E;1;1;;Muster, Maria;0;1;W;2010;;SC Test;9999;00:00:40,00;;;;;;';
    const parsed = parseDsvCompetition(text);
    expect(parsed.listArt).toBe('wettkampfergebnisliste');
    // Freiwasser und ein ungültiges Datum bleiben leer statt geraten.
    expect(parsed.meta).toMatchObject({ veranstaltung: 'Stadtmeisterschaft', course: null, date: null });
    expect(parsed.disciplines.map(d => d.event)).toEqual(['50 Brust']);
  });

  it('lehnt nicht unterstützte Formatversionen und andere Listenarten ab', () => {
    expect(() => parseDsvCompetition('FORMAT:Wettkampfdefinitionsliste;6;\n')).toThrow(Dsv7ParseError);
    expect(() => parseDsvCompetition('FORMAT:Wettkampfdefinitionsliste;9;\n')).toThrow(Dsv7ParseError);
    expect(() => parseDsvCompetition('FORMAT:Vereinsmeldeliste;8;\n')).toThrow(Dsv7ParseError);
  });

  it('lädt Disziplinen in einen bestehenden Wettkampf nur aus Definitionslisten, auch in Format 8', () => {
    expect(parseDsv7Wettkampfdefinitionsliste('FORMAT:Wettkampfdefinitionsliste;8;\nWETTKAMPF:1;E;1;;100;F;GL;M;SW;;;').disciplines).toHaveLength(1);
    expect(() => parseDsv7Wettkampfdefinitionsliste('FORMAT:Wettkampfergebnisliste;8;\n')).toThrow(Dsv7ParseError);
  });
});
