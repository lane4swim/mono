// `CommentSchema.authorName` ist eine reine Client-Angabe. Ohne
// serverseitige Prüfung könnte jedes Vereinsmitglied per direktem
// POST /api/sync/push einen Kommentar unter beliebigem Namen hinterlassen
// und die Art.-17-Anonymisierung (jobs/commentAnonymization.ts) über einen
// abweichenden Namen gezielt umgehen. CommentSchema trägt deshalb
// zusätzlich `authorId`, und diese Datei prüft sie beim Push für die Stores
// mit eingebetteten Kommentar-Arrays:
//
//   * Ein Kommentar mit `authorId === requesterId` ist IMMER erlaubt.
//   * Jeder ANDERE Kommentar (fremde `authorId` oder gar keine) muss
//     ZEICHENGLEICH aus dem gespeicherten Datensatz stammen und wird dabei
//     höchstens EINMAL "verbraucht".
//
// Die zweite Regel ist bewusst ein verbrauchender Abgleich über den
// GESAMTEN Kommentar (Vielfachmenge) und NICHT ein Nachschlagen der
// `authorId` über die Kommentar-`id`: `CommentSchema.id` ist ein frei
// wählbarer, nicht eindeutiger Client-String (bewusst kein UUID, siehe
// entities.ts), weshalb ein id-Abgleich auf drei Wegen zu umgehen wäre —
// denselben id-Wert mit anderem Text ein zweites Mal im Array senden; ihn an
// einer anderen Stelle des Datensatzes einsetzen (Plan- statt
// Satz-Kommentar), da die Zuordnung über alle Fundstellen flach ist; oder
// nur den `text` eines bestehenden fremden Kommentars austauschen. Wer einen
// fremden Kommentar nicht unverändert lässt, hat im Vorrat keinen passenden
// Eintrag mehr.
//
// Altbestand: vor Einführung von `authorId` gespeicherte Kommentare tragen
// keins (JSONB, daher keine Spalten-Migration möglich). Sie gelten hier als
// "fremd" und sind damit unveränderlich, lassen sich aber unverändert
// weiterreichen — der umgebende Datensatz bleibt bearbeitbar, ohne dass sich
// ein Alt-Kommentar nachträglich jemandem zuschreiben ließe.
//
// GRENZE DER ZUSICHERUNG (bewusst, nicht übersehen): zugesichert ist, dass
// sich einer ANDEREN Person nichts unterschieben lässt. NICHT zugesichert
// ist, dass ein fremder Kommentar unantastbar wäre — wer den umgebenden
// Datensatz schreiben darf, darf ihn löschen oder auf den EIGENEN Namen
// umschreiben. Datenseitig ist das nicht von "fremden Kommentar gelöscht,
// eigenen mit demselben Text angelegt" zu unterscheiden, und Letzteres steht
// in einem geteilten Team-Dokument ohnehin jeder schreibberechtigten Person
// offen. Eine Sperre müsste das Löschen fremder Kommentare generell
// verbieten — auch Trainer:innen könnten dann keinen unpassenden Kommentar
// mehr entfernen.
import type { EntityStoreName } from '@lane1/shared-types';
import { isRecord } from '../shared/setEntries.js';
import { collectCommentArrays, isCommentBearingStore } from '../shared/commentLocations.js';

// Reihenfolgeunabhängige, rekursiv stabile Serialisierung eines
// Kommentars als Vergleichsschlüssel. Objektschlüssel werden sortiert,
// damit zwei inhaltsgleiche Kommentare denselben Schlüssel ergeben, auch
// wenn Client und Datenbank die Felder in unterschiedlicher Reihenfolge
// liefern (JSONB garantiert keine Feldreihenfolge).
function fingerprint(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(fingerprint).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${fingerprint(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

// Stabiler, sprachunabhängiger Stellvertreter für den (einzigen)
// Fehlertext unten (siehe apps/web/js/i18n/{de-DE,en-US}.js:
// common.syncErrors).
export const COMMENT_AUTHORSHIP_ERROR_CODE = 'comment_authorship_invalid';

// Prüft einen bereits Zod-validierten create/update-Payload gegen den
// zuletzt gespeicherten Stand. Welche Stores Kommentare tragen und wo,
// legt modules/shared/commentLocations.ts fest. Gibt bei einem Verstoß
// eine Fehlermeldung zurück, sonst `null` — für Stores ohne eingebettete
// Kommentare immer `null` (No-op).
export function assertCommentAuthorship(
  store: EntityStoreName,
  payload: Record<string, unknown>,
  existing: Record<string, unknown> | null,
  requesterId: string,
): string | null {
  if (!isCommentBearingStore(store)) return null;

  // Vorrat: alle FREMDEN Kommentare des bestehenden Datensatzes als
  // Vielfachmenge (Schlüssel -> verbleibende Anzahl). Eigene Kommentare
  // stehen bewusst nicht darin — sie dürfen ohnehin frei geändert werden
  // und müssen daher nichts "verbrauchen".
  const availableForeign = new Map<string, number>();
  for (const group of collectCommentArrays(store, existing)) {
    for (const comment of group) {
      if (!isRecord(comment) || comment.authorId === requesterId) continue;
      const key = fingerprint(comment);
      availableForeign.set(key, (availableForeign.get(key) ?? 0) + 1);
    }
  }

  for (const group of collectCommentArrays(store, payload)) {
    for (const comment of group) {
      if (!isRecord(comment) || comment.authorId === requesterId) continue;
      const key = fingerprint(comment);
      const remaining = availableForeign.get(key) ?? 0;
      if (remaining === 0) {
        return 'Fremde Kommentare können nur unverändert übernommen werden; neue Kommentare müssen der eigenen Identität zugeordnet sein (authorId).';
      }
      availableForeign.set(key, remaining - 1);
    }
  }

  return null;
}
