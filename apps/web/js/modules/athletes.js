// Athleten-, Team- und Gruppenverwaltung
import { getAll, put, remove } from '../db.js';
import { el, clear, beginRender, redraw } from '../dom.js';
import { ageFromBirthdate, fmtDateShort, todayISO, toIsoDateTime } from '../dates.js';
import { secToTime } from '../swimTime.js';
import { fullName, badge, emptyState, laneWave, groupBy, statCard, toast, tabbedView } from '../ui.js';
import { openModal, confirmAction } from '../modal.js';
import { field, textInput, selectInput, dateInput, formActions } from '../forms.js';
import { isAdminOrSuperAdmin } from '../state.js';
import { navigate } from '../router.js';
import { t, trCode } from '../i18n.js';
import { fetchAssignableTrainers } from './actionItems.js';
import * as api from '../apiClient.js';
import { describeError } from '../apiClient.js';
import { accountStatus, canInviteAthlete, loadAccountIndex } from '../athleteAccount.js';
import { showInviteLinkModal } from '../inviteLink.js';

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
      isAdminOrSuperAdmin() ? el('button', { class: 'btn btn-primary', onclick: () => openAthleteModal(null, groups, refresh, accountIndex) }, t('athletes.addAthlete')) : null,
    ].filter(Boolean)),
  ]));
  wrap.appendChild(laneWave());

  // Reiter: Athlet:innen-Liste und Gruppenverwaltung (vormals ein Modal
  // hinter "Gruppen verwalten"). Die Detailansicht einer Person bleibt
  // eine eigene Route (#/athletes/:id).
  const athletesPanel = el('div');
  wrap.appendChild(tabbedView('athletes', [
    { id: 'athletes', label: t('athletes.tabAthletes', { count: athletes.length }), render: () => athletesPanel },
    { id: 'groups', label: t('athletes.tabGroups', { count: groups.length }), render: () => buildGroupManager(groups, refresh) },
  ]));

  // group filter pills
  const activeGroupId = { value: 'all' };
  const pillRow = el('div', { class: 'pill-group mb-16' });
  const allPill = el('button', { class: 'pill active', onclick: () => selectGroup('all') }, t('athletes.allWithCount', { count: athletes.length }));
  pillRow.appendChild(allPill);
  groups.forEach(g => {
    const count = athletes.filter(a => a.groupId === g.id).length;
    pillRow.appendChild(el('button', { class: 'pill', onclick: () => selectGroup(g.id) }, `${g.name} (${count})`));
  });
  athletesPanel.appendChild(pillRow);

  const tableHost = el('div');
  athletesPanel.appendChild(tableHost);
  container.appendChild(wrap);

  // Kontozustand (Konto aktiv / eingeladen) gibt es nur für Admins und nur
  // online — bis er geladen ist (oder ohne ihn) zeigt die Spalte das reine
  // accountMode-Flag, siehe athleteAccount.js.
  let accountIndex = null;

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
      el('th', {}, t('athletes.colName')), el('th', {}, t('athletes.colAge')), el('th', {}, t('athletes.colGroup')), el('th', {}, t('athletes.colStatus')), el('th', {}, t('athletes.colAccount')), el('th', {}, ''),
    ])));
    const tbody = el('tbody');
    filtered.sort((a, b) => a.lastName.localeCompare(b.lastName)).forEach(a => {
      const group = groups.find(g => g.id === a.groupId);
      tbody.appendChild(el('tr', { class: 'row-click', onclick: () => navigate('athletes', a.id) }, [
        el('td', {}, [el('div', { class: 'avatar', style: 'display:inline-flex;margin-right:8px' }, (a.firstName[0] + (a.lastName[0]||'')).toUpperCase()), fullName(a)]),
        el('td', {}, String(ageFromBirthdate(a.birthdate) ?? '—')),
        el('td', {}, group?.name || '—'),
        el('td', {}, badge(a.active ? t('athletes.statusActive') : t('athletes.statusInactive'), a.active ? 'done' : 'neutral')),
        el('td', {}, accountBadge(a, accountIndex)),
        el('td', {}, el('button', { class: 'btn btn-ghost btn-sm', onclick: (e) => { e.stopPropagation(); navigate('athletes', a.id); } }, t('common.open'))),
      ]));
    });
    table.appendChild(tbody);
    tableHost.appendChild(el('div', { class: 'table-wrap card' }, table));
  }
  drawTable();
  loadAccountIndex().then((index) => {
    if (!index) return;
    accountIndex = index;
    drawTable();
  });

  function refresh() {
    return redraw(container, () => Promise.all([getAll('athletes'), getAll('groups')]), ([a2, g2]) => renderList(container, a2, g2));
  }
}

