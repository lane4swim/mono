// @vitest-environment jsdom
// Kommentar-Widget auf dem eigenen Store "comments" (Issue #141): anlegen
// mit Ziel, eigene Kommentare bearbeiten, löschen durch Autor:in oder
// moderierend durch trainer (nicht admin, Issue #142).
import { describe, it, expect, vi, beforeEach } from 'vitest';

const session = vi.hoisted(() => ({ user: null, roles: [] }));
const store = vi.hoisted(() => ({ rows: [] }));
vi.mock('../js/state.js', () => ({
  getCurrentUser: () => session.user,
  hasRole: (role) => session.roles.includes(role),
}));
vi.mock('../js/db.js', () => ({
  getAll: vi.fn(async () => store.rows),
  put: vi.fn(async (_name, obj) => ({ id: obj.id || `new-${store.rows.length + 1}`, createdAt: '2026-11-22T10:00:00.000Z', ...obj })),
  remove: vi.fn(async () => true),
}));
vi.mock('../js/ui.js', () => ({ toast: vi.fn() }));

const db = await import('../js/db.js');
const { renderCommentThread, commentsFor, canEditComment, canDeleteComment } = await import('../js/modules/comments.js');
const { t } = await import('../js/i18n.js');

const PLAN = { targetStore: 'plans', targetId: 'p1' };
const comment = (overrides = {}) => ({
  id: 'c1', targetStore: 'plans', targetId: 'p1', entryId: null, authorId: 'u-ath', authorName: 'Mara',
  text: 'Zu kurz', editedAt: null, createdAt: '2026-11-20T10:00:00.000Z', updatedAt: '2026-11-20T10:00:00.000Z', ...overrides,
});
const buttons = (host) => [...host.querySelectorAll('button')].map((b) => b.textContent);
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  session.user = { id: 'u-ath', name: 'Mara' };
  session.roles = ['athlete'];
  store.rows = [];
  vi.mocked(db.put).mockClear();
  vi.mocked(db.remove).mockClear();
});

describe('commentsFor()', () => {
  it('trennt Plan- und Satzkommentare über entryId und sortiert nach createdAt', () => {
    const all = [
      comment({ id: 'b', createdAt: '2026-11-21T00:00:00.000Z' }),
      comment({ id: 'a', createdAt: '2026-11-20T00:00:00.000Z' }),
      comment({ id: 's', entryId: 'set-1' }),
      comment({ id: 'x', targetId: 'p2' }),
    ];
    expect(commentsFor(all, PLAN).map((c) => c.id)).toEqual(['a', 'b']);
    expect(commentsFor(all, { ...PLAN, entryId: 'set-1' }).map((c) => c.id)).toEqual(['s']);
  });
});

describe('Rechte', () => {
  it('bearbeiten nur die Autor:in, löschen zusätzlich trainer — admin moderiert nicht', () => {
    expect(canEditComment(comment())).toBe(true);
    expect(canDeleteComment(comment())).toBe(true);
    const foreign = comment({ authorId: 'u-other' });
    expect(canEditComment(foreign)).toBe(false);
    expect(canDeleteComment(foreign)).toBe(false);
    session.roles = ['admin'];
    expect(canDeleteComment(foreign)).toBe(false);
    session.roles = ['trainer'];
    expect(canEditComment(foreign)).toBe(false);
    expect(canDeleteComment(foreign)).toBe(true);
  });
});

describe('renderCommentThread()', () => {
  it('zeigt Bearbeiten/Löschen nur für eigene Kommentare, Moderation sieht Löschen bei fremden', () => {
    const host = document.createElement('div');
    renderCommentThread(host, PLAN, { initialComments: [comment({ authorId: 'u-other' })] });
    expect(buttons(host)).not.toContain(t('common.edit'));
    expect(buttons(host)).not.toContain(t('common.delete'));

    session.roles = ['trainer'];
    renderCommentThread(host, PLAN, { initialComments: [comment({ authorId: 'u-other' })] });
    expect(buttons(host)).toContain(t('common.delete'));
    expect(buttons(host)).not.toContain(t('common.edit'));
  });

  it('legt einen Kommentar mit Ziel, entryId und eigener Identität an', async () => {
    const host = document.createElement('div');
    const onChange = vi.fn();
    renderCommentThread(host, { ...PLAN, entryId: 'set-1' }, { initialComments: [], onChange });
    host.querySelector('textarea').value = '  Gute Serie  ';
    host.querySelector('form').dispatchEvent(new Event('submit'));
    await flush();
    expect(db.put).toHaveBeenCalledWith('comments', {
      targetStore: 'plans', targetId: 'p1', entryId: 'set-1', authorId: 'u-ath', authorName: 'Mara', text: 'Gute Serie', editedAt: null,
    });
    expect(onChange).toHaveBeenCalledWith([expect.objectContaining({ text: 'Gute Serie' })]);
    expect(host.textContent).toContain('Gute Serie');
  });

  it('bearbeitet den eigenen Kommentar und markiert ihn als bearbeitet', async () => {
    const host = document.createElement('div');
    renderCommentThread(host, PLAN, { initialComments: [comment()] });
    [...host.querySelectorAll('button')].find((b) => b.textContent === t('common.edit')).click();
    host.querySelector('.comment-edit textarea').value = 'Doch passend';
    host.querySelector('.comment-edit').dispatchEvent(new Event('submit'));
    await flush();
    const [, saved] = vi.mocked(db.put).mock.calls[0];
    expect(saved).toMatchObject({ id: 'c1', text: 'Doch passend', authorId: 'u-ath', targetId: 'p1' });
    expect(saved.editedAt).toEqual(expect.any(String));
    expect(host.textContent).toContain('Doch passend');
    expect(host.textContent).toContain(t('comments.edited'));
  });

  it('löscht moderierend einen fremden Kommentar', async () => {
    session.roles = ['trainer'];
    const host = document.createElement('div');
    renderCommentThread(host, PLAN, { initialComments: [comment({ authorId: 'u-other' })] });
    [...host.querySelectorAll('button')].find((b) => b.textContent === t('common.delete')).click();
    await flush();
    expect(db.remove).toHaveBeenCalledWith('comments', 'c1');
    expect(host.textContent).toContain(t('comments.empty'));
  });

  it('lädt ohne initialComments selbst aus dem Store', async () => {
    store.rows = [comment(), comment({ id: 'c2', targetId: 'p2', text: 'Anderer Plan' })];
    const host = document.createElement('div');
    renderCommentThread(host, PLAN);
    await flush();
    expect(host.textContent).toContain('Zu kurz');
    expect(host.textContent).not.toContain('Anderer Plan');
  });
});
