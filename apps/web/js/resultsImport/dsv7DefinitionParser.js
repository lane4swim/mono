// Parser für DSV7-/DSV8-Wettkampfdefinitionslisten ("DSV Standard",
// Format 7 bzw. 8, Listenart "Wettkampfdefinitionsliste", Dateiname-Zusatz
// "-Wk"). Liefert die ausgeschriebenen Disziplinen (Element WETTKAMPF)
// eines Wettkampfs, damit Startlisten-Einträge per Auswahlliste statt per
// Hand angelegt werden können (siehe modules/competitionDisciplines.js),
// sowie die Eckdaten der Veranstaltung (Name, Ort, Bahnlänge, Datum,
// Meldeschluss), aus denen ein ganzer Wettkampf angelegt werden kann —
// auch aus einer Wettkampfergebnisliste (siehe parseDsvCompetition()).
//
// Zeilenformat, Kommentare und Toleranzen wie bei der
// Wettkampfergebnisliste — der Tokenizer wird aus dsv7Parser.js
// wiederverwendet. WETTKAMPF hat in beiden Listenarten dasselbe Layout:
// Wettkampfnr;Wettkampfart;Abschnittsnr;AnzahlStarter;Einzelstrecke;
// Technik;Ausübung;Geschlecht;ZuordnungBestenliste;Qualifikations-
// Wettkampfnr;QualifikationsWettkampfart;
import { parseDsv7Line, Dsv7ParseError, checkDsvFormatVersion } from './dsv7Parser.js';
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
// Format 8 ergänzt neue Ausübungen (Delfin-Kicks in Bauch- bzw.
// Rückenlage), deren Kürzel hier nicht fest verdrahtet sind: in einer
// DSV8-Datei wird jedes zweistellige Kürzel übernommen und erscheint als
// Zusatz am Disziplin-Label (siehe refdata.js: dsv7DisciplineEventLabel()),
// statt die Disziplin zu verwerfen.
const DSV8_STYLE = /^[A-Z]{1,2}$/;
const COURSE_BY_LANE_LENGTH = { 25: 'SCM', 50: 'LCM' };
const GENDERS = new Set(['', 'M', 'W', 'X', 'D']);

function toInt(value) {
  if (!value || !/^\d+$/.test(value)) return undefined;
  const n = Number(value);
  return Number.isSafeInteger(n) ? n : undefined;
}

export const LIST_DEFINITION = 'wettkampfdefinitionsliste';
export const LIST_RESULTS = 'wettkampfergebnisliste';

// "TT.MM.JJJJ" -> "JJJJ-MM-TT", oder null bei ungültigem Datum.
function parseDsvDate(value) {
  const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(value || '');
  if (!m) return null;
  const [, d, mo, y] = m;
  const iso = `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
  const date = new Date(`${iso}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== iso ? null : iso;
}

