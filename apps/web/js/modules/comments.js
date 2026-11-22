// Gemeinsames Kommentar-Widget (Issue #141).
//
// Kommentare liegen im eigenen Sync-Store "comments" (siehe
// packages/shared-types/src/entities.ts: CommentSchema), nicht mehr
// eingebettet im kommentierten Datensatz. Ein Kommentar zeigt über
// `targetStore` + `targetId` auf sein Ziel, bei einem einzelnen Satz eines
// Plans zusätzlich über `entryId` (die Satz-id). Genutzt für:
//   - den ganzen Trainingsplan   { targetStore: 'plans', targetId }
//   - einen Satz im Plan         { targetStore: 'plans', targetId, entryId }
//   - eine Übung im Katalog      { targetStore: 'exercises', targetId }
//
// Rechte (serverseitig in apps/api/src/modules/sync/sync.comments.ts
// durchgesetzt, hier nur gespiegelt, damit keine Schaltfläche erscheint,
// deren Änderung der Server ablehnen würde):
//   - bearbeiten: nur die Autor:in, nur den Text (markiert mit editedAt)
//   - löschen: die Autor:in oder trainer/admin (Moderation)
import { el, clear } from '../dom.js';
import { fmtDateTime } from '../dates.js';
import { toast } from '../ui.js';
import { openModal } from '../modal.js';
import { getCurrentUser, isTrainerOrAdmin } from '../state.js';
import { getAll, put, remove } from '../db.js';
import { t } from '../i18n.js';

// Muss exakt ANONYMIZED_COMMENT_AUTHOR aus
// apps/api/src/jobs/commentAnonymization.ts entsprechen.
const DELETED_ACCOUNT_AUTHOR_SENTINEL = '__deleted_account__';

const sameTarget = (comment, target) =>
  comment.targetStore === target.targetStore &&
  comment.targetId === target.targetId &&
  (comment.entryId ?? null) === (target.entryId ?? null);

const byCreatedAt = (a, b) => (a.createdAt || '').localeCompare(b.createdAt || '');

// Alle lokal gehaltenen Kommentare — einmal je Seitenaufbau laden und mit
// commentsFor() je Ziel filtern, statt je Satz erneut zu lesen.
export async function loadComments() {
  return getAll('comments');
}

export function commentsFor(allComments, target) {
  return (allComments || []).filter((c) => sameTarget(c, target)).sort(byCreatedAt);
}

export function canEditComment(comment, user = getCurrentUser()) {
  return !!user?.id && comment.authorId === user.id;
}

export function canDeleteComment(comment, user = getCurrentUser()) {
  return canEditComment(comment, user) || isTrainerOrAdmin();
}

