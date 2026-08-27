// apps/api/src/modules/sync/sync.commentAuthorship.ts
//
// Sicherheitsreview 2026-08-27, Befund M2: `CommentSchema.authorName`
// (packages/shared-types/src/entities.ts) war eine reine Client-Angabe
// ohne jede serverseitige Verifikation — jedes Vereinsmitglied konnte per
// direktem POST /api/sync/push einen Kommentar unter einem beliebigen
// Namen hinterlassen (Identitätsvortäuschung), und die Art.-17-
// Anonymisierung (Befund N5 des Vorreviews) ließ sich über einen bewusst
// abweichenden Namen gezielt umgehen.
//
// Fix: CommentSchema trägt jetzt zusätzlich `authorId` (die tatsächliche
// User-ID). Diese Datei prüft für die drei Stores mit eingebetteten
// Kommentar-Arrays (exercises, plans, templates) beim Push:
//
//   * Ein Kommentar mit `authorId === requesterId` ist IMMER erlaubt —
//     eigene Kommentare dürfen frei angelegt, bearbeitet und gelöscht
//     werden.
//   * Jeder ANDERE Kommentar (fremde `authorId`, oder gar keine — siehe
//     Altbestand unten) muss ZEICHENGLEICH aus dem bereits gespeicherten
//     Datensatz stammen und wird dabei höchstens EINMAL "verbraucht".
//
// Die zweite Regel ist bewusst als verbrauchender Abgleich über den
// GESAMTEN Kommentar (Vielfachmenge) formuliert, nicht als Nachschlagen
// der `authorId` über die Kommentar-`id`. Ein reiner id-Abgleich war die
// erste Fassung dieses Fixes und ließ sich auf drei Wegen umgehen, weil
// `CommentSchema.id` ein frei wählbarer, nicht eindeutiger Client-String
// ist (bewusst kein UUID, siehe entities.ts):
//   1. Denselben `id`-Wert ein zweites Mal im selben Array senden — der
//      Nachschlag traf den bestehenden Kommentar, der Text war frei
//      wählbar (beliebig viele erfundene Kommentare unter fremdem Namen).
//   2. Denselben `id`-Wert an einer ANDEREN Stelle des Datensatzes
//      einsetzen (z. B. Plan-Kommentar -> Satz-Kommentar), da die
//      id->authorId-Zuordnung über alle Fundstellen hinweg flach war.
//   3. Nur den `text` eines bestehenden fremden Kommentars austauschen —
//      die `authorId` blieb dabei unverändert und der Abgleich griff
//      nicht.
// Alle drei fallen mit dem Abgleich über den vollständigen Kommentar weg:
// wer einen fremden Kommentar nicht unverändert lässt, hat keinen
// passenden Eintrag mehr im Vorrat.
//
// Altbestand: Kommentare, die VOR Einführung von `authorId` gespeichert
// wurden, tragen keins (JSONB, daher keine Spalten-Migration möglich —
// siehe Kommentar an CommentSchema). Sie sind hier automatisch "fremd"
// und damit unveränderlich, lassen sich aber unverändert weiterreichen —
// der umgebende Datensatz bleibt also bearbeitbar, ohne dass sich ein
// Alt-Kommentar nachträglich jemandem zuschreiben ließe.
//
// GRENZE DER ZUSICHERUNG (bewusst, nicht übersehen): Zugesichert ist,
// dass sich einer ANDEREN Person nichts unterschieben lässt. NICHT
// zugesichert ist, dass ein fremder Kommentar unantastbar wäre — wer den
// umgebenden Datensatz schreiben darf, darf ihn auch löschen oder auf den
// EIGENEN Namen umschreiben. Beides ist datenseitig nicht von "fremden
// Kommentar gelöscht und einen eigenen mit demselben Text angelegt" zu
// unterscheiden, und Letzteres steht in einem geteilten Team-Dokument
// (plans/exercises/templates, siehe STORE_PERMISSIONS) ohnehin jeder
// schreibberechtigten Person offen. Eine Sperre dagegen müsste das
// Löschen fremder Kommentare generell verbieten — eine fachliche
// Einschränkung (auch Trainer:innen könnten dann keinen unpassenden
// Kommentar mehr entfernen), die über den Befund hinausginge.
import type { EntityStoreName } from '@lane1/shared-types';