async function renderDetail(container, athleteId, athletes, groups) {
  const isCurrent = beginRender(container);
  const athlete = athletes.find(a => a.id === athleteId);
  if (!athlete) { container.appendChild(emptyState(t('common.notFoundTitle'), t('athletes.notFoundMsg'), el('button', { class: 'btn btn-primary', onclick: () => navigate('athletes') }, t('athletes.backToOverview')))); return; }

  const [results, actionItems, sessions, accountIndex] = await Promise.all([getAll('results'), getAll('actionItems'), getAll('sessions'), loadAccountIndex()]);
  if (!isCurrent()) return;
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
      canInviteAthlete(athlete, accountIndex)
        ? el('button', { class: 'btn btn-accent', onclick: () => openAthleteInviteModal(athlete, () => { clear(container); renderDetail(container, athleteId, athletes, groups); }) }, t('athletes.inviteAthlete'))
        : null,
      el('button', { class: 'btn btn-ghost', onclick: () => openAthleteModal(athlete, groups, () => { navigate('athletes', athleteId); location.reload(); }, accountIndex) }, t('common.edit')),
      el('button', { class: 'btn btn-danger', onclick: () => confirmAction(t('athletes.deleteConfirm', { name: fullName(athlete) }), async () => { await remove('athletes', athleteId); toast(t('athletes.deleted')); navigate('athletes'); }) }, t('common.delete')),
    ].filter(Boolean) : []),
  ]));
  wrap.appendChild(laneWave());

  wrap.appendChild(el('div', { class: 'grid grid-4 mb-16' }, [
    statCard({ label: t('athletes.statAge'), value: ageFromBirthdate(athlete.birthdate) ?? '—', sub: athlete.birthdate ? fmtDateShort(athlete.birthdate) : '' }),
    statCard({ label: t('athletes.statAttendance'), value: `${total ? Math.round(attended / total * 100) : 0}%`, sub: t('athletes.statAttendanceSub', { present: attended, total }), alt: true }),
    statCard({ label: t('athletes.statTimes'), value: myResults.length, sub: t('athletes.statDisciplines', { count: new Set(myResults.map(r => r.event)).size }) }),
    statCard({ label: t('athletes.statActions'), value: myActions.filter(a => a.status !== 'done').length, sub: t('athletes.statActionsOpen', { total: myActions.length }), alt: true }),
  ]));

  const grid = el('div', { class: 'grid grid-2' });

  const genderLabel = athlete.gender === 'w' ? t('athletes.genderF') : athlete.gender === 'm' ? t('athletes.genderM') : t('athletes.genderD');
  const infoCard = el('div', { class: 'card' }, [
    el('h3', {}, t('athletes.masterData')),
    el('p', {}, [el('strong', {}, `${t('athletes.genderLabel')}: `), genderLabel]),
    el('p', {}, [el('strong', {}, `${t('athletes.memberSince')}: `), athlete.joinDate ? fmtDateShort(athlete.joinDate) : '—']),
    el('p', {}, [el('strong', {}, `${t('athletes.groupLabel')}: `), group?.name || '—']),
    el('p', {}, [el('strong', {}, `${t('athletes.accountLabel')}: `), accountBadge(athlete, accountIndex)]),
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

function openAthleteModal(athlete, groups, onSaved, accountIndex = null) {
  // Verteidigung in der Tiefe: neben dem Ausblenden der Buttons in
  // renderList()/renderDetail() wird hier zusätzlich geprüft — Trainer:innen
  // dürfen den Athleten-Stamm (Name/Identität) nicht anlegen oder ändern,
  // sondern nur die von Admin/Superadmin angelegten Profile einsehen/nutzen.
  if (!isAdminOrSuperAdmin()) {
    toast(t('athletes.rosterManagedByAdmin'), 'error');
    return;
  }
  const isEdit = !!athlete;
  const data = athlete ? { ...athlete } : { firstName: '', lastName: '', birthdate: '', gender: 'w', groupId: groups[0]?.id || '', joinDate: todayISO(), active: true, notes: '', nationalIDType: '', nationalID: '', accountMode: 'managed' };
  const form = el('form', { class: 'form-grid' });
  const fFirst = textInput(data.firstName, { required: true });
  const fLast = textInput(data.lastName, { required: true });
  const fBirth = dateInput(data.birthdate);
  const fGender = selectInput([{ value: 'w', label: t('athletes.genderF') }, { value: 'm', label: t('athletes.genderM') }, { value: 'd', label: t('athletes.genderD') }], data.gender);
  const fGroup = selectInput(groups.map(g => ({ value: g.id, label: g.name })), data.groupId);
  const fJoin = dateInput(data.joinDate || todayISO());
  const fActive = el('input', { type: 'checkbox' }); fActive.checked = data.active !== false;
  const fNotes = el('textarea', {}, data.notes || '');
  const fIDType = textInput(data.nationalIDType || '', { placeholder: 'z. B. DSV' });
  const fID = textInput(data.nationalID || '', { placeholder: 'z. B. 404306' });
  const fAccountMode = selectInput([
    { value: 'managed', label: t('athletes.accountModeManaged') },
    { value: 'invitable', label: t('athletes.accountModeInvitable') },
  ], data.accountMode === 'invitable' ? 'invitable' : 'managed');
  // Mit Konto oder offener Einladung nicht mehr auf "managed" umstellbar —
  // der Server lehnt das ab (sync.service.ts, athlete_has_account); hier
  // nur, wenn der Kontozustand bekannt ist (Admin, online).
  const accountLocked = isEdit && ['active', 'invited'].includes(accountStatus(athlete, accountIndex));
  if (accountLocked) fAccountMode.disabled = true;

  form.appendChild(field(t('athletes.formFirstName'), fFirst));
  form.appendChild(field(t('athletes.formLastName'), fLast));
  form.appendChild(field(t('athletes.formBirthdate'), fBirth));
  form.appendChild(field(t('athletes.formGender'), fGender));
  form.appendChild(field(t('athletes.formGroup'), fGroup));
  form.appendChild(field(t('athletes.formJoinDate'), fJoin));
  form.appendChild(field(t('athletes.formNationalIDType'), fIDType, { hint: t('athletes.formNationalIDHint') }));
  form.appendChild(field(t('athletes.formNationalID'), fID));
  form.appendChild(field(t('athletes.formAccountMode'), fAccountMode, { span2: true, hint: accountLocked ? t('athletes.formAccountModeLocked') : t('athletes.formAccountModeHint') }));
  form.appendChild(field(t('athletes.formNotes'), fNotes, { span2: true }));
  const activeField = field(t('athletes.formStatus'), el('div', { class: 'flex items-center gap-8' }, [fActive, el('span', { class: 'text-sm' }, t('athletes.formActiveLabel'))]), { span2: true });
  form.appendChild(activeField);

  form.appendChild(formActions({ onCancel: () => close(), submitLabel: isEdit ? t('common.save') : t('common.create'), extraClass: 'span-2' }).row);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!fFirst.value.trim() || !fLast.value.trim()) { toast(t('athletes.validationName'), 'error'); return; }
    const obj = {
      ...data, firstName: fFirst.value.trim(), lastName: fLast.value.trim(), birthdate: toIsoDateTime(fBirth.value),
      gender: fGender.value, groupId: fGroup.value || null, joinDate: toIsoDateTime(fJoin.value), active: fActive.checked, notes: fNotes.value.trim(),
      nationalIDType: fIDType.value.trim() || null, nationalID: fID.value.trim() || null,
      accountMode: fAccountMode.value,
    };
    await put('athletes', obj);
    toast(isEdit ? t('athletes.savedEdit') : t('athletes.savedCreate'));
    close();
    onSaved?.();
  });

  const { close } = openModal({ title: isEdit ? t('athletes.modalEditTitle', { name: fullName(athlete) }) : t('athletes.modalCreateTitle'), bodyNode: form, wide: true });
}

