// ============================================================
// modules/sessions.js — Nachverfolgung der Trainingseinheiten & Feedback
// ============================================================
import { getAll, put, remove } from '../db.js';
import {
  el, clear, field, textInput, selectInput, openModal, confirmAction, toast, badge,
  emptyState, laneWave, fmtDateLong, todayISO, average, fullName, beginRender,
} from '../utils.js';
import { getRole, getCurrentUser } from '../state.js';
import { navigate } from '../router.js';
import { t } from '../i18n.js';

export const sessionsModule = {
  id: 'sessions',
  roles: ['trainer', 'admin', 'athlete'],
  icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 4v16l4-2 4 2 4-2 4 2V4l-4 2-4-2-4 2-4-2z"/><path d="M9 9h6M9 13h4"/></svg>`,
  async render(container, params) {
    const isCurrent = beginRender(container);
    clear(container);
    const role = getRole();
    if (role === 'athlete') return renderAthleteView(container, isCurrent);
    const [sessions, groups, athletes, plans] = await Promise.all(['sessions', 'groups', 'athletes', 'plans'].map(getAll));
    if (!isCurrent()) return;
    if (params[0]) return renderDetail(container, params[0]);
    renderList(container, sessions, groups, athletes, plans);
  }
};

function renderList(container, sessions, groups, athletes, plans) {
  const wrap = el('div');
  wrap.appendChild(el('div', { class: 'page-head' }, [
    el('div', {}, [el('div', { class: 'page-eyebrow' }, t('sessions.eyebrow', { count: sessions.length })), el('h1', { class: 'mt-0' }, t('sessions.title'))]),
    el('div', { class: 'page-actions' }, [el('button', { class: 'btn btn-primary', onclick: () => openSessionModal(null, groups, athletes, refresh) }, t('sessions.addSession'))]),
  ]));
  wrap.appendChild(laneWave());

  const host = el('div');
  wrap.appendChild(host);
  container.appendChild(wrap);

  if (sessions.length === 0) { host.appendChild(emptyState(t('sessions.noSessionsTitle'), t('sessions.noSessionsMsg'), null)); return; }
  const table = el('table');
  table.appendChild(el('thead', {}, el('tr', {}, [el('th', {}, t('sessions.colDate')), el('th', {}, t('sessions.colGroup')), el('th', {}, t('sessions.colPresent')), el('th', {}, t('sessions.colAvgRpe')), el('th', {}, '')])));
  const tbody = el('tbody');
  sessions.slice().sort((a, b) => b.date.localeCompare(a.date)).forEach(s => {
    const group = groups.find(g => g.id === s.groupId);
    const present = s.attendance?.filter(a => a.present).length || 0;
    const total = s.attendance?.length || 0;
    const rpe = average(s.attendance?.filter(a => a.present && a.rpe).map(a => a.rpe) || []);
    tbody.appendChild(el('tr', { class: 'row-click', onclick: () => navigate('sessions', s.id) }, [
      el('td', {}, fmtDateLong(s.date)), el('td', {}, group?.name || '—'),
      el('td', {}, `${present} / ${total}`), el('td', {}, rpe ? rpe.toFixed(1) : '—'),
      el('td', {}, el('button', { class: 'btn btn-ghost btn-sm', onclick: (e) => { e.stopPropagation(); navigate('sessions', s.id); } }, t('common.open'))),
    ]));
  });
  table.appendChild(tbody);
  host.appendChild(el('div', { class: 'table-wrap card' }, table));

  async function refresh() { const [s2, g2, a2, p2] = await Promise.all(['sessions', 'groups', 'athletes', 'plans'].map(getAll)); clear(container); renderList(container, s2, g2, a2, p2); }
}

