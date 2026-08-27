// apps/api/src/jobs/commentAnonymization.ts
//
// Sicherheitsreview 2026-08, Befund N5: purgeUserAndDependents()
// (erasure.repository.ts) löschte bislang Nutzer, Athletenprofil,
// Ergebnisse, Startlisteneinträge, Handlungsfelder und die
// Anwesenheitszeilen der gelöschten Person — nicht erfasst wurde
// `Comment.authorName` (siehe CommentSchema in
// packages/shared-types/src/entities.ts), der Klarname, der in
// "plans.comments", "exercises.comments" sowie verschachtelt in
// "plans.days[].sets[].comments" UND "templates.sets[].comments"
// eingebettet ist (dieselbe SetEntry-Struktur — Sätze/Blöcke, siehe
// SetEntrySchema — wird sowohl von Plan.days als auch von Template.sets
// verwendet; Templates waren im ursprünglichen Befund nicht ausdrücklich
// genannt, tragen aber dieselbe Struktur und damit dieselbe Lücke).
// Nach einem vollständigen Art.-17-Purge blieben diese Namen samt
// Kommentartext dauerhaft in der Datenbank.
//
// Sicherheitsreview 2026-08-27, Befund M2: gleicht primär gegen
// `authorId` statt gegen `authorName` ab. CommentSchema trägt jetzt ein
// `authorId` (die tatsächliche, stabile User-ID) — anders als der frei
// wählbare `authorName` serverseitig durchgesetzt (siehe
// sync.commentAuthorship.ts: ein neuer Kommentar muss `authorId ===
// request.user.sub` tragen, ein bestehender lässt sich nur unverändert
// weiterreichen). Für alles seit M2 Geschriebene entfällt die vormals
// hier dokumentierte Erkennungsgrenze (Namensgleichheit mit einer anderen
// Person, nachträgliche Namensänderung, ein absichtlich abweichender Name
// entzieht den eigenen Kommentar der Anonymisierung) damit vollständig —
// `authorId` ist ein exakter, eindeutiger und nicht fälschbarer
// Abgleichswert.
//
// Für den ALTBESTAND (Kommentare ohne `authorId`, geschrieben vor M2 —
// eingebettetes JSONB, daher nicht per Spalten-Migration nachrüstbar)
// bleibt der ursprüngliche Namensabgleich samt seiner Unschärfe als
// Rückfall bestehen; ohne ihn verlören ausgerechnet die ältesten
// Kommentare ihre Anonymisierung. Siehe anonymizeCommentArray() unten.
//
// Reine, DB-freie Funktionen — von erasure.repository.ts (Prisma) UND
// erasure.repository.memory.ts (InMemory-Testdouble) gemeinsam genutzt,
// damit beide Implementierungen exakt dasselbe Anonymisierungsverhalten
// haben, statt es zweimal (potenziell abweichend) zu duplizieren.

export const ANONYMIZED_COMMENT_AUTHOR = 'Gelöschtes Konto';

// Die zu anonymisierende Person. `id` ist der exakte Abgleichswert für
// alle seit Befund M2 geschriebenen Kommentare; `name` ausschließlich für
// den Altbestand (Kommentare ohne `authorId`, siehe unten).
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
// Altbestand: Kommentare, die vor Befund M2 geschrieben wurden, tragen
// gar kein `authorId` (JSONB, keine Spalten-Migration möglich — siehe
// CommentSchema in packages/shared-types/src/entities.ts). Für sie gilt
// weiterhin der Namensabgleich des ursprünglichen N5-Fixes, samt dessen
// dokumentierter Unschärfe (Namensgleichheit/-änderung). Ohne diesen
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

// Eine einzelne SetEntry (PlainSet ODER RepeatBlock, siehe
// SetEntrySchema): ein "set" trägt sein eigenes comments-Array direkt, ein
// "block" enthält stattdessen eine verschachtelte sets-Liste (keine
// verschachtelten Blöcke laut Schema) — dort rekursiv weitersuchen.
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
