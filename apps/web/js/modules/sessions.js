// Nachverfolgung der Trainingseinheiten & Feedback
import { getAll, put, remove } from '../db.js';
import { el, clear, beginRender, redraw } from '../dom.js';
import { fmtDateLong, todayISO, toIsoDateTime, dateOnly } from '../dates.js';
import { badge, emptyState, laneWave, average, fullName, toast } from '../ui.js';
import { openModal, confirmAction } from '../modal.js';
import { field, selectInput, dateInput, formActions } from '../forms.js';
import { isAthleteScoped, getCurrentUser } from '../state.js';
import { fetchAssignableTrainers } from './actionItems.js';
import { navigate } from '../router.js';
import { t } from '../i18n.js';
import { totalDistance } from './setEditor.js';
import { teamFilterChips, loadTeamSelection, saveTeamSelection, matchesTeams } from '../teamFilter.js';

export const sessionsModule = {
  id: 'sessions',
  // Ohne 'admin': die Vereinsverwaltung sieht Anwesenheiten nur als
  // Zusammenfassung ohne RPE/Notizen (attendanceOverview.js).
  roles: ['trainer', 'athlete'],
  icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 4v16l4-2 4 2 4-2 4 2V4l-4 2-4-2-4 2-4-2z"/><path d="M9 9h6M9 13h4"/></svg>`,
  async render(container, params) {
    const isCurrent = beginRender(container);
    clear(container);
    if (isAthleteScoped()) return renderAthleteView(container, isCurrent);
    // Detailansicht lädt ihre Daten selbst (siehe renderDetail()) — vor dem
    // Listenabruf verzweigen, sonst würde jeder Store doppelt gelesen.
    if (params[0]) return renderDetail(container, params[0]);
    const [sessions, groups, athletes, plans] = await Promise.all(['sessions', 'groups', 'athletes', 'plans'].map(getAll));
    if (!isCurrent()) return;
    renderList(container, sessions, groups, athletes, plans);
  }
};

