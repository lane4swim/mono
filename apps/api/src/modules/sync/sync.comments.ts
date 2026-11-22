// Schreibregeln für den Sync-Store "comments" (Issue #141).
//
// Kommentare sind ein eigener Store, damit die Rechte am Kommentar hängen
// und nicht am kommentierten Datensatz:
//
//   * Anlegen darf jede synchronisierende Rolle, die das Ziel lesen darf —
//     immer im eigenen Namen (authorId === requester.userId).
//   * Ändern darf nur die Autor:in selbst, und nur den Text (samt
//     editedAt) und den angezeigten Namen. Ziel und Zuordnung bleiben fest.
//   * Löschen darf die Autor:in oder eine Trainer:in (Moderation, Issue
//     #142: admin ist Vereinsverwaltung und moderiert nicht).
//     Altbestand ohne authorId (und anonymisierte Kommentare) lässt sich
//     daher nur noch moderierend löschen.
//
// Dass das Ziel im eigenen Verein existiert, prüft sync.foreignKeys.ts
// (polymorphe Referenz targetStore/targetId).
import type { EntityStoreName, Role } from '@lane1/shared-types';
import { canRead } from './sync.permissions.js';

export const COMMENT_NOT_PERMITTED_CODE = 'comment_not_permitted';

const MODERATOR_ROLES: readonly Role[] = ['trainer'];

export function canModerateComments(roles: readonly Role[]): boolean {
  return roles.some((role) => MODERATOR_ROLES.includes(role));
}

interface CommentRequester {
  userId: string;
  roles: readonly Role[];
  enabledModules: readonly string[];
}

interface StoredComment {
  authorId?: unknown;
  targetStore?: unknown;
  targetId?: unknown;
  entryId?: unknown;
  createdAt?: unknown;
  deletedAt?: unknown;
}

// Felder, die nach dem Anlegen unveränderlich sind.
const FIXED_FIELDS = ['authorId', 'targetStore', 'targetId', 'entryId'] as const;

// Prüft ein create/update/delete auf "comments". `payload` ist der bereits
// validierte Payload (null bei delete), `existing` die gespeicherte Zeile
// (null, falls es sie noch nicht gibt). Gibt eine Fehlermeldung zurück
// oder null.
export function assertCommentWrite(
  action: 'create' | 'update' | 'delete',
  payload: Record<string, unknown> | null,
  existing: StoredComment | null,
  requester: CommentRequester,
): string | null {
  if (action === 'delete') {
    // Nichts zu löschen — die Löschung ist ohnehin wirkungslos.
    if (!existing) return null;
    if (existing.authorId === requester.userId || canModerateComments(requester.roles)) return null;
    return 'Kommentare anderer Personen können nur Trainer:innen löschen.';
  }

  const targetStore = payload?.targetStore as EntityStoreName;
  if (!canRead(targetStore, requester.roles, requester.enabledModules)) {
    return `Kommentare an "${targetStore}" sind für diese Rolle oder ohne das zugehörige Paket nicht möglich.`;
  }

  if (!existing) {
    if (payload?.authorId !== requester.userId) {
      return 'Neue Kommentare müssen der eigenen Identität zugeordnet sein (authorId).';
    }
    if (payload?.editedAt !== null) {
      return 'Ein neuer Kommentar kann nicht als bearbeitet markiert sein.';
    }
    return null;
  }

  if (existing.deletedAt) return 'Ein gelöschter Kommentar kann nicht mehr bearbeitet werden.';
  if (existing.authorId !== requester.userId) {
    return 'Nur die Autor:in kann einen Kommentar bearbeiten.';
  }
  for (const field of FIXED_FIELDS) {
    if ((payload?.[field] ?? null) !== (existing[field] ?? null)) {
      return `Das Feld "${field}" eines Kommentars kann nicht geändert werden.`;
    }
  }
  return null;
}

// Beim Pull: ein Kommentar ist nur sichtbar, wenn die anfragende Rolle das
// kommentierte Ziel lesen darf (Rolle und gebuchtes Paket). Der Store
// "comments" selbst hängt an keinem Paket (sync.permissions.ts:
// CORE_STORES), die Sichtbarkeit folgt dem Ziel.
export function isCommentReadable(payload: Record<string, unknown> | null, roles: readonly Role[], enabledModules: readonly string[]): boolean {
  const targetStore = payload?.targetStore;
  return typeof targetStore === 'string' && canRead(targetStore as EntityStoreName, roles, enabledModules);
}

// Vor Issue #141 lagen Kommentare als "comments"-Arrays in diesen Stores
// (flach und in jedem Satz). Ein noch nicht aktualisierter Client, oder
// ein Sync-Event, das vor dem Update in der Warteschlange lag, schickt sie
// weiterhin mit. Die Schemas kennen das Feld nicht mehr (.strict()); damit
// die eigentliche Änderung nicht abgelehnt wird, wird es vor der
// Validierung entfernt. Die mitgeschickten Kommentare selbst gehen dabei
// verloren — der Store "comments" ist ab jetzt die einzige Quelle.
const LEGACY_COMMENT_STORES: ReadonlySet<EntityStoreName> = new Set(['plans', 'exercises', 'templates', 'sectionTemplates', 'results']);

function withoutCommentKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutCommentKeys);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value)) {
      if (key !== 'comments') out[key] = withoutCommentKeys(inner);
    }
    return out;
  }
  return value;
}

export function stripLegacyEmbeddedComments(store: EntityStoreName, payload: unknown): unknown {
  return LEGACY_COMMENT_STORES.has(store) ? withoutCommentKeys(payload) : payload;
}
