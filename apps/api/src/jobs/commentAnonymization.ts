// Anonymisiert `Comment.authorName` beim Art.-17-Hard-Purge. Der Klarname
// steckt eingebettet in "plans.comments", "exercises.comments",
// "results.comments" sowie
// verschachtelt in "plans.days[].sets[].comments" und
// "templates.sets[].comments" — dieselbe SetEntry-Struktur trägt Plan.days
// wie Template.sets. Ohne diesen Schritt überlebten die Namen samt
// Kommentartext einen vollständigen Purge.
//
// Abgeglichen wird primär gegen `authorId`: anders als der frei wählbare
// `authorName` ist die User-ID serverseitig durchgesetzt (siehe
// sync.commentAuthorship.ts) und damit ein exakter, nicht fälschbarer
// Abgleichswert.
//
// Für den ALTBESTAND — Kommentare ohne `authorId`, eingebettetes JSONB und
// daher nicht per Spalten-Migration nachrüstbar — bleibt der Namensabgleich
// als Rückfall bestehen, samt seiner Unschärfe (Namensgleichheit,
// nachträgliche Umbenennung, ein absichtlich abweichender Name entzieht den
// eigenen Kommentar der Anonymisierung). Ohne ihn verlören ausgerechnet die
// ältesten Kommentare ihre Anonymisierung. Siehe anonymizeCommentArray().
//
// Reine, DB-freie Funktionen — von erasure.repository.ts (Prisma) UND
// erasure.repository.memory.ts (InMemory-Testdouble) gemeinsam genutzt,
// damit beide Implementierungen exakt dasselbe Verhalten zeigen.
import { isRecord, mapPlainSets, type MapResult } from '../modules/shared/setEntries.js';
import { mapCommentArrays, type CommentBearingStore } from '../modules/shared/commentLocations.js';

// Ein sprachneutraler, technischer Marker statt eines Anzeigetexts: ein fest
// in die DB geschriebener Name wäre unabhängig von der Locale der
// betrachtenden Person. Das Frontend (apps/web/js/modules/comments.js)
// erkennt den Marker und übersetzt ihn zur Anzeigezeit über
// t('comments.deletedAuthor') — wie jeden anderen UI-String.
export const ANONYMIZED_COMMENT_AUTHOR = '__deleted_account__';

// Die zu anonymisierende Person. `id` ist der exakte Abgleichswert; `name`
// dient ausschließlich dem Altbestand ohne `authorId` (siehe oben).
export interface DeletedCommentAuthor {
  id: string;
  name: string | null;
}

// Ein einzelnes Comment-Array (CommentSchema[]) — die flache Basisebene,
// auf der "plans.comments", "exercises.comments" und die "comments" eines
// einzelnen Sets/Blocks jeweils aufsetzen.
//
// Entfernt bei einem Treffer `authorId` VOLLSTÄNDIG, statt nur
// `authorName` zu überschreiben. Bliebe die ID stehen, überlebte der
// Art.-17-Hard-Purge einen stabilen, personenbezogenen Schlüssel, über den
// sich sämtliche Kommentare derselben gelöschten Person nachträglich
// wieder zu einer Person zusammenfassen ließen (Verkettbarkeit) — vor
// Einführung von `authorId` war das nicht möglich, das Feld darf diese
// Möglichkeit also nicht neu schaffen.
//
// Altbestand: ältere Kommentare tragen gar kein `authorId` (JSONB, keine
// Spalten-Migration möglich — siehe CommentSchema in
// packages/shared-types/src/entities.ts). Für sie gilt weiterhin der
// Namensabgleich samt seiner Unschärfe (Namensgleichheit/-änderung). Ohne
// diesen
// Rückfall verlören ausgerechnet die ältesten Kommentare ihre
// Anonymisierung — eine Verschlechterung gegenüber dem Stand vor M2. Für
// alles seit M2 Geschriebene greift ausschließlich der exakte
// `authorId`-Abgleich, für den diese Unschärfe nicht mehr gilt.
export function anonymizeCommentArray(comments: unknown, author: DeletedCommentAuthor): MapResult {
  if (!Array.isArray(comments)) return { changed: false, value: comments };
  let changed = false;
  const value = comments.map((entry) => {
    if (!isRecord(entry)) return entry;
    const isLegacyEntry = entry.authorId === undefined || entry.authorId === null;
    const matches =
      entry.authorId === author.id ||
      (isLegacyEntry && typeof author.name === 'string' && entry.authorName === author.name);
    if (!matches) return entry;
    changed = true;
    const { authorId: _authorId, ...rest } = entry;
    return { ...rest, authorName: ANONYMIZED_COMMENT_AUTHOR };
  });
  return { changed, value };
}

// Eine SetEntry[]-Liste (Template.sets, SectionTemplate.entries oder ein
// Plan-Tag) — anonymisiert die Kommentare jedes einzelnen Satzes, auch in
// Blöcken und Abschnitten (Durchlauf siehe modules/shared/setEntries.ts).
export function anonymizeSetEntries(entries: unknown, author: DeletedCommentAuthor): MapResult {
  return mapPlainSets(entries, (set) => {
    const { changed, value } = anonymizeCommentArray(set.comments, author);
    return changed ? { ...set, comments: value } : null;
  });
}

// Anonymisiert alle Kommentar-Felder eines Datensatzes des Stores `store`
// (welche das sind, legt modules/shared/commentLocations.ts fest). Der
// Aufrufer schreibt `fields` nur zurück, wenn `changed` gesetzt ist.
export function anonymizeCommentAuthors(
  store: CommentBearingStore,
  record: Record<string, unknown>,
  author: DeletedCommentAuthor,
): { changed: boolean; fields: Record<string, unknown> } {
  return mapCommentArrays(store, record, (comments) => anonymizeCommentArray(comments, author));
}

export function anonymizePlanCommentAuthors(
  plan: { comments: unknown; days: unknown },
  author: DeletedCommentAuthor,
): { changed: boolean; comments: unknown; days: unknown } {
  const { changed, fields } = anonymizeCommentAuthors('plans', plan, author);
  return { changed, comments: fields.comments, days: fields.days };
}

export function anonymizeExerciseCommentAuthors(
  exercise: { comments: unknown },
  author: DeletedCommentAuthor,
): { changed: boolean; comments: unknown } {
  const { changed, fields } = anonymizeCommentAuthors('exercises', exercise, author);
  return { changed, comments: fields.comments };
}

export function anonymizeResultCommentAuthors(
  result: { comments: unknown },
  author: DeletedCommentAuthor,
): { changed: boolean; comments: unknown } {
  const { changed, fields } = anonymizeCommentAuthors('results', result, author);
  return { changed, comments: fields.comments };
}

export function anonymizeTemplateCommentAuthors(
  template: { sets: unknown },
  author: DeletedCommentAuthor,
): { changed: boolean; sets: unknown } {
  const { changed, fields } = anonymizeCommentAuthors('templates', template, author);
  return { changed, sets: fields.sets };
}

export function anonymizeSectionTemplateCommentAuthors(
  sectionTemplate: { entries: unknown },
  author: DeletedCommentAuthor,
): { changed: boolean; entries: unknown } {
  const { changed, fields } = anonymizeCommentAuthors('sectionTemplates', sectionTemplate, author);
  return { changed, entries: fields.entries };
}
