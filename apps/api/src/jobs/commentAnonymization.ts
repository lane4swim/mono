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
// WICHTIG — Erkennungsgrenze: CommentSchema hat bewusst KEIN authorId
// (siehe dortiger Kommentar in entities.ts — "keine serverseitige
// Autor:innen-Verifikation, genau wie bei den übrigen freien
// Textfeldern"). Ein Kommentar lässt sich der gelöschten Person daher nur
// über den zum Löschzeitpunkt gültigen `User.name` zuordnen, nicht über
// eine stabile ID — bei Namensgleichheit mit einer ANDEREN, weiterhin
// aktiven Person würden auch deren Kommentare mit anonymisiert, und ein
// zwischenzeitlich geänderter Anzeigename der gelöschten Person selbst
// bliebe unter dem alten Namen stehen. Dieselbe Einschränkung gilt bereits
// für die Anzeige (kein Abgleich gegen ein echtes Konto), diese
// Anonymisierung kann also nicht genauer sein als das Datenmodell es
// zulässt — vom Datenmodell absichtlich in Kauf genommen (siehe
// entities.ts), hier nur konsequent zu Ende gedacht.
//
// Reine, DB-freie Funktionen — von erasure.repository.ts (Prisma) UND
// erasure.repository.memory.ts (InMemory-Testdouble) gemeinsam genutzt,
// damit beide Implementierungen exakt dasselbe Anonymisierungsverhalten
// haben, statt es zweimal (potenziell abweichend) zu duplizieren.

export const ANONYMIZED_COMMENT_AUTHOR = 'Gelöschtes Konto';

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
export function anonymizeCommentArray(comments: unknown, matchAuthorName: string): AnonymizeResult<unknown> {
  if (!Array.isArray(comments)) return { changed: false, value: comments };
  let changed = false;
  const value = comments.map((entry) => {
    if (isRecord(entry) && entry.authorName === matchAuthorName) {
      changed = true;
      return { ...entry, authorName: ANONYMIZED_COMMENT_AUTHOR };
    }
    return entry;
  });
  return { changed, value };
}

// Eine einzelne SetEntry (PlainSet ODER RepeatBlock, siehe
// SetEntrySchema): ein "set" trägt sein eigenes comments-Array direkt, ein
// "block" enthält stattdessen eine verschachtelte sets-Liste (keine
// verschachtelten Blöcke laut Schema) — dort rekursiv weitersuchen.
function anonymizeSetEntry(entry: unknown, matchAuthorName: string): AnonymizeResult<unknown> {
  if (!isRecord(entry)) return { changed: false, value: entry };
  if (entry.kind === 'set') {
    const { changed, value: comments } = anonymizeCommentArray(entry.comments, matchAuthorName);
    return changed ? { changed: true, value: { ...entry, comments } } : { changed: false, value: entry };
  }
  if (entry.kind === 'block' && Array.isArray(entry.sets)) {
    const { changed, value: sets } = anonymizeSetEntries(entry.sets, matchAuthorName);
    return changed ? { changed: true, value: { ...entry, sets } } : { changed: false, value: entry };
  }
  return { changed: false, value: entry };
}

// Eine SetEntry[]-Liste — verwendet sowohl für einen einzelnen Plan-Tag
// (PlanDay.sets) als auch für Template.sets (identische Struktur).
export function anonymizeSetEntries(entries: unknown, matchAuthorName: string): AnonymizeResult<unknown> {
  if (!Array.isArray(entries)) return { changed: false, value: entries };
  let changed = false;
  const value = entries.map((entry) => {
    const result = anonymizeSetEntry(entry, matchAuthorName);
    if (result.changed) changed = true;
    return result.value;
  });
  return { changed, value };
}

function anonymizePlanDays(days: unknown, matchAuthorName: string): AnonymizeResult<unknown> {
  if (!Array.isArray(days)) return { changed: false, value: days };
  let changed = false;
  const value = days.map((day) => {
    if (!isRecord(day)) return day;
    const { changed: dayChanged, value: sets } = anonymizeSetEntries(day.sets, matchAuthorName);
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
  matchAuthorName: string,
): { changed: boolean; comments: unknown; days: unknown } {
  const comments = anonymizeCommentArray(plan.comments, matchAuthorName);
  const days = anonymizePlanDays(plan.days, matchAuthorName);
  return { changed: comments.changed || days.changed, comments: comments.value, days: days.value };
}

export function anonymizeExerciseCommentAuthors(
  exercise: { comments: unknown },
  matchAuthorName: string,
): { changed: boolean; comments: unknown } {
  const comments = anonymizeCommentArray(exercise.comments, matchAuthorName);
  return { changed: comments.changed, comments: comments.value };
}

export function anonymizeTemplateCommentAuthors(
  template: { sets: unknown },
  matchAuthorName: string,
): { changed: boolean; sets: unknown } {
  const sets = anonymizeSetEntries(template.sets, matchAuthorName);
  return { changed: sets.changed, sets: sets.value };
}