const ACCOUNT_BADGES = {
  active: ['accountActive', 'done'],
  invited: ['accountInvited', 'progress'],
  managed: ['accountManaged', 'neutral'],
  notInvited: ['accountNotInvited', 'open'],
  invitable: ['accountInvitable', 'open'],
};

function accountBadge(athlete, accountIndex) {
  const status = accountStatus(athlete, accountIndex);
  const [key, variant] = ACCOUNT_BADGES[status];
  const invitation = status === 'invited' ? accountIndex.pending.get(athlete.id) : null;
  return badge(t(`athletes.${key}`, { date: invitation ? fmtDateShort(invitation.expiresAt.slice(0, 10)) : '' }), variant);
}

// Einladung direkt aus dem Athletenprofil: Rolle "athlete" mit athleteId,
// beim Annehmen wird das neue Konto mit diesem Profil verknüpft. Nur für
// Profile mit accountMode "invitable" ohne Konto/offene Einladung
// erreichbar (canInviteAthlete()); der Server prüft dasselbe noch einmal.
function openAthleteInviteModal(athlete, onInvited) {
  const form = el('form', { class: 'form-grid' });
  const fEmail = textInput('', { type: 'email', required: true });
  form.appendChild(el('p', { class: 'hint span-2' }, t('athletes.inviteAthleteHint')));
  form.appendChild(field(t('usermgmt.formEmail'), fEmail, { span2: true }));
  const errorBox = el('p', { class: 'form-error', style: 'grid-column:1/-1;display:none' });
  form.appendChild(errorBox);
  const { row: actionsRow, submitBtn } = formActions({ onCancel: () => close(), submitLabel: t('common.create'), extraClass: 'span-2' });
  form.appendChild(actionsRow);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorBox.style.display = 'none';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fEmail.value.trim())) { toast(t('usermgmt.validationEmail'), 'error'); return; }
    submitBtn.disabled = true;
    try {
      const invitation = await api.createInvitation({ email: fEmail.value.trim(), role: 'athlete', athleteId: athlete.id });
      toast(t('usermgmt.inviteCreated'));
      close();
      showInviteLinkModal(invitation);
      onInvited?.();
    } catch (err) {
      errorBox.textContent = describeError(err);
      errorBox.style.display = 'block';
    } finally {
      submitBtn.disabled = false;
    }
  });
  const { close } = openModal({ title: t('athletes.inviteAthleteTitle', { name: fullName(athlete) }), bodyNode: form, wide: true });
}

