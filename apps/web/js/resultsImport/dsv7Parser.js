// ============================================================
// resultsImport/dsv7Parser.js — Parser für DSV7-Wettkampfergebnislisten
// ("DSV Standard", Format 7, DSV, gültig ab 01.01.2023) in das
// gemeinsame Zwischenformat ImportedResult (siehe
// docs/dsv7-lenex-import-plan.md Abschnitt 4).
//
// DSV7 ist eine reine, zeilenbasierte, UTF-8-Textdatei — KEIN XML. Jede
// Datenzeile hat die Form "ELEMENT:Attribut1;Attribut2;...;", das
// Trennzeichen zwischen Attributen ist ';', optionale Attribute bleiben
// leer, tragen aber trotzdem ihr Trennzeichen. Kommentare stehen in
// "(* ... *)" — als eigene Zeile ODER als Suffix am Ende einer Datenzeile
// (reale EasyWk-Exporte tun das regelmäßig, z. B.
// "WETTKAMPF: 1;E;1;1;100;F;GL;M;SW;;; (* 100m Freistil männlich *)").
//
// Bewusst NUR die "Wettkampfergebnisliste" unterstützt (nicht
// Wettkampfdefinitions-/Vereinsmelde-/Vereinsergebnisliste) — das ist die
// einzige Listenart, die für den Ergebnisimport in eine bestehende
// Wettkampfansicht relevant ist (siehe Plan Abschnitt 1.2).
import { timeToSec } from '../swimTime.js';
import { dsv7EventLabel } from '../refdata.js';

export class Dsv7ParseError extends Error {}

// ---- Zeilen-Tokenizer -------------------------------------------------

// Schneidet einen optionalen "(* ... *)"-Kommentar-Suffix ab. DSV7-Kommentare
// sind laut Standard einzeilig — ein zweites "(*" auf derselben Zeile
// kommt in der Praxis nicht vor, daher genügt die Suche nach dem ERSTEN
// Vorkommen.
function stripTrailingComment(line) {
  const idx = line.indexOf('(*');
  return idx === -1 ? line : line.slice(0, idx);
}

// Zerlegt eine Rohzeile in { type, fields } oder liefert null für
// Leerzeilen/reine Kommentarzeilen. `type` ist die Element-Konstante vor
// dem ersten ':' (z. B. "WETTKAMPF"), `fields` die per ';' getrennten,
// getrimmten Attribute danach. Elemente ohne Attribute (nur DATEIENDE)
// haben keinen ':' — dafür wird die gesamte getrimmte Zeile als `type`
// mit leerem `fields`-Array verwendet.
//
// Bewusst tolerant gegenüber einem Leerzeichen nach dem ':' (reale
// EasyWk-Exporte schreiben "FORMAT: Wettkampfergebnisliste;7;" statt
// "FORMAT:Wettkampfergebnisliste;7;" aus den Beispielen der Spezifikation)
// — es wird am ERSTEN ':' gesplittet und getrimmt, nicht auf exakte
// Zeichenpositionen vertraut.
export function parseDsv7Line(rawLine) {
  const withoutComment = stripTrailingComment(rawLine).trim();
  if (!withoutComment) return null;
  const colonIdx = withoutComment.indexOf(':');
  if (colonIdx === -1) return { type: withoutComment, fields: [] };
  const type = withoutComment.slice(0, colonIdx).trim();
  const fields = withoutComment.slice(colonIdx + 1).split(';').map((f) => f.trim());
  return { type, fields };
}

// ---- Kleine Feld-Helfer -------------------------------------------------

// DSV7 markiert "kein Wert bekannt" bei numerischen IDs durchgängig mit
// "0" (DSV-ID Schwimmer/Verein) statt eines leeren Feldes — beides wird
// hier gleich behandelt.
function nonZero(value) {
  if (!value || value === '0') return undefined;
  return value;
}

function toInt(value) {
  if (!value) return undefined;
  const n = parseInt(value, 10);
  return Number.isNaN(n) ? undefined : n;
}

