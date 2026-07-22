// ============================================================
// modules/comments.js — shared "Kommentare" thread widget.
//
// Used at three places (see backend packages/shared-types/src/entities.ts,
// CommentSchema): on a whole Trainingsplan (Plan.comments), on an
// individual Satz/Übung within a plan (PlainSet.comments — same widget
// works inside a repeat block, since blocks' inner sets are PlainSet
// too), and in the Übungskatalog (Exercise.comments).
//
// This module owns rendering + the add/delete interaction, but NOT
// persistence — the caller passes a `persist(nextComments)` function
// that knows how to save the updated array back into the surrounding
// entity (a whole Plan/Exercise/Template record, since comments live
// embedded in that record's JSON, not as their own sync store) and
// awaits it before the thread re-draws. This keeps the widget reusable
// across very different "where does this array actually live" contexts
// without needing to know about plans/exercises/db.js itself.
// ============================================================
import { el, clear, uid, toast, openModal, fmtDateTime } from '../utils.js';
import { getCurrentUser } from '../state.js';
import { t } from '../i18n.js';

// Renders an existing list of comments plus an add-comment form into
// `hostNode`. `persist(nextComments)` is called (and awaited) after
// every add/delete with the FULL new array — the caller is responsible
// for writing it back to IndexedDB (e.g. `put('plans', { ...plan,
// comments: nextComments })`) and for triggering any outer-page refresh
// it might need (this widget only redraws itself, not the host page).
export function renderCommentThread(hostNode, initialComments, persist) {
  let comments = (initialComments || []).slice();

  function draw() {
    clear(hostNode);

    const list = el('div', { class: 'comment-list' });
    if (comments.length === 0) {
      list.appendChild(el('p', { class: 'hint' }, t('comments.empty')));
    } else {
      comments
        .slice()
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .forEach((c) => {
          list.appendChild(el('div', { class: 'card', style: 'padding:10px;margin-bottom:8px' }, [
            el('div', { class: 'flex justify-between items-center' }, [
              el('strong', {}, c.authorName),
              el('span', { class: 'hint' }, fmtDateTime(c.createdAt)),
            ]),
            el('p', { class: 'text-sm mt-0', style: 'white-space:pre-wrap' }, c.text),
            el('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => removeComment(c.id) }, t('common.delete')),
          ]));
        });
    }
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
    const next = [...comments, {
      id: uid('comment'),
      authorName: user?.name || user?.email || '—',
      text,
      createdAt: new Date().toISOString(),
    }];
    comments = next;
    await persist(comments);
    toast(t('comments.added'));
    draw();
  }

  async function removeComment(commentId) {
    comments = comments.filter((c) => c.id !== commentId);
    await persist(comments);
    toast(t('comments.deleted'));
    draw();
  }

  draw();
}

// Convenience: a small "💬 N" button that opens a modal containing the
// comment thread for `comments`. Used wherever showing the thread inline
// would be too heavy (e.g. one button per set-row in a plan's table).
export function commentsButton(comments, { title, persist }) {
  const count = (comments || []).length;
  return el('button', {
    type: 'button',
    class: 'btn btn-ghost btn-sm',
    title: t('comments.title'),
    onclick: () => {
      const body = el('div');
      openModal({ title, bodyNode: body });
      renderCommentThread(body, comments, persist);
    },
  }, count > 0 ? t('comments.countButton', { count }) : t('comments.countButtonEmpty'));
}