function renderList(container, sessions, groups, athletes, plans) {
  const wrap = el('div');
  wrap.appendChild(el('div', { class: 'page-head' }, [
    el('div', {}, [el('h1', { class: 'mt-0' }, t('sessions.title'))]),
    el('div', { class: 'page-actions' }, [el('button', { class: 'btn btn-primary', onclick: () => openSessionModal(null, groups, athletes, fetchAssignableTrainers(), refresh, { plans }) }, t('sessions.addSession'))]),
  ]));
  wrap.appendChild(laneWave());

  const user = getCurrentUser();
  let teams = loadTeamSelection('sessions', user, groups);
  wrap.appendChild(teamFilterChips(groups, teams, (next) => { teams = next; saveTeamSelection('sessions', user, next); drawTable(); }));
  const host = el('div');
  wrap.appendChild(host);
  container.appendChild(wrap);

  if (sessions.length === 0) { host.appendChild(emptyState(t('sessions.noSessionsTitle'), t('sessions.noSessionsMsg'), null)); return; }
  drawTable();

  function drawTable() {
    clear(host);
    const shown = sessions.filter(s => matchesTeams(s.groupId ? [s.groupId] : null, teams));
    if (shown.length === 0) { host.appendChild(emptyState(t('teamFilter.noMatchTitle'), t('teamFilter.noMatchMsg'), null)); return; }
    host.appendChild(sessionsTable(shown));
  }

  function sessionsTable(list) {
    const table = el('table');
    table.appendChild(el('thead', {}, el('tr', {}, [el('th', {}, t('sessions.colDate')), el('th', {}, t('sessions.colGroup')), el('th', {}, t('sessions.colPresent')), el('th', {}, t('sessions.colAvgRpe')), el('th', {}, '')])));
    const tbody = el('tbody');
    list.slice().sort((a, b) => b.date.localeCompare(a.date)).forEach(s => {
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
    return el('div', { class: 'table-wrap card' }, table);
  }

  function refresh() {
    return redraw(container, () => Promise.all(['sessions', 'groups', 'athletes', 'plans'].map(getAll)), ([s2, g2, a2, p2]) => renderList(container, s2, g2, a2, p2));
  }
}

async function renderDetail(container, sessionId) {
  const isCurrent = beginRender(container);
  const [sessions, groups, athletes, plans, trainers] = await Promise.all([...['sessions', 'groups', 'athletes', 'plans'].map(getAll), fetchAssignableTrainers()]);
  if (!isCurrent()) return;
  clear(container);
  const session = sessions.find(s => s.id === sessionId);
  if (!session) { container.appendChild(emptyState(t('common.notFoundTitle'), t('sessions.notFoundMsg'), el('button', { class: 'btn btn-primary', onclick: () => navigate('sessions') }, t('common.back')))); return; }
  const group = groups.find(g => g.id === session.groupId);
  const plan = plans.find(p => p.id === session.planId);

  const wrap = el('div');
  wrap.appendChild(el('button', { class: 'btn btn-ghost btn-sm mb-16', onclick: () => navigate('sessions') }, t('sessions.backToList')));
  wrap.appendChild(el('div', { class: 'page-head' }, [
    el('div', {}, [el('div', { class: 'page-eyebrow' }, group?.name || t('plans.noGroup')), el('h1', { class: 'mt-0' }, fmtDateLong(session.date))]),
    el('div', { class: 'page-actions' }, [
      el('button', { class: 'btn btn-ghost', onclick: () => openSessionModal(session, groups, athletes, trainers, () => renderDetail(container, sessionId), { plans }) }, t('common.edit')),
      el('button', { class: 'btn btn-danger', onclick: () => confirmAction(t('sessions.deleteConfirm'), async () => { await remove('sessions', sessionId); toast(t('sessions.deleted')); navigate('sessions'); }) }, t('common.delete')),
    ]),
  ]));
  wrap.appendChild(laneWave());
  if (plan) {
    const day = planDayOn(plan, session.date);
    wrap.appendChild(el('p', { class: 'flex items-center gap-8', style: 'flex-wrap:wrap' }, [
      el('span', {}, day ? t('sessions.basedOnPlanWithVolume', { name: plan.name, m: totalDistance(day.sets || []) }) : t('sessions.basedOnPlan', { name: plan.name })),
      el('button', { class: 'btn btn-ghost btn-sm', onclick: () => navigate('plans', plan.id) }, t('sessions.openPlan')),
    ]));
  }
  else if (session.actualDistance != null) wrap.appendChild(el('p', {}, t('sessions.actualDistanceLine', { m: session.actualDistance })));
  if (session.trainerNote) wrap.appendChild(el('div', { class: 'card' }, [el('h3', { class: 'mt-0' }, t('sessions.trainerNoteTitle')), el('p', {}, session.trainerNote)]));

  const coachIds = session.coachIds || [];
  wrap.appendChild(el('div', { class: 'card' }, [
    el('h3', { class: 'mt-0' }, t('sessions.coachesTitle')),
    el('p', { class: 'mb-0' }, coachIds.length ? coachIds.map(id => trainers.find(tr => tr.id === id)?.name || t('sessions.unknownCoach')).join(', ') : t('sessions.noCoachesRecorded')),
  ]));

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
  const [sessions, athletes] = await Promise.all(['sessions', 'athletes'].map(getAll));
  if (!isCurrent()) return;
  const me = athletes.find(a => a.id === user?.athleteId);
  const wrap = el('div');
  wrap.appendChild(el('div', { class: 'page-head' }, [el('div', {}, [el('h1', { class: 'mt-0' }, t('sessions.myTitle'))])]));
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

// Der Tag eines Plans an einem Datum (Vergleich nur über das Datum, siehe
// sessionVolume() in trainingLoad.js, das denselben Tag heranzieht).
export function planDayOn(plan, date) {
  const d = dateOnly(date);
  return (plan?.days || []).find(day => dateOnly(day.date) === d) || null;
}

// Pläne, die mit einer Einheit am `date` verknüpft werden können: alle mit
// einem Trainingstag an diesem Datum — Pläne der Gruppe zuerst, darin
// aktive vor archivierten. Pläne anderer Gruppen bleiben wählbar (z. B.
// gemeinsames Training zweier Gruppen).
export function linkablePlans(plans, date, groupId) {
  const rank = (p) => (p.groupId === groupId ? 0 : 2) + (p.status === 'aktiv' ? 0 : 1);
  return (plans || [])
    .filter(p => planDayOn(p, date))
    .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

// Vorschlag für eine NEUE Einheit: ein aktiver Plan der Gruppe mit einem
// Tag an diesem Datum — sonst keiner (eine fremde Gruppe oder ein
// archivierter Plan wird nie stillschweigend vorausgewählt).
export function suggestPlanId(plans, date, groupId) {
  const first = linkablePlans(plans, date, groupId)[0];
  return first && first.groupId === groupId && first.status === 'aktiv' ? first.id : null;
}

// Neue Einheit mit Vorbelegung (z. B. aus dem Trainingsmodus eines Plans,
// siehe planLive.js) — lädt die Auswahllisten selbst. `onSaved` erhält die
// gespeicherte Einheit.
export async function openNewSessionModal(prefill, onSaved) {
  const [groups, athletes, plans] = await Promise.all(['groups', 'athletes', 'plans'].map(getAll));
  openSessionModal(null, groups, athletes, fetchAssignableTrainers(), onSaved, { plans, prefill });
}

// Vorauswahl der anwesenden Trainer:innen einer NEUEN Einheit: die der
// Gruppe zugeordneten, ohne Zuordnung die erfassende Person selbst.
function defaultCoachIds(groups, groupId) {
  const assigned = groups.find(g => g.id === groupId)?.trainerIds || [];
  const me = getCurrentUser();
  return assigned.length ? [...assigned] : (me ? [me.id] : []);
}

// `trainers` darf ein Promise sein (Liste lädt über das Netz, siehe
// fetchAssignableTrainers()) — die Checkboxen erscheinen, sobald sie da ist.
function openSessionModal(session, groups, athletes, trainers, onSaved, { plans = [], prefill = {} } = {}) {
  const isEdit = !!session;
  const newDate = dateOnly(prefill.date) || todayISO();
  // Ohne Vorgabe: die Gruppe, die an dem Tag nach Plan trainiert.
  const newGroupId = prefill.groupId ?? (groups.find(g => suggestPlanId(plans, newDate, g.id)) || groups[0])?.id ?? '';
  const data = session
    ? { ...session, attendance: session.attendance.map(a => ({ ...a })), coachIds: [...(session.coachIds || [])] }
    : { date: newDate, groupId: newGroupId, planId: prefill.planId !== undefined ? prefill.planId : suggestPlanId(plans, newDate, newGroupId), trainerNote: '', attendance: [], coachIds: defaultCoachIds(groups, newGroupId) };
  function attendanceFor(groupId) {
    return athletes.filter(a => a.groupId === groupId).map(a => {
      const existing = data.attendance.find(x => x.athleteId === a.id);
      return existing || { athleteId: a.id, present: true, rpe: null, note: '' };
    });
  }
  if (!isEdit) data.attendance = attendanceFor(data.groupId);

  const form = el('form', { class: 'form-grid single' });
  const fDate = dateInput(data.date);
  const fGroup = selectInput(groups.map(g => ({ value: g.id, label: g.name })), data.groupId);
  const fNote = el('textarea', {}, data.trainerNote || '');
  form.appendChild(el('div', { class: 'form-grid' }, [field(t('sessions.formDate'), fDate), field(t('sessions.formGroup'), fGroup)]));
  form.appendChild(field(t('sessions.formTrainerNote'), fNote, { hint: t('sessions.formTrainerNoteHint') }));

  // Verknüpfter Plan: zur Auswahl stehen Pläne mit einem Tag am gewählten
  // Datum (siehe linkablePlans()). Bei einer NEUEN Einheit folgt die
  // Vorauswahl Datum/Gruppe, bis die Person selbst etwas auswählt.
  let planTouched = isEdit || prefill.planId !== undefined;
  const fPlan = el('select');
  const planHint = el('div', { class: 'hint' });
  form.appendChild(el('div', { class: 'field' }, [el('label', { for: 'session-plan' }, t('sessions.formPlan')), fPlan, planHint]));
  fPlan.id = 'session-plan';
  fPlan.setAttribute('aria-describedby', 'session-plan-hint');
  planHint.id = 'session-plan-hint';
  const groupName = (id) => groups.find(g => g.id === id)?.name || t('plans.noGroup');

  // Umfang von Hand — nur ohne verknüpften Plan; sonst wird er aus dem
  // Plan-Tag berechnet (siehe trainingLoad.js).
  const fActualDistance = el('input', { type: 'number', min: '0', value: data.actualDistance ?? '' });
  const actualDistanceField = field(t('sessions.formActualDistance'), fActualDistance, { hint: t('sessions.formActualDistanceHint') });
  form.appendChild(actualDistanceField);

  function drawPlanOptions() {
    const date = fDate.value;
    const options = linkablePlans(plans, date, fGroup.value);
    // Ein bereits verknüpfter Plan ohne Tag an diesem Datum (Datum
    // geändert) bleibt sichtbar, statt stillschweigend zu verschwinden.
    const linked = plans.find(p => p.id === data.planId);
    if (linked && !options.includes(linked)) options.push(linked);
    clear(fPlan);
    fPlan.appendChild(el('option', { value: '' }, t('sessions.formPlanNone')));
    options.forEach(p => {
      const day = planDayOn(p, date);
      const parts = [p.name, groupName(p.groupId), day ? t('plans.totalBadge', { m: totalDistance(day.sets || []) }) : t('sessions.formPlanNoDay')];
      if (p.status !== 'aktiv') parts.push(t('plans.statusArchived'));
      fPlan.appendChild(el('option', { value: p.id }, parts.join(' · ')));
    });
    fPlan.value = data.planId || '';
    drawPlanState();
  }
  function drawPlanState() {
    const plan = plans.find(p => p.id === data.planId);
    const day = plan ? planDayOn(plan, fDate.value) : null;
    planHint.textContent = !plan
      ? (linkablePlans(plans, fDate.value, fGroup.value).length ? t('sessions.formPlanHint') : t('sessions.formPlanNoneAvailable'))
      : day ? t('sessions.formPlanVolume', { m: totalDistance(day.sets || []) }) : t('sessions.formPlanNoDayHint');
    actualDistanceField.style.display = plan ? 'none' : '';
  }
  fPlan.addEventListener('change', () => { planTouched = true; data.planId = fPlan.value || null; drawPlanState(); });
  function refreshSuggestion() {
    if (!planTouched) data.planId = suggestPlanId(plans, fDate.value, fGroup.value);
    drawPlanOptions();
  }
  fDate.addEventListener('change', refreshSuggestion);
  drawPlanOptions();

  const coachWrap = el('div', { class: 'field' });
  coachWrap.appendChild(el('label', {}, t('sessions.coachesLabel')));
  const coachHost = el('div', { style: 'display:flex;flex-wrap:wrap;gap:4px 20px' }, el('span', { class: 'text-slate text-sm' }, t('common.loading')));
  // Checkboxen außerhalb von .field — dessen Label-Stil (Versalien) gilt
  // nur für die Überschrift, nicht für die Namen.
  form.appendChild(coachWrap);
  form.appendChild(coachHost);
  let trainerList = null;
  Promise.resolve(trainers).then(list => { trainerList = list; drawCoaches(); });

  // IDs, die nicht (mehr) in der Trainer:innen-Liste stehen (z. B. Konto
  // entfernt), bleiben beim Speichern erhalten — nur Sichtbares ist abwählbar.
  function drawCoaches() {
    if (!trainerList) return;
    clear(coachHost);
    if (trainerList.length === 0) { coachHost.appendChild(el('span', { class: 'text-slate text-sm' }, t('sessions.noCoachesAvailable'))); return; }
    trainerList.forEach(tr => {
      const cb = el('input', { type: 'checkbox' });
      cb.checked = data.coachIds.includes(tr.id);
      cb.addEventListener('change', () => {
        data.coachIds = cb.checked ? [...data.coachIds, tr.id] : data.coachIds.filter(id => id !== tr.id);
      });
      coachHost.appendChild(el('label', { class: 'consent-checkbox' }, [cb, el('span', {}, tr.name)]));
    });
  }

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
  fGroup.addEventListener('change', () => {
    data.groupId = fGroup.value; data.attendance = attendanceFor(fGroup.value); drawAttendance();
    if (!isEdit) { data.coachIds = defaultCoachIds(groups, fGroup.value); drawCoaches(); }
    refreshSuggestion();
  });

  form.appendChild(formActions({ onCancel: () => close(), submitLabel: isEdit ? t('common.save') : t('sessions.addSession').replace('+ ', ''), spanFull: false }).row);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    // Mit Plan zählt der Umfang des Plan-Tages (trainingLoad.js bevorzugt
    // sonst eine Handangabe) — daher dort keine Handangabe speichern.
    const actualDistance = data.planId ? null : (fActualDistance.value ? parseInt(fActualDistance.value, 10) : null);
    const saved = await put('sessions', { ...data, date: toIsoDateTime(fDate.value), groupId: fGroup.value, planId: data.planId || null, trainerNote: fNote.value.trim(), attendance: data.attendance, coachIds: data.coachIds, actualDistance });
    toast(isEdit ? t('sessions.savedEdit') : t('sessions.savedCreate'));
    close(); onSaved?.(saved);
  });
  const { close } = openModal({ title: isEdit ? t('sessions.modalEdit') : t('sessions.modalCreate'), bodyNode: form, wide: true });
}