async function renderDetail(container, sessionId) {
  const [sessions, groups, athletes, plans] = await Promise.all(['sessions', 'groups', 'athletes', 'plans'].map(getAll));
  const session = sessions.find(s => s.id === sessionId);
  if (!session) { container.appendChild(emptyState(t('common.notFoundTitle'), t('sessions.notFoundMsg'), el('button', { class: 'btn btn-primary', onclick: () => navigate('sessions') }, t('common.back')))); return; }
  const group = groups.find(g => g.id === session.groupId);
  const plan = plans.find(p => p.id === session.planId);

  const wrap = el('div');
  wrap.appendChild(el('button', { class: 'btn btn-ghost btn-sm mb-16', onclick: () => navigate('sessions') }, t('sessions.backToList')));
  wrap.appendChild(el('div', { class: 'page-head' }, [
    el('div', {}, [el('div', { class: 'page-eyebrow' }, group?.name || t('plans.noGroup')), el('h1', { class: 'mt-0' }, fmtDateLong(session.date))]),
    el('div', { class: 'page-actions' }, [
      el('button', { class: 'btn btn-ghost', onclick: () => openSessionModal(session, groups, athletes, () => { clear(container); renderDetail(container, sessionId); }) }, t('common.edit')),
      el('button', { class: 'btn btn-danger', onclick: () => confirmAction(t('sessions.deleteConfirm'), async () => { await remove('sessions', sessionId); toast(t('sessions.deleted')); navigate('sessions'); }) }, t('common.delete')),
    ]),
  ]));
  wrap.appendChild(laneWave());
  if (plan) wrap.appendChild(el('p', {}, t('sessions.basedOnPlan', { name: plan.name })));
  if (session.trainerNote) wrap.appendChild(el('div', { class: 'card' }, [el('h3', { class: 'mt-0' }, t('sessions.trainerNoteTitle')), el('p', {}, session.trainerNote)]));

  const attCard = el('div', { class: 'card' }, [el('h3', { class: 'mt-0' }, t('sessions.attendanceTitle'))]);
  (session.attendance || []).forEach(rec => {
    const athlete = athletes.find(a => a.id === rec.athleteId);
    attCard.appendChild(el('div', { class: 'list-row' }, [
      el('div', { class: 'avatar' }, fullName(athlete).split(' ').map(p => p[0]).join('')),
      el('div', { style: 'flex:1' }, [
        el('div', {}, fullName(athlete)),
        el('div', { class: 'text-slate text-sm' }, rec.note || (rec.present ? '' : t('sessions.noReasonGiven'))),
      ]),
      rec.present ? badge(rec.rpe ? `RPE ${rec.rpe}` : t('sessions.statusPresent'), 'done') : badge(t('sessions.statusAbsent'), 'open'),
    ]));
  });
  wrap.appendChild(attCard);
  container.appendChild(wrap);
}

async function renderAthleteView(container, isCurrent) {
  const user = getCurrentUser();
  const [sessions, athletes, groups] = await Promise.all(['sessions', 'athletes', 'groups'].map(getAll));
  if (!isCurrent()) return;
  const me = athletes.find(a => a.id === user?.athleteId);
  const wrap = el('div');
  wrap.appendChild(el('div', { class: 'page-head' }, [el('div', {}, [el('div', { class: 'page-eyebrow' }, t('sessions.myTrainingEyebrow')), el('h1', { class: 'mt-0' }, t('sessions.myTitle'))])]));
  wrap.appendChild(laneWave());
  if (!me) { wrap.appendChild(el('p', {}, t('sessions.noAthleteProfile'))); container.appendChild(wrap); return; }
  const mySessions = sessions.filter(s => s.attendance?.some(a => a.athleteId === me.id)).sort((a, b) => b.date.localeCompare(a.date));
  if (mySessions.length === 0) { wrap.appendChild(emptyState(t('common.nothingHereTitle'), t('sessions.noSessionsForMe'), null)); container.appendChild(wrap); return; }
  const table = el('table');
  table.appendChild(el('thead', {}, el('tr', {}, [el('th', {}, t('sessions.colDate')), el('th', {}, t('sessions.colAttendance')), el('th', {}, t('sessions.colRpe')), el('th', {}, t('sessions.colNote'))])));
  const tbody = el('tbody');
  mySessions.forEach(s => {
    const rec = s.attendance.find(a => a.athleteId === me.id);
    tbody.appendChild(el('tr', {}, [el('td', {}, fmtDateLong(s.date)), el('td', {}, rec.present ? badge(t('sessions.statusPresent'), 'done') : badge(t('sessions.statusAbsent'), 'open')), el('td', {}, rec.rpe || '—'), el('td', {}, rec.note || '—')]));
  });
  table.appendChild(tbody);
  wrap.appendChild(el('div', { class: 'table-wrap card' }, table));
  container.appendChild(wrap);
}

