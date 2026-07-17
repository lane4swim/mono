// ============================================================
// modules/athletes.js — Athleten-, Team- und Gruppenverwaltung
// ============================================================
import { getAll, put, remove } from '../db.js';
import {
  el, clear, esc, fullName, ageFromBirthdate, fmtDateShort, todayISO,
  field, textInput, selectInput, openModal, confirmAction, toast, badge,
  emptyState, laneWave, groupBy, secToTime,
} from '../utils.js';
import { getRole, isAdminOrSuperAdmin } from '../state.js';
import { navigate } from '../router.js';
import { t, trCode } from '../i18n.js';
import { beginRender } from '../utils.js';

export const athletesModule = {
  id: 'athletes',
  roles: ['trainer', 'admin'],
  icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17" cy="8" r="2.6" opacity=".6"/><path d="M15.5 14.3c2.6.4 4.5 2.7 4.5 5.7" opacity=".6"/></svg>`,
  async render(container, params) {
    const isCurrent = beginRender(container);
    clear(container);
    const [athletes, groups] = await Promise.all([getAll('athletes'), getAll('groups')]);
    if (!isCurrent()) return;
    if (params[0]) return renderDetail(container, params[0], athletes, groups);
    renderList(container, athletes, groups);
  }
};

function renderList(container, athletes, groups) {
  const wrap = el('div');
  wrap.appendChild(el('div', { class: 'page-head' }, [
    el('div', {}, [el('div', { class: 'page-eyebrow' }, t('athletes.eyebrow', { count: athletes.length })), el('h1', { class: 'mt-0' }, t('athletes.title'))]),
    el('div', { class: 'page-actions' }, [
      el('button', { class: 'btn btn-ghost', onclick: () => openGroupModal(groups, refresh) }, t('athletes.manageGroups')),
      isAdminOrSuperAdmin() ? el('button', { class: 'btn btn-primary', onclick: () => openAthleteModal(null, groups, refresh) }, t('athletes.addAthlete')) : null,
    ].filter(Boolean)),
  ]));
  wrap.appendChild(laneWave());

  // group filter pills
  const activeGroupId = { value: 'all' };
  const pillRow = el('div', { class: 'pill-group mb-16' });
  const allPill = el('button', { class: 'pill active', onclick: () => selectGroup('all') }, t('athletes.allWithCount', { count: athletes.length }));
  pillRow.appendChild(allPill);
  groups.forEach(g => {
    const count = athletes.filter(a => a.groupId === g.id).length;
    pillRow.appendChild(el('button', { class: 'pill', onclick: () => selectGroup(g.id) }, `${g.name} (${count})`));
  });
  wrap.appendChild(pillRow);

  const tableHost = el('div');
  wrap.appendChild(tableHost);
  container.appendChild(wrap);

  function selectGroup(gid) {
    activeGroupId.value = gid;
    [...pillRow.children].forEach(p => p.classList.remove('active'));
    const idx = gid === 'all' ? 0 : groups.findIndex(g => g.id === gid) + 1;
    pillRow.children[idx]?.classList.add('active');
    drawTable();
  }

  function drawTable() {
    clear(tableHost);
    const filtered = activeGroupId.value === 'all' ? athletes : athletes.filter(a => a.groupId === activeGroupId.value);
    if (filtered.length === 0) {
      tableHost.appendChild(emptyState(t('athletes.noAthletesTitle'), t('athletes.noAthletesInGroup'), null));
      return;
    }
    const table = el('table');
    table.appendChild(el('thead', {}, el('tr', {}, [
      el('th', {}, t('athletes.colName')), el('th', {}, t('athletes.colAge')), el('th', {}, t('athletes.colGroup')), el('th', {}, t('athletes.colStatus')), el('th', {}, ''),
    ])));
    const tbody = el('tbody');
    filtered.sort((a, b) => a.lastName.localeCompare(b.lastName)).forEach(a => {
      const group = groups.find(g => g.id === a.groupId);
      tbody.appendChild(el('tr', { class: 'row-click', onclick: () => navigate('athletes', a.id) }, [
        el('td', {}, [el('div', { class: 'avatar', style: 'display:inline-flex;margin-right:8px' }, (a.firstName[0] + (a.lastName[0]||'')).toUpperCase()), fullName(a)]),
        el('td', {}, String(ageFromBirthdate(a.birthdate) ?? '—')),
        el('td', {}, group?.name || '—'),
        el('td', {}, badge(a.active ? t('athletes.statusActive') : t('athletes.statusInactive'), a.active ? 'done' : 'neutral')),
        el('td', {}, el('button', { class: 'btn btn-ghost btn-sm', onclick: (e) => { e.stopPropagation(); navigate('athletes', a.id); } }, t('common.open'))),
      ]));
    });
    table.appendChild(tbody);
    tableHost.appendChild(el('div', { class: 'table-wrap card' }, table));
  }
  drawTable();

  async function refresh() {
    const [a2, g2] = await Promise.all([getAll('athletes'), getAll('groups')]);
    clear(container);
    renderList(container, a2, g2);
  }
}

