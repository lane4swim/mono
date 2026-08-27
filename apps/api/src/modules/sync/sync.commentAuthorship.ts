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
// Kommentar-Arrays (exercises, plans, templates), dass
//   - ein NEU hinzugefügter Kommentar (dessen id im bisherigen Datensatz
//     noch nicht vorkam) `authorId === requesterId` trägt, und
//   - ein BESTEHENDER Kommentar (id bereits vorhanden) seine ursprüngliche
//     `authorId`-Zuordnung unverändert behält — unabhängig davon, wer den
//     umgebenden Datensatz (Plan/Übung/Vorlage) gerade bearbeitet.
// Der zweite Punkt ist bewusst kein reiner Spezialfall des ersten:
// "plans" steht in STORE_PERMISSIONS als "shared" (alle drei Rollen
// dürfen den gesamten Datensatz schreiben) — ohne diese zweite Regel
// könnte jedes Vereinsmitglied beim Bearbeiten eines Plans die
// Autor:innen-Zuordnung eines FREMDEN, bereits bestehenden Kommentars
// nachträglich umschreiben, ohne selbst einen neuen Kommentar
// anzulegen.
import type { EntityStoreName } from '@lane1/shared-types';

interface CommentLike {
  id?: unknown;
  authorId?: unknown;
}

// Die drei Stores, deren Entity-Schema irgendwo ein CommentSchema[]
// einbettet (siehe entities.ts: ExerciseSchema.comments,
// PlanSchema.comments, PlainSetSchema.comments — Letzteres sowohl über
// Plan.days[].sets als auch über Template.sets erreichbar).
export const COMMENT_BEARING_STORES: ReadonlySet<EntityStoreName> = new Set(['exercises', 'plans', 'templates']);

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
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as { kind?: unknown; comments?: unknown; sets?: unknown };
    if (e.kind === 'set') {
      groups.push(Array.isArray(e.comments) ? e.comments : []);
    } else if (e.kind === 'block') {
      groups.push(...collectSetEntryCommentGroups(e.sets));
    }
  }
  return groups;
}

// Alle comments-Arrays eines validierten Payloads für einen der drei
// betroffenen Stores — jeweils EIN Array je Fundstelle (Plan-weite
// Kommentare, je Satz/Block verschachtelte, Übungs-/Vorlagen-Kommentare).
function collectCommentGroups(store: EntityStoreName, payload: Record<string, unknown>): unknown[][] {
  if (store === 'exercises') {
    return [Array.isArray(payload.comments) ? payload.comments : []];
  }
  if (store === 'templates') {
    return collectSetEntryCommentGroups(payload.sets);
  }
  // store === 'plans'
  const groups: unknown[][] = [Array.isArray(payload.comments) ? payload.comments : []];
  for (const day of Array.isArray(payload.days) ? payload.days : []) {
    if (day && typeof day === 'object') groups.push(...collectSetEntryCommentGroups((day as { sets?: unknown }).sets));
  }
  return groups;
}

// Baut eine id -> authorId-Zuordnung aus allen Kommentaren eines bereits
// bestehenden Datensatzes (nicht Zod-validiert — der Gateway liefert den
// rohen, zuletzt gespeicherten Stand, siehe SyncGateway.findById()).
function collectExistingAuthorIds(store: EntityStoreName, existing: Record<string, unknown> | null): Map<string, unknown> {
  const byId = new Map<string, unknown>();
  if (!existing) return byId;
  for (const group of collectCommentGroups(store, existing)) {
    for (const comment of group as CommentLike[]) {
      if (comment && typeof comment.id === 'string') byId.set(comment.id, comment.authorId);
    }
  }
  return byId;
}

// Prüft einen bereits Zod-validierten create/update-Payload für einen der
// drei betroffenen Stores. Gibt bei einem Verstoß eine Fehlermeldung
// zurück, sonst `null` — Stores ohne eingebettete Kommentare (alle
// übrigen sieben) sind immer `null` (No-op).
export function assertCommentAuthorship(
  store: EntityStoreName,
  payload: Record<string, unknown>,
  existing: Record<string, unknown> | null,
  requesterId: string,
): string | null {
  if (!COMMENT_BEARING_STORES.has(store)) return null;

  const existingAuthorById = collectExistingAuthorIds(store, existing);

  for (const group of collectCommentGroups(store, payload)) {
    for (const comment of group as CommentLike[]) {
      if (!comment || typeof comment.id !== 'string') continue;
      const priorAuthorId = existingAuthorById.get(comment.id);
      if (priorAuthorId === undefined) {
        // Neuer Kommentar (id kam im bisherigen Datensatz nicht vor) —
        // muss der eigenen Identität zugeordnet sein.
        if (comment.authorId !== requesterId) {
          return 'Neue Kommentare müssen der eigenen Identität zugeordnet sein (authorId).';
        }
      } else if (comment.authorId !== priorAuthorId) {
        // Bestehender Kommentar — die Autor:innen-Zuordnung ist nach dem
        // Anlegen unveränderlich, unabhängig davon, wer den umgebenden
        // Datensatz gerade bearbeitet.
        return 'Die Autor:innen-Zuordnung eines bestehenden Kommentars kann nicht geändert werden.';
      }
    }
  }
  return null;
}
