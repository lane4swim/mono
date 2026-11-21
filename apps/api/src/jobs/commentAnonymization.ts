// Anonymisiert Kommentare (Store "comments", Issue #141) beim
// Art.-17-Hard-Purge: Name und Zuordnung der gelöschten Person werden
// entfernt, der Text bleibt als Teil der Diskussion erhalten.
//
// Abgeglichen wird über `authorId` (serverseitig beim Anlegen erzwungen,
// sync.comments.ts). Altbestand ohne `authorId` — vor Sicherheitsbefund M2
// angelegt und bei der Migration ohne Zuordnung übernommen — lässt sich nur
// über den Namen erkennen, samt dessen Unschärfe (Namensgleichheit,
// nachträgliche Umbenennung). Ohne diesen Rückfall verlören ausgerechnet
// die ältesten Kommentare ihre Anonymisierung.
//
// Reine, DB-freie Funktionen — von erasure.repository.ts (Prisma) und
// erasure.repository.memory.ts (InMemory-Testdouble) gemeinsam genutzt.

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

export function isCommentByAuthor(comment: { authorId: string | null; authorName: string }, author: DeletedCommentAuthor): boolean {
  if (comment.authorId === author.id) return true;
  return comment.authorId === null && typeof author.name === 'string' && author.name !== '' && comment.authorName === author.name;
}

export const ANONYMIZED_COMMENT_FIELDS = { authorId: null, authorName: ANONYMIZED_COMMENT_AUTHOR } as const;