async function renderDetail(container, athleteId, athletes, groups) {
  const athlete = athletes.find(a => a.id === athleteId);
  if (!athlete) { container.appendChild(emptyState(t('common.notFoundTitle'), t('athletes.notFoundMsg'), el('button', { class: 'btn btn-primary', onclick: () => navigate('athletes') }, t('athletes.backToOverview')))); return; }

  const [results, actionItems, sessions] = await Promise.all([getAll('results'), getAll('actionItems'), getAll('sessions')]);
  const group = groups.find(g => g.id === athlete.groupId);
  const myResults = results.filter(r => r.athleteId === athleteId);
  const myActions = actionItems.filter(a => a.athleteId === athleteId);
  let attended = 0, total = 0;
  sessions.forEach(s => { const rec = s.attendance?.find(x => x.athleteId === athleteId); if (rec) { total++; if (rec.present) attended++; } });

  const wrap = el('div');
  wrap.appendChild(el('button', { class: 'btn btn-ghost btn-sm mb-16', onclick: () => navigate('athletes') }, t('athletes.backToList')));
  wrap.appendChild(el('div', { class: 'page-head' }, [
    el('div', {}, [
      el('div', { class: 'page-eyebrow' }, group?.name || t('athletes.noGroup')),
      el('h1', { class: 'mt-0' }, fullName(athlete)),
    ]),
    el('div', { class: 'page-actions' }, isAdminOrSuperAdmin() ? [
      el('button', { class: 'btn btn-ghost', onclick: () => openAthleteModal(athlete, groups, () => navigate('athletes', athleteId) & location.reload()) }, t('common.edit')),
      el('button', { class: 'btn btn-danger', onclick: () => confirmAction(t('athletes.deleteConfirm', { name: fullName(athlete) }), async () => { await remove('athletes', athleteId); toast(t('athletes.deleted')); navigate('athletes'); }) }, t('common.delete')),
    ] : []),
  ]));
  wrap.appendChild(laneWave());

  wrap.appendChild(el('div', { class: 'grid grid-4 mb-16' }, [
    (() => { const d = el('div', { class: 'stat-card' }); d.innerHTML = `<div class="stat-label">${esc(t('athletes.statAge'))}</div><div class="stat-value">${ageFromBirthdate(athlete.birthdate) ?? '—'}</div><div class="stat-sub">${athlete.birthdate ? fmtDateShort(athlete.birthdate) : ''}</div>`; return d; })(),
    (() => { const d = el('div', { class: 'stat-card alt' }); d.innerHTML = `<div class="stat-label">${esc(t('athletes.statAttendance'))}</div><div class="stat-value">${total ? Math.round(attended/total*100) : 0}%</div><div class="stat-sub">${esc(t('athletes.statAttendanceSub', { present: attended, total }))}</div>`; return d; })(),
    (() => { const d = el('div', { class: 'stat-card' }); d.innerHTML = `<div class="stat-label">${esc(t('athletes.statTimes'))}</div><div class="stat-value">${myResults.length}</div><div class="stat-sub">${esc(t('athletes.statDisciplines', { count: new Set(myResults.map(r=>r.event)).size }))}</div>`; return d; })(),
    (() => { const d = el('div', { class: 'stat-card alt' }); d.innerHTML = `<div class="stat-label">${esc(t('athletes.statActions'))}</div><div class="stat-value">${myActions.filter(a=>a.status!=='done').length}</div><div class="stat-sub">${esc(t('athletes.statActionsOpen', { total: myActions.length }))}</div>`; return d; })(),
  ]));

  const grid = el('div', { class: 'grid grid-2' });

  const genderLabel = athlete.gender === 'w' ? t('athletes.genderF') : athlete.gender === 'm' ? t('athletes.genderM') : t('athletes.genderD');
  const infoCard = el('div', { class: 'card' }, [
    el('h3', {}, t('athletes.masterData')),
    el('p', {}, [el('strong', {}, `${t('athletes.genderLabel')}: `), genderLabel]),
    el('p', {}, [el('strong', {}, `${t('athletes.memberSince')}: `), athlete.joinDate ? fmtDateShort(athlete.joinDate) : '—']),
    el('p', {}, [el('strong', {}, `${t('athletes.groupLabel')}: `), group?.name || '—']),
    athlete.notes ? el('p', {}, [el('strong', {}, `${t('athletes.notesLabel')}: `), athlete.notes]) : null,
  ]);
  grid.appendChild(infoCard);

  const pbCard = el('div', { class: 'card' }, [el('h3', {}, t('athletes.pbTitle'))]);
  const byEvent = groupBy(myResults, r => r.event);
  if (Object.keys(byEvent).length === 0) pbCard.appendChild(el('p', {}, t('athletes.noTimesYet')));
  else Object.entries(byEvent).forEach(([evt, list]) => {
    const best = list.reduce((a, b) => a.time < b.time ? a : b);
    pbCard.appendChild(el('div', { class: 'list-row' }, [el('div', { style: 'flex:1' }, trCode(evt, 'events')), el('div', { class: 'data' }, secToTime(best.time))]));
  });
  pbCard.appendChild(el('button', { class: 'btn btn-ghost btn-sm', style: 'margin-top:8px', onclick: () => navigate('times') }, t('athletes.toTimesLink')));
  grid.appendChild(pbCard);

  const actionCard = el('div', { class: 'card' }, [el('h3', {}, t('athletes.actionsTitle'))]);
  if (myActions.length === 0) actionCard.appendChild(el('p', {}, t('athletes.noActionsYet')));
  else myActions.forEach(a => actionCard.appendChild(el('div', { class: 'list-row row-click', onclick: () => navigate('actionitems', a.id) }, [
    el('div', { style: 'flex:1' }, [el('div', {}, a.title), el('div', { class: 'text-slate text-sm' }, a.description?.slice(0, 60) || '')]),
    badge(a.status === 'done' ? t('refdata.actionStatus.done') : a.status === 'progress' ? t('refdata.actionStatus.progress') : t('refdata.actionStatus.offen'), a.status === 'done' ? 'done' : a.status === 'progress' ? 'progress' : 'open'),
  ])));
  actionCard.appendChild(el('button', { class: 'btn btn-ghost btn-sm', style: 'margin-top:8px', onclick: () => navigate('actionitems') }, t('athletes.addAction')));
  grid.appendChild(actionCard);

  wrap.appendChild(grid);
  container.appendChild(wrap);
}