// Zeichnet die Kommentare eines Ziels samt Eingabefeld in `hostNode`.
// `initialComments` (optional) sind die bereits geladenen Kommentare dieses
// Ziels; ohne sie lädt das Widget selbst. `onChange(comments)` wird nach
// jedem Anlegen/Bearbeiten/Löschen mit der neuen Liste aufgerufen (z. B.
// um die Zahl auf einer Schaltfläche nachzuziehen).
export function renderCommentThread(hostNode, target, { initialComments, onChange } = {}) {
  let comments = initialComments ? initialComments.slice().sort(byCreatedAt) : null;
  let editingId = null;

  function changed() {
    onChange?.(comments);
    draw();
  }

  function renderComment(c) {
    const author = c.authorName === DELETED_ACCOUNT_AUTHOR_SENTINEL ? t('comments.deletedAuthor') : c.authorName;
    const meta = c.editedAt ? `${fmtDateTime(c.createdAt)} · ${t('comments.edited')}` : fmtDateTime(c.createdAt);
    const card = el('div', { class: 'card comment', style: 'padding:10px;margin-bottom:8px' }, [
      el('div', { class: 'flex justify-between items-center' }, [
        el('strong', {}, author),
        el('span', { class: 'hint' }, meta),
      ]),
    ]);
    if (editingId === c.id) {
      const textArea = el('textarea', { rows: 3, style: 'width:100%' });
      textArea.value = c.text;
      card.appendChild(el('form', { class: 'comment-edit' }, [
        textArea,
        el('div', { class: 'flex gap-8' }, [
          el('button', { type: 'submit', class: 'btn btn-primary btn-sm' }, t('common.save')),
          el('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => { editingId = null; draw(); } }, t('common.cancel')),
        ]),
      ]));
      card.querySelector('form').addEventListener('submit', (e) => { e.preventDefault(); saveEdit(c, textArea.value); });
      return card;
    }
    card.appendChild(el('p', { class: 'text-sm mt-0', style: 'white-space:pre-wrap' }, c.text));
    const actions = [
      canEditComment(c) ? el('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => { editingId = c.id; draw(); } }, t('common.edit')) : null,
      canDeleteComment(c) ? el('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => removeComment(c) }, t('common.delete')) : null,
    ].filter(Boolean);
    if (actions.length > 0) card.appendChild(el('div', { class: 'flex gap-8' }, actions));
    return card;
  }

  function draw() {
    clear(hostNode);
    if (!comments) {
      hostNode.appendChild(el('p', { class: 'hint' }, t('common.loading')));
      return;
    }

    const list = el('div', { class: 'comment-list' });
    if (comments.length === 0) list.appendChild(el('p', { class: 'hint' }, t('comments.empty')));
    else comments.forEach((c) => list.appendChild(renderComment(c)));
    hostNode.appendChild(list);

    const form = el('form', { class: 'flex gap-8', style: 'align-items:flex-start' });
    const textArea = el('textarea', { placeholder: t('comments.placeholder'), rows: 2, style: 'flex:1' });
    form.appendChild(textArea);
    form.appendChild(el('button', { type: 'submit', class: 'btn btn-primary btn-sm' }, t('comments.add')));
    form.addEventListener('submit', (e) => { e.preventDefault(); addComment(textArea.value); });
    hostNode.appendChild(form);
  }

  async function addComment(rawText) {
    const text = (rawText || '').trim();
    if (!text) { toast(t('comments.validationText'), 'error'); return; }
    const user = getCurrentUser();
    // Ein neuer Kommentar muss serverseitig der eigenen Identität
    // zugeordnet sein (sync.comments.ts). Ohne bekannte eigene id hier
    // abbrechen, statt ihn lokal anzulegen: der Sync-Push scheiterte sonst
    // dauerhaft, und der Kommentar sähe gespeichert aus, käme aber nie bei
    // den anderen an.
    if (!user?.id) { toast(t('comments.validationNoIdentity'), 'error'); return; }
    const saved = await put('comments', {
      targetStore: target.targetStore,
      targetId: target.targetId,
      entryId: target.entryId ?? null,
      authorId: user.id,
      authorName: user.name || user.email || '—',
      text,
      editedAt: null,
    });
    comments = [...comments, saved];
    toast(t('comments.added'));
    changed();
  }

  async function saveEdit(comment, rawText) {
    const text = (rawText || '').trim();
    if (!text) { toast(t('comments.validationText'), 'error'); return; }
    editingId = null;
    if (text === comment.text) { draw(); return; }
    const { deletedAt: _deletedAt, ...rest } = comment;
    const saved = await put('comments', { ...rest, text, editedAt: new Date().toISOString() });
    comments = comments.map((c) => (c.id === saved.id ? saved : c));
    toast(t('comments.updated'));
    changed();
  }

  async function removeComment(comment) {
    await remove('comments', comment.id);
    comments = comments.filter((c) => c.id !== comment.id);
    toast(t('comments.deleted'));
    changed();
  }

  draw();
  if (!comments) {
    loadComments().then((all) => { comments = commentsFor(all, target); draw(); });
  }
}

// Kleine "💬 N"-Schaltfläche, die die Kommentare eines Ziels in einem
// Dialog öffnet — wo eine Inline-Liste zu schwer wäre (z. B. eine
// Schaltfläche je Satz in der Plantabelle). Die Beschriftung zieht nach
// jedem Anlegen/Löschen im Dialog nach, ohne auf ein Neuzeichnen der
// Seite zu warten.
export function commentsButton(target, { title, initialComments = [] }) {
  let comments = initialComments;
  const btn = el('button', { type: 'button', class: 'btn btn-ghost btn-sm', title: t('comments.title') });

  function updateLabel() {
    btn.textContent = comments.length > 0 ? t('comments.countButton', { count: comments.length }) : t('comments.countButtonEmpty');
  }
  updateLabel();

  btn.addEventListener('click', () => {
    const body = el('div');
    openModal({ title, bodyNode: body });
    renderCommentThread(body, target, {
      initialComments: comments,
      onChange: (next) => { comments = next; updateLabel(); },
    });
  });
  return btn;
}
