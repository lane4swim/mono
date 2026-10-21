// Parser für DSV7-Wettkampfdefinitionslisten ("DSV Standard", Format 7,
// Listenart "Wettkampfdefinitionsliste", Dateiname-Zusatz "-Wk"). Liefert
// die ausgeschriebenen Disziplinen (Element WETTKAMPF) eines Wettkampfs,
// damit Startlisten-Einträge per Auswahlliste statt per Hand angelegt
// werden können (siehe modules/competitionDisciplines.js).
//
// Zeilenformat, Kommentare und Toleranzen wie bei der
// Wettkampfergebnisliste — der Tokenizer wird aus dsv7Parser.js
// wiederverwendet. WETTKAMPF hat in beiden Listenarten dasselbe Layout:
// Wettkampfnr;Wettkampfart;Abschnittsnr;AnzahlStarter;Einzelstrecke;
// Technik;Ausübung;Geschlecht;ZuordnungBestenliste;Qualifikations-
// Wettkampfnr;QualifikationsWettkampfart;
import { parseDsv7Line, Dsv7ParseError } from './dsv7Parser.js';
import { dsv7DisciplineEventLabel } from '../refdata.js';

function toInt(value) {
  if (!value) return undefined;
  const n = parseInt(value, 10);
  return Number.isNaN(n) ? undefined : n;
}

// Parst den Text einer DSV7-Wettkampfdefinitionsliste in
// { meta, disciplines }:
//
//   meta        — { veranstaltung, ort } zur Anzeige ("ist das die
//                  richtige Datei?").
//   disciplines — CompetitionDiscipline[] (siehe CompetitionDisciplineSchema
//                  in packages/shared-types/src/entities.ts), in
//                  Datei-Reihenfolge; Wettkämpfe ohne Nummer oder gültige
//                  Distanz werden übersprungen, doppelte Nummer+Wettkampfart
//                  nur einmal übernommen.
export function parseDsv7Wettkampfdefinitionsliste(text) {
  let listArt = null;
  let meta = { veranstaltung: '', ort: '' };
  const disciplines = [];
  const seen = new Set();

  for (const rawLine of text.split(/\r?\n/)) {
    const parsed = parseDsv7Line(rawLine);
    if (!parsed) continue;
    const { type, fields } = parsed;
    switch (type) {
      case 'FORMAT': {
        listArt = fields[0];
        if (listArt && listArt.toLowerCase() !== 'wettkampfdefinitionsliste') {
          throw new Dsv7ParseError(
            `Diese Datei ist keine Wettkampfdefinitionsliste (FORMAT: "${listArt}"). Zum Laden der Disziplinen wird der Listentyp "Wettkampfdefinitionsliste" benötigt.`,
          );
        }
        break;
      }
      case 'VERANSTALTUNG': {
        meta = { veranstaltung: fields[0] || '', ort: fields[1] || '' };
        break;
      }
      case 'WETTKAMPF': {
        const [nr, art, abschnittRaw, anzahlStarterRaw, distanzRaw, technik, ausuebung, geschlecht] = fields;
        const distanceM = toInt(distanzRaw);
        if (!nr || !distanceM || distanceM <= 0) break;
        const round = (art || '').toUpperCase();
        const key = `${nr}|${round}`;
        if (seen.has(key)) break;
        seen.add(key);
        const relaySize = toInt(anzahlStarterRaw) > 1 ? toInt(anzahlStarterRaw) : 1;
        const stroke = (technik || '').toUpperCase();
        const style = (ausuebung || '').toUpperCase();
        const session = toInt(abschnittRaw);
        disciplines.push({
          number: nr,
          round,
          ...(session > 0 ? { session } : {}),
          distanceM,
          stroke,
          style,
          relaySize,
          gender: (geschlecht || '').toUpperCase(),
          event: dsv7DisciplineEventLabel({ technik: stroke, distanzM: distanceM, relaySize, style }),
        });
        break;
      }
      default:
        // ERZEUGER, VERANSTALTER, AUSRICHTER, ABSCHNITT, MELDEADRESSE, MELDESCHLUSS,
        // BANKVERBINDUNG, BESONDERES, NACHWEIS, KAMPFGERICHT, WERTUNG,
        // PFLICHTZEIT, MELDEGELD, DATEIENDE — hier nicht benötigt.
        break;
    }
  }

  if (listArt === null) {
    throw new Dsv7ParseError('Keine gültige DSV7-Datei: Das FORMAT-Element (erste Zeile) fehlt.');
  }
  return { meta, disciplines };
}