function openAthleteModal(athlete, groups, onSaved) {
  // Verteidigung in der Tiefe: neben dem Ausblenden der Buttons in
  // renderList()/renderDetail() wird hier zusätzlich geprüft — Trainer:innen
  // dürfen den Athleten-Stamm (Name/Identität) nicht anlegen oder ändern,
  // sondern nur die von Admin/Superadmin angelegten Profile einsehen/nutzen.
  if (!isAdminOrSuperAdmin()) {
    toast(t('athletes.rosterManagedByAdmin'), 'error');
    return;
  }
  const isEdit = !!athlete;
  const data = athlete ? { ...athlete } : { firstName: '', lastName: '', birthdate: '', gender: 'w', groupId: groups[0]?.id || '', joinDate: todayISO(), active: true, notes: '' };
  const form = el('form', { class: 'form-grid' });
  const fFirst = textInput(data.firstName, { required: true });
  const fLast = textInput(data.lastName, { required: true });
  const fBirth = el('input', { type: 'date', value: data.birthdate || '' });
  const fGender = selectInput([{ value: 'w', label: t('athletes.genderF') }, { value: 'm', label: t('athletes.genderM') }, { value: 'd', label: t('athletes.genderD') }], data.gender);
  const fGroup = selectInput(groups.map(g => ({ value: g.id, label: g.name })), data.groupId);
  const fJoin = el('input', { type: 'date', value: data.joinDate || todayISO() });
  const fActive = el('input', { type: 'checkbox' }); fActive.checked = data.active !== false;
  const fNotes = el('textarea', {}, data.notes || '');

  form.appendChild(field(t('athletes.formFirstName'), fFirst));
  form.appendChild(field(t('athletes.formLastName'), fLast));
  form.appendChild(field(t('athletes.formBirthdate'), fBirth));
  form.appendChild(field(t('athletes.formGender'), fGender));
  form.appendChild(field(t('athletes.formGroup'), fGroup));
  form.appendChild(field(t('athletes.formJoinDate'), fJoin));
  form.appendChild(field(t('athletes.formNotes'), fNotes, { span2: true }));
  const activeField = field(t('athletes.formStatus'), el('div', { class: 'flex items-center gap-8' }, [fActive, el('span', { class: 'text-sm' }, t('athletes.formActiveLabel'))]), { span2: true });
  form.appendChild(activeField);

  form.appendChild(el('div', { class: 'form-actions span-2', style: 'grid-column:1/-1' }, [
    el('button', { type: 'button', class: 'btn btn-ghost', onclick: () => close() }, t('common.cancel')),
    el('button', { type: 'submit', class: 'btn btn-primary' }, isEdit ? t('common.save') : t('common.create')),
  ]));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!fFirst.value.trim() || !fLast.value.trim()) { toast(t('athletes.validationName'), 'error'); return; }
    const obj = {
      ...data, firstName: fFirst.value.trim(), lastName: fLast.value.trim(), birthdate: fBirth.value,
      gender: fGender.value, groupId: fGroup.value, joinDate: fJoin.value, active: fActive.checked, notes: fNotes.value.trim(),
    };
    await put('athletes', obj);
    toast(isEdit ? t('athletes.savedEdit') : t('athletes.savedCreate'));
    close();
    onSaved?.();
  });

  const { close } = openModal({ title: isEdit ? t('athletes.modalEditTitle', { name: fullName(athlete) }) : t('athletes.modalCreateTitle'), bodyNode: form, wide: true });
}

