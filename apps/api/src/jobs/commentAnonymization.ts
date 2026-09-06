// Anonymisiert `Comment.authorName` beim Art.-17-Hard-Purge. Der Klarname
// steckt eingebettet in "plans.comments", "exercises.comments" sowie
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

interface AnonymizeResult<T> {
  changed: boolean;
  value: T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
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
export function anonymizeCommentArray(comments: unknown, author: DeletedCommentAuthor): AnonymizeResult<unknown> {
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

// Eine einzelne SetEntry (PlainSet, RepeatBlock ODER Section, siehe
// SetEntrySchema): ein "set" trägt sein eigenes comments-Array direkt, ein
// "block" enthält stattdessen eine verschachtelte sets-Liste (keine
// verschachtelten Blöcke laut Schema), eine "section" analog eine
// entries-Liste (keine verschachtelten Abschnitte) — jeweils rekursiv
// weitersuchen.
function anonymizeSetEntry(entry: unknown, author: DeletedCommentAuthor): AnonymizeResult<unknown> {
  if (!isRecord(entry)) return { changed: false, value: entry };
  if (entry.kind === 'set') {
    const { changed, value: comments } = anonymizeCommentArray(entry.comments, author);
    return changed ? { changed: true, value: { ...entry, comments } } : { changed: false, value: entry };
  }
  if (entry.kind === 'block' && Array.isArray(entry.sets)) {
    const { changed, value: sets } = anonymizeSetEntries(entry.sets, author);
    return changed ? { changed: true, value: { ...entry, sets } } : { changed: false, value: entry };
  }
  if (entry.kind === 'section' && Array.isArray(entry.entries)) {
    const { changed, value: entries } = anonymizeSetEntries(entry.entries, author);
    return changed ? { changed: true, value: { ...entry, entries } } : { changed: false, value: entry };
  }
  return { changed: false, value: entry };
}

// Eine SetEntry[]-Liste — verwendet sowohl für einen einzelnen Plan-Tag
// (PlanDay.sets) als auch für Template.sets (identische Struktur).
export function anonymizeSetEntries(entries: unknown, author: DeletedCommentAuthor): AnonymizeResult<unknown> {
  if (!Array.isArray(entries)) return { changed: false, value: entries };
  let changed = false;
  const value = entries.map((entry) => {
    const result = anonymizeSetEntry(entry, author);
    if (result.changed) changed = true;
    return result.value;
  });
  return { changed, value };
}

function anonymizePlanDays(days: unknown, author: DeletedCommentAuthor): AnonymizeResult<unknown> {
  if (!Array.isArray(days)) return { changed: false, value: days };
  let changed = false;
  const value = days.map((day) => {
    if (!isRecord(day)) return day;
    const { changed: dayChanged, value: sets } = anonymizeSetEntries(day.sets, author);
    if (dayChanged) changed = true;
    return dayChanged ? { ...day, sets } : day;
  });
  return { changed, value };
}

// Anonymisiert einen Plan.comments-Wert an eventuell zwei Stellen
// (Plan-weite Kommentare + je Tag/Satz/Block verschachtelte) — der
// Aufrufer schreibt "comments"/"days" nur zurück, wenn `changed` true ist.
export function anonymizePlanCommentAuthors(
  plan: { comments: unknown; days: unknown },
  author: DeletedCommentAuthor,
): { changed: boolean; comments: unknown; days: unknown } {
  const comments = anonymizeCommentArray(plan.comments, author);
  const days = anonymizePlanDays(plan.days, author);
  return { changed: comments.changed || days.changed, comments: comments.value, days: days.value };
}

export function anonymizeExerciseCommentAuthors(
  exercise: { comments: unknown },
  author: DeletedCommentAuthor,
): { changed: boolean; comments: unknown } {
  const comments = anonymizeCommentArray(exercise.comments, author);
  return { changed: comments.changed, comments: comments.value };
}

export function anonymizeTemplateCommentAuthors(
  template: { sets: unknown },
  author: DeletedCommentAuthor,
): { changed: boolean; sets: unknown } {
  const sets = anonymizeSetEntries(template.sets, author);
  return { changed: sets.changed, sets: sets.value };
}