// ResultSchema.time (packages/shared-types/src/entities.ts) ist
// `z.number().positive().nullable()` — weder `NaN`/`undefined` noch `0`
// sind gültig. DSV7 trägt für nicht gewertete Versuche (DS/NA/AB/AU/ZU)
// ohnehin den Platzhalter "00:00:00,00" als Endzeit; ohne diese Prüfung
// würde eine ansonsten korrekt als "OK" markierte Zeile mit genau dieser
// Platzhalterzeit (Datenfehler der Exportquelle) eine `time: 0` erzeugen,
// die das Schema ablehnt — der Datensatz wäre dann dauerhaft nicht mehr
// synchronisierbar (siehe Code-Review 2026-09-02, Befund K1), statt hier
// bereits sauber auf `null` abgebildet zu werden.
function positiveTimeOrNull(sec) {
  return Number.isFinite(sec) && sec > 0 ? sec : null;
}

// ResultSplitSchema.distanceM (packages/shared-types/src/entities.ts) ist
// `z.number().positive()` — ein Pflichtfeld. `toInt()` liefert `undefined`
// für ein leeres/nicht-numerisches Distanz-Feld; eine Zwischenzeit ohne
// bekannte Distanz ist ohnehin nicht sinnvoll darstellbar und wird daher
// hier verworfen statt an `splits` angehängt (Code-Review 2026-09-02,
// Befund K1) — ein Datensatz mit einem schema-verletzenden Split-Eintrag
// wäre sonst dauerhaft nicht mehr synchronisierbar.
function isValidSplit(distanceM, time) {
  return Number.isFinite(distanceM) && distanceM > 0 && Number.isFinite(time) && time > 0;
}

const GENDER_MAP = { M: 'm', W: 'w', D: 'd' };

// ---- Hauptparser -------------------------------------------------------

// Reihenfolge, in der ein Ergebnis für dieselbe Kombination aus Athlet:in
// + Event "gewinnt", wenn eine Datei mehrere Runden desselben Wettkampfs
// enthält (z. B. Vorlauf UND Finale) — das lokale Result-Modell kennt pro
// Athlet:in/Event/Wettkampf nur EINEN Datensatz, anders als DSV7. Die
// bestmögliche/letzte Runde gewinnt: Entscheidung/Finale vor
// Aus-/Nachschwimmen vor Zwischenlauf vor Vorlauf. Wird vom
// Matching-Modul (nicht diesem Parser) verwendet, hier nur exportiert,
// damit beide Seiten dieselbe Quelle verwenden.
export const ROUND_PRIORITY = ['E', 'F', 'A', 'N', 'Z', 'V'];

// Stabiler Schlüssel für ein nicht auf EVENTS abbildbares Wettkampf-Profil
// (Technik/Distanz/Staffelgröße) — von parseDsv7WettkampfergebnisListe()
// für `unmappedEvents` verwendet, UND vom Matching-Modul
// (resultsImport/matching.js), um eine Nutzerentscheidung ("diesem Event
// zuordnen" / "neues Event anlegen" / "ignorieren", siehe Plan Abschnitt
// 3.5) auf die betroffenen ImportedResult-Zeilen zurückzubeziehen.
export function unmappedEventKey({ technik, distanzM, isRelay, relaySize }) {
  return `${technik}|${distanzM}|${isRelay}|${relaySize}`;
}

