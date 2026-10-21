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

// Grenzen von CompetitionDisciplineSchema/CompetitionSchema.disciplines
// (packages/shared-types/src/entities.ts) — apps/web kann das Paket ohne
// Build-Schritt nicht importieren, daher hier gespiegelt und MUSS damit
// übereinstimmen. Eine Disziplin, die das Schema verletzt, würde lokal
// gespeichert, beim Sync-Push aber abgelehnt — und mit ihr der gesamte
// Wettkampf-Datensatz samt aller späteren Änderungen. Ungültige
// WETTKAMPF-Zeilen werden daher hier verworfen statt durchgereicht.
export const MAX_DISCIPLINES = 500;
const MAX_NUMBER_LENGTH = 50;
// Längste Wettkampfstrecke im Schwimmen ist 25 km Freiwasser.
const MAX_DISTANCE_M = 25000;
const MAX_SESSION = 99;
// Zulässige Codes laut "DSV Standard", Element WETTKAMPF. Ausübung und
// Geschlecht dürfen zusätzlich leer sein.
const ROUNDS = new Set(['V', 'Z', 'F', 'E', 'A', 'N']);
const STROKES = new Set(['F', 'R', 'B', 'S', 'L', 'X']);
const STYLES = new Set(['', 'GL', 'BE', 'AR', 'ST', 'WE', 'GB', 'X']);
const GENDERS = new Set(['', 'M', 'W', 'X', 'D']);

function toInt(value) {
  if (!value || !/^\d+$/.test(value)) return undefined;
  const n = Number(value);
  return Number.isSafeInteger(n) ? n : undefined;
}

// Parst den Text einer DSV7-Wettkampfdefinitionsliste in
// { meta, disciplines, skipped }:
//
//   meta        — { veranstaltung, ort } zur Anzeige ("ist das die
//                  richtige Datei?").
//   disciplines — CompetitionDiscipline[] (siehe CompetitionDisciplineSchema
//                  in packages/shared-types/src/entities.ts), in
//                  Datei-Reihenfolge; doppelte Nummer+Wettkampfart nur
//                  einmal übernommen.
//   skipped     — Anzahl verworfener WETTKAMPF-Zeilen (fehlende/zu lange
//                  Nummer, ungültige Distanz, unbekannter Code).
//
// Mehr als MAX_DISCIPLINES gültige Wettkämpfe sind ein Fehler statt einer
// stillen Kürzung — eine abgeschnittene Liste sähe vollständig aus.
export function parseDsv7Wettkampfdefinitionsliste(text) {
  let listArt = null;
  let meta = { veranstaltung: '', ort: '' };
  const disciplines = [];
  const seen = new Set();
  let skipped = 0;

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
        meta = { veranstaltung: (fields[0] || '').slice(0, 200), ort: (fields[1] || '').slice(0, 200) };
        break;
      }
      case 'WETTKAMPF': {
        const [nr, art, abschnittRaw, anzahlStarterRaw, distanzRaw, technik, ausuebung, geschlecht] = fields;
        const distanceM = toInt(distanzRaw);
        const round = (art || '').toUpperCase();
        const stroke = (technik || '').toUpperCase();
        const style = (ausuebung || '').toUpperCase();
        const gender = (geschlecht || '').toUpperCase();
        const starters = anzahlStarterRaw ? toInt(anzahlStarterRaw) : 1;
        const valid = nr && nr.length <= MAX_NUMBER_LENGTH
          && distanceM > 0 && distanceM <= MAX_DISTANCE_M
          && starters !== undefined
          && ROUNDS.has(round) && STROKES.has(stroke) && STYLES.has(style) && GENDERS.has(gender);
        if (!valid) { skipped++; break; }
        const key = `${nr}|${round}`;
        if (seen.has(key)) break;
        seen.add(key);
        const relaySize = starters > 1 ? starters : 1;
        const session = toInt(abschnittRaw);
        disciplines.push({
          number: nr,
          round,
          ...(session > 0 && session <= MAX_SESSION ? { session } : {}),
          distanceM,
          stroke,
          style,
          relaySize,
          gender,
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
  if (disciplines.length > MAX_DISCIPLINES) {
    throw new Dsv7ParseError(`Diese Datei enthält ${disciplines.length} Wettkämpfe — unterstützt werden höchstens ${MAX_DISCIPLINES} je Wettkampf.`);
  }
  return { meta, disciplines, skipped };
}
