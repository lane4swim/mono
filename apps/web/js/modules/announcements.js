// Vereinsinterne Nachrichten/Ankündigungen (Phase 2, Abschnitt 4.1 —
// docs/Plans/phase2-plan.md). Getrennt von den themengebundenen
// Kommentar-Threads an Übungen/Plänen/Ergebnissen — ein Announcement
// hängt an keiner anderen Entität, nur optional an einer Gruppe.
import { getAll, put, remove } from '../db.js';
import { el, clear, beginRender } from '../dom.js';
import { fmtDateTime } from '../dates.js';
import { badge, emptyState, laneWave, toast } from '../ui.js';
import { openModal, confirmAction } from '../modal.js';
import { field, textInput, selectInput, formActions } from '../forms.js';
import { isTrainerOrAdmin, getCurrentUser } from '../state.js';
import { t } from '../i18n.js';

export const announcementsModule = {
  id: 'announcements',
  roles: ['trainer', 'admin', 'athlete'],
  icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 10v4a2 2 0 0 0 2 2h1l3 4V4l-3 4H6a2 2 0 0 0-2 2Z"/><path d="M15 8.5a4 4 0 0 1 0 7" opacity=".7"/><path d="M18 6a7.5 7.5 0 0 1 0 12" opacity=".4"/></svg>`,
  async render(container) {
    const isCurrent = beginRender(container);
    clear(container);
    const [announcements, groups] = await Promise.all([getAll('announcements'), getAll('groups')]);
    if (!isCurrent()) return;
    renderList(container, announcements, groups);
  },
};

function groupName(groups, groupId) {
  if (!groupId) return null;
  return groups.find((g) => g.id === groupId)?.name || null;
}

function renderList(container, announcements, groups) {
  const wrap = el('div');
  const canManage = isTrainerOrAdmin();
  wrap.appendChild(el('div', { class: 'page-head' }, [
    el('div', {}, [el('div', { class: 'page-eyebrow' }, t('announcements.eyebrow', { count: announcements.length })), el('h1', { class: 'mt-0' }, t('announcements.title'))]),
    canManage ? el('div', { class: 'page-actions' }, [el('button', { class: 'btn btn-primary', onclick: () => openAnnouncementModal(null, groups, refresh) }, t('announcements.addAnnouncement'))]) : null,
  ].filter(Boolean)));
  wrap.appendChild(laneWave());
  wrap.appendChild(el('p', {}, t('announcements.intro')));

  const host = el('div');
  wrap.appendChild(host);
  container.appendChild(wrap);

  function draw() {
    clear(host);
    if (announcements.length === 0) {
      host.appendChild(emptyState(t('common.nothingHereTitle'), t('announcements.noneYet'), null));
      return;
    }
    const sorted = [...announcements].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    sorted.forEach((a) => {
      const scope = groupName(groups, a.groupId);
      host.appendChild(el('div', { class: 'card mb-16' }, [
        el('div', { class: 'flex justify-between items-start gap-8', style: 'flex-wrap:wrap' }, [
          el('div', {}, [
            el('h3', { class: 'mt-0' }, a.title),
            el('div', { class: 'pill-group mb-8' }, [badge(scope || t('announcements.wholeClub'), 'neutral')]),
          ]),
          canManage ? el('div', { class: 'flex gap-8' }, [
            el('button', { class: 'btn btn-ghost btn-sm', onclick: () => openAnnouncementModal(a, groups, refresh) }, t('common.edit')),
            el('button', { class: 'btn btn-danger btn-sm', onclick: () => confirmAction(t('announcements.deleteConfirm'), async () => {
              await remove('announcements', a.id);
              toast(t('announcements.deleted'));
              refresh();
            }) }, t('common.delete')),
          ]) : null,
        ].filter(Boolean)),
        el('p', { style: 'white-space:pre-wrap' }, a.body),
        el('p', { class: 'text-sm text-slate' }, fmtDateTime(a.createdAt)),
      ]));
    });
  }
  draw();

  async function refresh() {
    const [a2, g2] = await Promise.all([getAll('announcements'), getAll('groups')]);
    clear(container);
    renderList(container, a2, g2);
  }
}

export function openAnnouncementModal(announcement, groups, onSaved) {
  const isEdit = !!announcement;
  const currentUser = getCurrentUser();
  const data = announcement
    ? { ...announcement }
    : { clubId: currentUser?.clubId, groupId: null, authorId: currentUser?.id || null, title: '', body: '' };

  const form = el('form', { class: 'form-grid' });
  const fTitle = textInput(data.title, { required: true });
  const fGroup = selectInput(
    [{ value: '', label: t('announcements.wholeClub') }, ...groups.map((g) => ({ value: g.id, label: g.name }))],
    data.groupId || '',
  );
  const fBody = el('textarea', { required: true }, data.body || '');
  form.appendChild(field(t('announcements.formTitle'), fTitle, { span2: true }));
  form.appendChild(field(t('announcements.formScope'), fGroup, { span2: true }));
  form.appendChild(field(t('announcements.formBody'), fBody, { span2: true }));
  form.appendChild(formActions({ onCancel: () => close(), submitLabel: isEdit ? t('common.save') : t('common.create') }).row);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = fTitle.value.trim();
    const body = fBody.value.trim();
    if (!title) { toast(t('announcements.validationTitle'), 'error'); return; }
    if (!body) { toast(t('announcements.validationBody'), 'error'); return; }
    // authorId bleibt bei einer Bearbeitung unverändert (Server erzwingt
    // das ohnehin, siehe sync.service.ts — hier nur konsistent gehalten,
    // damit ein clientseitiger Zwischenstand nicht abweicht).
    await put('announcements', { ...data, title, body, groupId: fGroup.value || null });
    toast(isEdit ? t('announcements.savedEdit') : t('announcements.savedCreate'));
    close();
    onSaved?.();
  });

  const { close } = openModal({ title: isEdit ? t('announcements.modalEdit') : t('announcements.modalCreate'), bodyNode: form, wide: true });
}