// Parst eine vollständige DSV7-Wettkampfergebnisliste (als bereits
// dekodierter UTF-8-Text) in { meta, clubs, unmappedEvents, results }.
//
//   meta            — { veranstaltung, ort } zur Anzeige/Bestätigung in
//                      der Importvorschau ("ist das die richtige Datei?").
//   clubs           — alle VEREIN-Einträge der Datei, für die manuelle
//                      Vereinsauswahl im Vorschau-Dialog (Plan Abschnitt
//                      1.4.5): [{ name, nationalIDType: 'DSV', nationalID }]
//   unmappedEvents  — WETTKAMPF-Einträge, die dsv7EventLabel() nicht auf
//                      ein bestehendes EVENTS-Element abbilden konnte,
//                      dedupliziert nach (technik, distanzM, isRelay,
//                      relaySize) — Grundlage für die interaktive
//                      Event-Auflösung (Plan Abschnitt 3.5).
//   results         — ImportedResult[] (Plan Abschnitt 4), inkl. Zeilen
//                      mit unmappedEvent (dort ist eventCode.label null;
//                      das Matching-Modul markiert sie dann als "nicht
//                      zuordenbar" statt sie zu verwerfen).
export function parseDsv7WettkampfergebnisListe(text) {
  const lines = text.split(/\r?\n/);

  let listArt = null;
  let meta = { veranstaltung: '', ort: '' };
  const clubsBynationalID = new Map(); // dedupliziert über Vereinskennzahl bzw. Name
  const wettkampfByNr = new Map(); // Wettkampfnr -> { distanzM, technik, isRelay, relaySize }
  const unmappedEventsByKey = new Map();
  const results = [];
  // Lookup für PNZWISCHENZEIT: "veranstaltungsId|wettkampfnr|wettkampfart" -> ImportedResult
  const individualResultsByKey = new Map();
  // Lookup für STZWISCHENZEIT: "veranstaltungsIdStaffel|wettkampfnr|wettkampfart" ->
  // ImportedResult[] (ein Eintrag je Staffel-Mitglied, siehe unten).
  const relayResultsByKey = new Map();

  function recordUnmappedEvent({ technik, distanzM, isRelay, relaySize }) {
    const key = unmappedEventKey({ technik, distanzM, isRelay, relaySize });
    if (!unmappedEventsByKey.has(key)) {
      unmappedEventsByKey.set(key, { technik, distanzM, isRelay, relaySize });
    }
    return key;
  }

  for (const rawLine of lines) {
    const parsed = parseDsv7Line(rawLine);
    if (!parsed) continue;
    const { type, fields } = parsed;

    switch (type) {
      case 'FORMAT': {
        listArt = fields[0];
        if (listArt && listArt.toLowerCase() !== 'wettkampfergebnisliste') {
          throw new Dsv7ParseError(
            `Diese Datei ist keine Wettkampfergebnisliste (FORMAT: "${listArt}"). Für den Ergebnisimport wird ausschließlich der Listentyp "Wettkampfergebnisliste" unterstützt.`,
          );
        }
        break;
      }
      case 'VERANSTALTUNG': {
        meta = { veranstaltung: fields[0] || '', ort: fields[1] || '' };
        break;
      }
      case 'WETTKAMPF': {
        const [nr, , , anzahlStarterRaw, distanzRaw, technik] = fields;
        const distanzM = toInt(distanzRaw);
        const relaySize = toInt(anzahlStarterRaw) || 1;
        const isRelay = relaySize > 1;
        wettkampfByNr.set(nr, { distanzM, technik, isRelay, relaySize });
        break;
      }
      case 'VEREIN': {
        const [name, kennzahl] = fields;
        const nationalID = nonZero(kennzahl);
        const key = nationalID ? `DSV:${nationalID}` : `NAME:${name}`;
        if (!clubsBynationalID.has(key)) {
          clubsBynationalID.set(key, { name, nationalIDType: nationalID ? 'DSV' : undefined, nationalID });
        }
        break;
      }
      case 'PNERGEBNIS': {
        const [
          wettkampfnr, wettkampfart, , platzRaw, grund, name, dsvId, veranstaltungsId,
          geschlecht, jahrgangRaw, , verein, vereinskennzahl, endzeit, dqBemerkung,
        ] = fields;

        // PNERGEBNIS wiederholt sich für DENSELBEN Schwimmversuch einmal je
        // Wertung(sklasse) — z. B. Platz 7 in der offenen Wertung UND
        // Platz 1 im eigenen Jahrgang, beides für ein und dieselbe Zeit
        // (identische veranstaltungsId+Wettkampfnr+Wettkampfart, siehe
        // Beispiel in Abschnitt 5.4 der Spezifikation: "PNERGEBNIS:4711;1;V;1;7;..."
        // gefolgt von "PNERGEBNIS:4711;1;V;3;1;..."). Unser lokales
        // Ergebnis-Modell kennt keine Wertungsklassen, nur EINEN Platz je
        // Schwimmversuch — die erste (i. d. R. die offene/Gesamt-)Wertung
        // gewinnt, weitere Wertungszeilen für denselben Versuch werden
        // ignoriert statt Duplikate zu erzeugen.
        const dedupeKey = `${veranstaltungsId}|${wettkampfnr}|${wettkampfart}`;
        if (individualResultsByKey.has(dedupeKey)) break;

        const wk = wettkampfByNr.get(wettkampfnr);
        const eventLabel = wk ? dsv7EventLabel({ technik: wk.technik, distanzM: wk.distanzM, isRelay: false, relaySize: 1 }) : null;
        if (wk && !eventLabel) recordUnmappedEvent({ technik: wk.technik, distanzM: wk.distanzM, isRelay: false, relaySize: 1 });

        const status = grund || 'OK';
        const place = grund ? null : (toInt(platzRaw) > 0 ? toInt(platzRaw) : null);
        const time = status === 'OK' ? positiveTimeOrNull(timeToSec(endzeit)) : null;

        const result = {
          athleteMatchHint: {
            name,
            nationalIDType: nonZero(dsvId) ? 'DSV' : undefined,
            nationalID: nonZero(dsvId),
            birthYear: toInt(jahrgangRaw),
            gender: GENDER_MAP[geschlecht],
          },
          eventCode: wk
            ? { distanceM: wk.distanzM, stroke: wk.technik, isRelay: false, relaySize: 1, label: eventLabel }
            : { distanceM: undefined, stroke: undefined, isRelay: false, relaySize: 1, label: null },
          round: wettkampfart,
          time,
          place,
          status,
          statusNote: dqBemerkung || undefined,
          splits: [],
          clubName: verein,
          clubNationalIDType: nonZero(vereinskennzahl) ? 'DSV' : undefined,
          clubNationalID: nonZero(vereinskennzahl),
        };
        results.push(result);
        individualResultsByKey.set(dedupeKey, result);
        break;
      }
      case 'PNZWISCHENZEIT': {
        const [veranstaltungsId, wettkampfnr, wettkampfart, distanzRaw, zwischenzeit] = fields;
        const target = individualResultsByKey.get(`${veranstaltungsId}|${wettkampfnr}|${wettkampfart}`);
        const distanceM = toInt(distanzRaw);
        const splitTime = timeToSec(zwischenzeit);
        if (target && isValidSplit(distanceM, splitTime)) {
          target.splits.push({ distanceM, time: splitTime });
        }
        break;
      }
      case 'STERGEBNIS': {
        const [
          wettkampfnr, wettkampfart, , platzRaw, grund, , veranstaltungsIdStaffel,
          verein, vereinskennzahl, endzeit, , dqBemerkung,
        ] = fields;

        // Wie PNERGEBNIS (siehe dortiger Kommentar) wiederholt sich die
        // GESAMTE Gruppe STERGEBNIS+STAFFELPERSON*n+STZWISCHENZEIT*m einmal
        // je Wertungsklasse — mit identischer Teambesetzung und identischen
        // Zwischenzeiten, nur der WertungsID (hier verworfen) und ggf. Platz/
        // Wertungsklasse unterscheiden sich. Ohne diese Prüfung überschriebe
        // eine zweite Wertungszeile die bereits angelegte Gruppe samt ihrem
        // `template` (inkl. dessen `splits`-Array, auf das bereits erzeugte
        // STAFFELPERSON-Mitglieder per Referenz zeigen) mit einer frischen,
        // leeren Instanz — UND die nachfolgenden STAFFELPERSON-/
        // STZWISCHENZEIT-Zeilen dieser zweiten Wertung würden, da sie sich
        // per Schlüssel weiterhin auf dieselbe Staffel beziehen, erneut
        // dieselben Teammitglieder/Zwischenzeiten anlegen. Die erste
        // Wertungszeile gewinnt (analog zu PNERGEBNIS); `seenLegIndexes`/
        // `seenSplitKeys` unten verhindern zusätzlich, dass die
        // NACHFOLGENDEN Zeilen derselben (deduplizierten) Wertung echte
        // Duplikate erzeugen (Code-Review 2026-09-02, Befund K4).
        const dedupeKey = `${veranstaltungsIdStaffel}|${wettkampfnr}|${wettkampfart}`;
        if (relayResultsByKey.has(dedupeKey)) break;

        const wk = wettkampfByNr.get(wettkampfnr);
        const eventLabel = wk ? dsv7EventLabel({ technik: wk.technik, distanzM: wk.distanzM, isRelay: true, relaySize: wk.relaySize }) : null;
        if (wk && !eventLabel) recordUnmappedEvent({ technik: wk.technik, distanzM: wk.distanzM, isRelay: true, relaySize: wk.relaySize });

        const status = grund || 'OK';
        const place = grund ? null : (toInt(platzRaw) > 0 ? toInt(platzRaw) : null);
        const time = status === 'OK' ? positiveTimeOrNull(timeToSec(endzeit)) : null;

        // Ergebnis-Vorlage für das Team — pro STAFFELPERSON (unten) wird
        // daraus ein eigenes ImportedResult mit individuellem
        // athleteMatchHint, damit jedes Teammitglied dieses Ergebnis im
        // eigenen Ergebnisverlauf sieht (Result.athleteId ist im lokalen
        // Datenmodell zwingend genau eine Person, siehe
        // docs/dsv7-lenex-import-plan.md — es gibt kein Team-Result).
        // `splits` wird bewusst NICHT pro Bein aufgeteilt, sondern jedem
        // Teammitglied identisch als volle Team-Zwischenzeiten-Liste
        // mitgegeben (STZWISCHENZEIT liefert kumulierte Team-Distanzen,
        // keine isolierten Einzelbeine) — bekannte Vereinfachung.
        const template = {
          eventCode: wk
            ? { distanceM: wk.distanzM, stroke: wk.technik, isRelay: true, relaySize: wk.relaySize, label: eventLabel }
            : { distanceM: undefined, stroke: undefined, isRelay: true, relaySize: undefined, label: null },
          round: wettkampfart,
          time,
          place,
          status,
          statusNote: dqBemerkung || undefined,
          splits: [],
          clubName: verein,
          clubNationalIDType: nonZero(vereinskennzahl) ? 'DSV' : undefined,
          clubNationalID: nonZero(vereinskennzahl),
        };
        // `seenLegIndexes`/`seenSplitKeys` (siehe Kommentar oben und
        // STAFFELPERSON/STZWISCHENZEIT unten): je EINMAL pro Staffel
        // erzeugt, unabhängig davon, wie oft sich die gesamte
        // Wertungs-Gruppe in der Datei wiederholt — bleiben dadurch auch
        // über eine deduplizierte (übersprungene) Wiederholung hinweg
        // gültig, um GENAU DIESE Wiederholung erkennen zu können.
        relayResultsByKey.set(dedupeKey, { template, members: [], seenLegIndexes: new Set(), seenSplitKeys: new Set() });
        break;
      }
      case 'STAFFELPERSON': {
        const [veranstaltungsIdStaffel, wettkampfnr, wettkampfart, name, dsvId, startnummerRaw, geschlecht, jahrgangRaw] = fields;
        const group = relayResultsByKey.get(`${veranstaltungsIdStaffel}|${wettkampfnr}|${wettkampfart}`);
        if (!group) break; // STERGEBNIS fehlt/wurde nicht erkannt — Zeile kann nicht zugeordnet werden
        const legIndex = toInt(startnummerRaw);
        // Siehe STERGEBNIS-Kommentar oben (Befund K4): eine wiederholte
        // Wertungsklasse listet dieselbe Teambesetzung erneut — dieselbe
        // Startnummer für diese Staffel ein zweites Mal bedeutet "bereits
        // erfasstes Mitglied", nicht ein zweites, unabhängiges Ergebnis.
        if (group.seenLegIndexes.has(legIndex)) break;
        group.seenLegIndexes.add(legIndex);
        const result = {
          ...group.template,
          // splits bleibt hier bewusst als Referenz auf group.template.splits
          // erhalten (Spread kopiert nur die Array-REFERENZ, nicht den
          // Inhalt) — spätere STZWISCHENZEIT-Zeilen für dieselbe Staffel
          // befüllen dieselbe Array-Instanz, sichtbar für alle bereits
          // erzeugten Mitglieds-Results.
          athleteMatchHint: {
            name,
            nationalIDType: nonZero(dsvId) ? 'DSV' : undefined,
            nationalID: nonZero(dsvId),
            birthYear: toInt(jahrgangRaw),
            gender: GENDER_MAP[geschlecht],
          },
          relay: { legIndex, teamSize: group.template.eventCode.relaySize },
        };
        group.members.push(result);
        results.push(result);
        break;
      }
      case 'STZWISCHENZEIT': {
        const [veranstaltungsIdStaffel, wettkampfnr, wettkampfart, startnummerRaw, distanzRaw, zwischenzeit] = fields;
        const group = relayResultsByKey.get(`${veranstaltungsIdStaffel}|${wettkampfnr}|${wettkampfart}`);
        const distanceM = toInt(distanzRaw);
        const legIndex = toInt(startnummerRaw);
        const splitTime = timeToSec(zwischenzeit);
        // Siehe STERGEBNIS-Kommentar oben (Befund K4): dieselbe
        // (Distanz, Startnummer)-Kombination taucht bei einer wiederholten
        // Wertungsklasse ein zweites Mal mit identischem Wert auf — ohne
        // diese Prüfung erschiene dieselbe Zwischenzeit doppelt im
        // gemeinsamen `splits`-Array jedes Teammitglieds.
        const splitKey = `${distanceM}|${legIndex}`;
        if (group && isValidSplit(distanceM, splitTime) && !group.seenSplitKeys.has(splitKey)) {
          group.seenSplitKeys.add(splitKey);
          // Dieselbe Array-Instanz wird von group.template UND jedem
          // bereits erzeugten Mitglieds-Result referenziert (siehe
          // STAFFELPERSON oben) — ein push() hier macht die Zwischenzeit
          // dadurch für alle sichtbar, unabhängig von der Reihenfolge
          // STAFFELPERSON/STZWISCHENZEIT in der Datei. `legIndex` = die
          // Startnummer des/der Ablösenden, zu dessen/deren Bein diese
          // (kumulierte) Zwischenzeit gehört.
          group.template.splits.push({ distanceM, time: splitTime, legIndex });
        }
        break;
      }
      default:
        // PNREAKTION, STABLOESE, WERTUNG, KAMPFGERICHT, ABSCHNITT,
        // AUSRICHTER, VERANSTALTER, ERZEUGER, DATEIENDE — für den
        // Ergebnisimport nicht benötigt (siehe Plan Abschnitt 1.2/1.4).
        break;
    }
  }

  if (listArt === null) {
    throw new Dsv7ParseError('Keine gültige DSV7-Datei: Das FORMAT-Element (erste Zeile) fehlt.');
  }

  return {
    meta,
    clubs: [...clubsBynationalID.values()],
    unmappedEvents: [...unmappedEventsByKey.values()],
    results,
  };
}