// Parst den Text einer DSV7-/DSV8-Datei der Listenarten `listTypes` (Werte
// des Attributs "Listart" in Kleinschreibung) in
// { listArt, formatVersion, meta, disciplines, skipped }:
//
//   listArt       — "wettkampfdefinitionsliste" | "wettkampfergebnisliste".
//   formatVersion — "7" oder "8".
//   meta          — { veranstaltung, ort, course, date, entryDeadline }:
//                    Name und Ort aus VERANSTALTUNG (für die Anzeige "ist
//                    das die richtige Datei?" und zum Anlegen eines
//                    Wettkampfs), `course` aus der Bahnlänge ('SCM'/'LCM',
//                    null bei anderen Bahnlängen oder Freiwasser), `date`
//                    = frühestes ABSCHNITT-Datum und `entryDeadline` aus
//                    MELDESCHLUSS (je "JJJJ-MM-TT" oder null).
//   disciplines   — CompetitionDiscipline[] (siehe CompetitionDisciplineSchema
//                    in packages/shared-types/src/entities.ts), in
//                    Datei-Reihenfolge; doppelte Nummer+Wettkampfart nur
//                    einmal übernommen.
//   skipped       — Anzahl verworfener WETTKAMPF-Zeilen (fehlende/zu lange
//                    Nummer, ungültige Distanz, unbekannter Code).
//
// Mehr als MAX_DISCIPLINES gültige Wettkämpfe sind ein Fehler statt einer
// stillen Kürzung — eine abgeschnittene Liste sähe vollständig aus.
export function parseDsvCompetition(text, { listTypes = [LIST_DEFINITION, LIST_RESULTS] } = {}) {
  let listArt = null;
  let formatVersion = null;
  let meta = { veranstaltung: '', ort: '', course: null, date: null, entryDeadline: null };
  const disciplines = [];
  const seen = new Set();
  let skipped = 0;

  for (const rawLine of text.split(/\r?\n/)) {
    const parsed = parseDsv7Line(rawLine);
    if (!parsed) continue;
    const { type, fields } = parsed;
    switch (type) {
      case 'FORMAT': {
        listArt = (fields[0] || '').toLowerCase();
        if (!listTypes.includes(listArt)) {
          throw new Dsv7ParseError(listTypes.length === 1 && listTypes[0] === LIST_DEFINITION
            ? `Diese Datei ist keine Wettkampfdefinitionsliste (FORMAT: "${fields[0]}"). Zum Laden der Disziplinen wird der Listentyp "Wettkampfdefinitionsliste" benötigt.`
            : `Diese Datei ist weder Wettkampfdefinitions- noch Wettkampfergebnisliste (FORMAT: "${fields[0]}").`);
        }
        formatVersion = checkDsvFormatVersion(fields[1]);
        break;
      }
      case 'VERANSTALTUNG': {
        const [name, ort, bahnlaenge] = fields;
        meta = {
          ...meta,
          veranstaltung: (name || '').slice(0, 200),
          ort: (ort || '').slice(0, 200),
          course: COURSE_BY_LANE_LENGTH[toInt(bahnlaenge)] || null,
        };
        break;
      }
      case 'ABSCHNITT': {
        const date = parseDsvDate(fields[1]);
        if (date && (!meta.date || date < meta.date)) meta = { ...meta, date };
        break;
      }
      case 'MELDESCHLUSS': {
        meta = { ...meta, entryDeadline: parseDsvDate(fields[0]) };
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
        const validStyle = STYLES.has(style) || (formatVersion === '8' && DSV8_STYLE.test(style));
        const valid = nr && nr.length <= MAX_NUMBER_LENGTH
          && distanceM > 0 && distanceM <= MAX_DISTANCE_M
          && starters !== undefined
          && ROUNDS.has(round) && STROKES.has(stroke) && validStyle && GENDERS.has(gender);
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
        // ERZEUGER, VERANSTALTER, AUSRICHTER, MELDEADRESSE, BANKVERBINDUNG,
        // BESONDERES, NACHWEIS, KAMPFGERICHT, WERTUNG, PFLICHTZEIT,
        // MELDEGELD, VEREIN, PNERGEBNIS & Co., DATEIENDE — hier nicht
        // benötigt (Ergebnisse liest dsv7Parser.js).
        break;
    }
  }

  if (listArt === null) {
    throw new Dsv7ParseError('Keine gültige DSV-Datei: Das FORMAT-Element (erste Zeile) fehlt.');
  }
  if (disciplines.length > MAX_DISCIPLINES) {
    throw new Dsv7ParseError(`Diese Datei enthält ${disciplines.length} Wettkämpfe — unterstützt werden höchstens ${MAX_DISCIPLINES} je Wettkampf.`);
  }
  return { listArt, formatVersion, meta, disciplines, skipped };
}

// Nur Wettkampfdefinitionslisten (Format 7 oder 8) — zum Laden der
// Disziplinen in einen bestehenden Wettkampf.
export function parseDsv7Wettkampfdefinitionsliste(text) {
  return parseDsvCompetition(text, { listTypes: [LIST_DEFINITION] });
}