// Eine Checkbox je Trainer:in/Admin des eigenen Vereins — analog
// clubForm.js: buildModuleCheckboxes(), hier aber lokal (einziger
// Aufrufer), da eine gemeinsame Extraktion für einen bislang einzigen
// zweiten Anwendungsfall keinen Mehrwert böte.
function buildTrainerCheckboxes(trainers, selectedIds) {
  const selectedSet = new Set(selectedIds);
  const rows = trainers.map((tr) => {
    const input = el('input', { type: 'checkbox' });
    input.checked = selectedSet.has(tr.id);
    input.dataset.trainerId = tr.id;
    return el('label', { class: 'consent-checkbox' }, [input, el('span', {}, tr.name)]);
  });
  const node = el('div', { style: 'grid-column:1/-1;display:flex;flex-direction:column;gap:6px' }, [
    el('span', { class: 'hint' }, t('athletes.formGroupTrainers')),
    trainers.length ? null : el('span', { class: 'text-slate text-sm' }, t('athletes.noTrainersYet')),
    ...rows,
  ].filter(Boolean));
  const getSelected = () => rows.filter((row) => row.querySelector('input').checked).map((row) => row.querySelector('input').dataset.trainerId);
  return { node, getSelected };
}

// docs/Plans/vereinsverwaltung-phase3-plan.md, Abschnitt 1.3: neben
// Anlegen/Löschen jetzt auch Bearbeiten bestehender Gruppen (Name/
// Beschreibung/zuständige Trainer:innen) — vormals nicht möglich.
//
// Inline im Reiter "Gruppen" von renderList() (vormals ein Modal) — der
// Knoten wird sofort zurückgegeben, Liste und Formular erscheinen, sobald
// die Trainer:innen-Auswahl geladen ist.
function buildGroupManager(groups, onSaved) {
  const body = el('div', { class: 'card' }, [
    el('h3', { class: 'mt-0' }, t('athletes.groupsModalTitle')),
  ]);
  const list = el('div', { class: 'mb-16' }, el('p', {}, t('common.loading')));
  const formHost = el('div');
  let trainers = [];

  function trainerNames(ids) {
    return (ids || []).map((id) => trainers.find((tr) => tr.id === id)?.name).filter(Boolean).join(', ');
  }

  function drawList() {
    clear(list);
    if (groups.length === 0) { list.appendChild(el('p', {}, t('athletes.noGroupsYet'))); return; }
    groups.forEach(g => {
      const names = trainerNames(g.trainerIds);
      list.appendChild(el('div', { class: 'list-row' }, [
        el('div', { style: 'flex:1' }, [
          el('div', {}, g.name),
          el('div', { class: 'text-slate text-sm' }, g.description || ''),
          names ? el('div', { class: 'text-slate text-sm' }, `${t('athletes.groupTrainersLabel')}: ${names}`) : null,
        ].filter(Boolean)),
        el('button', { class: 'btn btn-ghost btn-sm', onclick: () => drawForm(g) }, t('common.edit')),
        el('button', { class: 'btn btn-danger btn-sm', onclick: async () => { await remove('groups', g.id); groups.splice(groups.indexOf(g), 1); drawList(); onSaved?.(); } }, t('common.delete')),
      ]));
    });
  }

  function drawForm(editing) {
    clear(formHost);
    const form = el('form', { class: 'form-grid single' });
    const fName = textInput(editing?.name || '', { placeholder: t('athletes.groupNamePlaceholder') });
    const fDesc = el('textarea', { placeholder: t('athletes.groupDescPlaceholder') }, editing?.description || '');
    const trainerCheckboxes = buildTrainerCheckboxes(trainers, editing?.trainerIds || []);
    form.appendChild(field(t('athletes.formGroup'), fName));
    form.appendChild(field(t('catalog.formDescription'), fDesc));
    form.appendChild(trainerCheckboxes.node);
    const actions = [el('button', { type: 'submit', class: 'btn btn-primary' }, editing ? t('common.save') : t('athletes.addGroupButton'))];
    if (editing) actions.push(el('button', { type: 'button', class: 'btn btn-ghost', onclick: () => drawForm(null) }, t('common.cancel')));
    form.appendChild(el('div', { class: 'form-actions' }, actions));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!fName.value.trim()) return;
      const payload = { ...(editing || {}), name: fName.value.trim(), description: fDesc.value.trim(), trainerIds: trainerCheckboxes.getSelected() };
      const g = await put('groups', payload);
      const idx = groups.findIndex(x => x.id === g.id);
      if (idx >= 0) groups[idx] = g; else groups.push(g);
      drawForm(null);
      drawList();
      onSaved?.();
    });
    formHost.appendChild(form);
  }

  body.appendChild(list);
  body.appendChild(formHost);
  // fetchAssignableTrainers() fällt bei fehlendem Netzwerk/Demo-Modus auf
  // die anfragende Person selbst zurück (siehe actionItems.js) — die
  // Gruppenverwaltung bleibt dadurch auch offline nutzbar, nur die
  // Trainer-Auswahl ist dann auf die eigene Person beschränkt.
  fetchAssignableTrainers().then((loaded) => {
    trainers = loaded;
    drawList();
    drawForm(null);
  });
  return body;
}