function openSessionModal(session, groups, athletes, onSaved) {
  const isEdit = !!session;
  const data = session ? { ...session, attendance: session.attendance.map(a => ({ ...a })) } : { date: todayISO(), groupId: groups[0]?.id || '', planId: null, trainerNote: '', attendance: [] };
  function attendanceFor(groupId) {
    return athletes.filter(a => a.groupId === groupId).map(a => {
      const existing = data.attendance.find(x => x.athleteId === a.id);
      return existing || { athleteId: a.id, present: true, rpe: '', note: '' };
    });
  }
  if (!isEdit) data.attendance = attendanceFor(data.groupId);

  const form = el('form', { class: 'form-grid single' });
  const fDate = el('input', { type: 'date', value: data.date });
  const fGroup = selectInput(groups.map(g => ({ value: g.id, label: g.name })), data.groupId);
  const fNote = el('textarea', {}, data.trainerNote || '');
  form.appendChild(el('div', { class: 'form-grid' }, [field(t('sessions.formDate'), fDate), field(t('sessions.formGroup'), fGroup)]));
  form.appendChild(field(t('sessions.formTrainerNote'), fNote, { hint: t('sessions.formTrainerNoteHint') }));

  const attWrap = el('div', { class: 'field' });
  attWrap.appendChild(el('label', {}, t('sessions.attendanceRpeLabel')));
  const attHost = el('div');
  attWrap.appendChild(attHost);
  form.appendChild(attWrap);

  function drawAttendance() {
    clear(attHost);
    data.attendance.forEach(rec => {
      const athlete = athletes.find(a => a.id === rec.athleteId);
      const presentCb = el('input', { type: 'checkbox' }); presentCb.checked = rec.present !== false;
      presentCb.addEventListener('change', () => rec.present = presentCb.checked);
      const rpeInput = el('input', { type: 'number', min: '1', max: '10', value: rec.rpe || '', style: 'width:64px', oninput: (e) => rec.rpe = e.target.value ? parseInt(e.target.value) : null });
      const noteInput = el('input', { type: 'text', value: rec.note || '', placeholder: t('sessions.notePlaceholder'), style: 'flex:1', oninput: (e) => rec.note = e.target.value });
      attHost.appendChild(el('div', { class: 'list-row' }, [
        el('div', { class: 'flex items-center gap-8', style: 'width:180px' }, [presentCb, el('span', {}, fullName(athlete))]),
        rpeInput, noteInput,
      ]));
    });
  }
  drawAttendance();
  fGroup.addEventListener('change', () => { data.groupId = fGroup.value; data.attendance = attendanceFor(fGroup.value); drawAttendance(); });

  form.appendChild(el('div', { class: 'form-actions' }, [
    el('button', { type: 'button', class: 'btn btn-ghost', onclick: () => close() }, t('common.cancel')),
    el('button', { type: 'submit', class: 'btn btn-primary' }, isEdit ? t('common.save') : t('sessions.addSession').replace('+ ', '')),
  ]));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    await put('sessions', { ...data, date: fDate.value, groupId: fGroup.value, trainerNote: fNote.value.trim(), attendance: data.attendance });
    toast(isEdit ? t('sessions.savedEdit') : t('sessions.savedCreate'));
    close(); onSaved?.();
  });
  const { close } = openModal({ title: isEdit ? t('sessions.modalEdit') : t('sessions.modalCreate'), bodyNode: form, wide: true });
}