// Die drei Stores, deren Entity-Schema irgendwo ein CommentSchema[]
// einbettet (siehe entities.ts: ExerciseSchema.comments,
// PlanSchema.comments, PlainSetSchema.comments — Letzteres sowohl über
// Plan.days[].sets als auch über Template.sets erreichbar).
export const COMMENT_BEARING_STORES: ReadonlySet<EntityStoreName> = new Set(['exercises', 'plans', 'templates']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Sammelt die comments-Arrays aller SetEntry-Einträge (PlainSet ODER
// RepeatBlock, siehe SetEntrySchema) — ein "set" trägt sein eigenes
// comments-Array direkt, ein "block" enthält stattdessen eine
// verschachtelte sets-Liste (keine verschachtelten Blöcke laut Schema),
// dort rekursiv weitergesucht. Identisches Traversierungsmuster wie
// collectSetExerciseIds() in sync.foreignKeys.ts, hier nur für
// "comments" statt "exerciseId".
function collectSetEntryCommentGroups(sets: unknown): unknown[][] {
  if (!Array.isArray(sets)) return [];
  const groups: unknown[][] = [];
  for (const entry of sets) {
    if (!isRecord(entry)) continue;
    if (entry.kind === 'set') {
      groups.push(Array.isArray(entry.comments) ? entry.comments : []);
    } else if (entry.kind === 'block') {
      groups.push(...collectSetEntryCommentGroups(entry.sets));
    }
  }
  return groups;
}

// Alle comments-Arrays eines Datensatzes für einen der drei betroffenen
// Stores — jeweils EIN Array je Fundstelle (Plan-weite Kommentare, je
// Satz/Block verschachtelte, Übungs-/Vorlagen-Kommentare). Wird sowohl
// auf den Zod-validierten Payload als auch auf den rohen, zuletzt
// gespeicherten Stand (SyncGateway.findById()) angewendet.
function collectCommentGroups(store: EntityStoreName, record: Record<string, unknown> | null): unknown[][] {
  if (!record) return [];
  if (store === 'exercises') {
    return [Array.isArray(record.comments) ? record.comments : []];
  }
  if (store === 'templates') {
    return collectSetEntryCommentGroups(record.sets);
  }
  // store === 'plans'
  const groups: unknown[][] = [Array.isArray(record.comments) ? record.comments : []];
  for (const day of Array.isArray(record.days) ? record.days : []) {
    if (isRecord(day)) groups.push(...collectSetEntryCommentGroups(day.sets));
  }
  return groups;
}

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

// Prüft einen bereits Zod-validierten create/update-Payload für einen der
// drei betroffenen Stores gegen den zuletzt gespeicherten Stand. Gibt bei
// einem Verstoß eine Fehlermeldung zurück, sonst `null` — Stores ohne
// eingebettete Kommentare (alle übrigen sieben) sind immer `null`
// (No-op).
export function assertCommentAuthorship(
  store: EntityStoreName,
  payload: Record<string, unknown>,
  existing: Record<string, unknown> | null,
  requesterId: string,
): string | null {
  if (!COMMENT_BEARING_STORES.has(store)) return null;

  // Vorrat: alle FREMDEN Kommentare des bestehenden Datensatzes als
  // Vielfachmenge (Schlüssel -> verbleibende Anzahl). Eigene Kommentare
  // stehen bewusst nicht darin — sie dürfen ohnehin frei geändert werden
  // und müssen daher nichts "verbrauchen".
  const availableForeign = new Map<string, number>();
  for (const group of collectCommentGroups(store, existing)) {
    for (const comment of group) {
      if (!isRecord(comment) || comment.authorId === requesterId) continue;
      const key = fingerprint(comment);
      availableForeign.set(key, (availableForeign.get(key) ?? 0) + 1);
    }
  }

  for (const group of collectCommentGroups(store, payload)) {
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