function openGroupModal(groups, onSaved) {
  const body = el('div');
  const list = el('div', { class: 'mb-16' });
  function drawList() {
    clear(list);
    if (groups.length === 0) { list.appendChild(el('p', {}, t('athletes.noGroupsYet'))); return; }
    groups.forEach(g => {
      list.appendChild(el('div', { class: 'list-row' }, [
        el('div', { style: 'flex:1' }, [el('div', {}, g.name), el('div', { class: 'text-slate text-sm' }, g.description || '')]),
        el('button', { class: 'btn btn-danger btn-sm', onclick: async () => { await remove('groups', g.id); groups.splice(groups.indexOf(g), 1); drawList(); onSaved?.(); } }, t('common.delete')),
      ]));
    });
  }
  drawList();
  body.appendChild(list);

  const form = el('form', { class: 'form-grid single' });
  const fName = textInput('', { placeholder: t('athletes.groupNamePlaceholder') });
  const fDesc = el('textarea', { placeholder: t('athletes.groupDescPlaceholder') });
  form.appendChild(field(t('athletes.formGroup'), fName));
  form.appendChild(field(t('catalog.formDescription'), fDesc));
  form.appendChild(el('div', { class: 'form-actions' }, [el('button', { type: 'submit', class: 'btn btn-primary' }, t('athletes.addGroupButton'))]));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!fName.value.trim()) return;
    const g = await put('groups', { name: fName.value.trim(), description: fDesc.value.trim() });
    groups.push(g);
    fName.value = ''; fDesc.value = '';
    drawList();
    onSaved?.();
  });
  body.appendChild(form);
  openModal({ title: t('athletes.groupsModalTitle'), bodyNode: body });
}
