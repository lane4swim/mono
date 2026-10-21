// Kampfrichter-Modul (docs/kampfrichter-modul-
// plan.md, Abschnitte 4/5). Zubuchbares Modul — erscheint nur, wenn der
// Verein 'kampfrichter' gebucht hat, UND nur für Personen mit der Rolle
// 'referee' oder 'admin' (Abschnitt 4.2 — anders als die allgemeine
// Qualifikationsseite, die für trainer/athlete ebenfalls ihre eigenen,
// i. d. R. nicht-Kampfrichter-Qualifikationen zeigt).
//
// - referee: eigener, schreibgeschützter Kampfrichter-Qualifikationsstatus
//   (gefiltert auf REFEREE_QUALIFICATION_TYPES) sowie die eigenen
//   Wettkampfeinsätze mit voller Selbstverwaltung (CRUD).
// - admin: Übersicht aller Kampfrichter:innen des Vereins (Personen mit
//   'referee' in roles) inkl. Qualifikationsstatus (lesend) und
//   Einsatzhistorie, mit CRUD-Formular je Person ("im Namen von {Name}").
//
// Bewusst kein Auswahlfeld für einen bestehenden Competition-Datensatz im
// Formular (das Backend unterstützt competitionId bereits, siehe
// referees.route.ts) — Kampfrichter:innen amtieren überwiegend bei
// vereinsfremden Wettkämpfen (Plan Abschnitt 5.1), ein Freitextfeld deckt
// den Regelfall ab; eine Verknüpfung mit eigenen Wettkämpfen bleibt eine
// spätere, eigenständige Ergänzung.
import { el, clear, beginRender } from '../dom.js';
import { fmtDateShort, dateOnly, toIsoDateTime, todayISO } from '../dates.js';
import { emptyState, laneWave, toast, tabbedView, badge } from '../ui.js';
import { openModal, confirmAction } from '../modal.js';
import { field, textInput, selectInput, dateInput, formActions } from '../forms.js';
import { isAdmin, hasRole } from '../state.js';
import { REFEREE_QUALIFICATION_TYPES, REFEREE_FUNCTIONS } from '../refdata.js';
import { statusBadge, thresholdsFor, typeLabel } from './qualifications.js';
import { t, trLabel } from '../i18n.js';
import * as api from '../apiClient.js';
import { describeError } from '../apiClient.js';
import { IS_DEMO } from '../demoMode.js';

export const kampfrichterModule = {
  id: 'kampfrichter',
  roles: ['admin', 'referee'],
  icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 15a4 4 0 004-4V5a4 4 0 10-8 0v6a4 4 0 004 4z"/><path d="M19 11a7 7 0 01-14 0"/><path d="M12 18v4M8 22h8"/></svg>`,
  async render(container) {
    const isCurrent = beginRender(container);
    clear(container);
    // Läuft ausschließlich über echte REST-Endpunkte — demo.html hat kein
    // apps/api dahinter (Issue #56). Keine sinnvolle Demo-Ausweichlogik
    // (echte Wettkampfeinsätze/Qualifikationen), daher bricht render() hier
    // vollständig ab, analog qualifications.js.
    if (IS_DEMO) { renderDemoDisabled(container); return; }
    try {
      const admin = isAdmin();
      const isReferee = hasRole('referee');
      const data = await loadData(admin, isReferee);
      if (!isCurrent()) return;
      renderView(container, { admin, isReferee, ...data });
    } catch (err) {
      if (!isCurrent()) return;
      renderError(container, err);
    }
  },
};

async function loadData(admin, isReferee) {
  // Erinnerungs-Schwellen sind für JEDE Rolle lesbar (siehe
  // qualifications.route.ts: selfGuard) — hier gebraucht, um den
  // Status-Badge der eigenen Kampfrichter-Qualifikationen korrekt zu
  // berechnen, analog qualifications.js.
  const [settings, own, members, upcoming] = await Promise.all([
    api.listQualificationSettings(),
    isReferee ? api.listMyQualifications() : Promise.resolve({ qualifications: [] }),
    admin ? api.listClubMembers() : Promise.resolve({ users: [] }),
    admin ? api.listUpcomingClubRefereeAssignments() : Promise.resolve({ assignments: [] }),
  ]);
  const ownAssignments = isReferee ? await api.listMyRefereeAssignments() : { assignments: [] };
  return {
    settings,
    ownQualifications: own.qualifications,
    ownAssignments: ownAssignments.assignments,
    referees: members.users.filter((m) => m.roles.includes('referee')),
    upcoming: upcoming.assignments,
  };
}

function renderError(container, err) {
  container.appendChild(el('div', { class: 'empty-state' }, [
    el('h3', {}, t('common.somethingWentWrong')),
    el('p', {}, describeError(err)),
  ]));
}

function renderDemoDisabled(container) {
  container.appendChild(el('div', { class: 'page-head' }, [
    el('div', {}, [el('h1', { class: 'mt-0' }, t('kampfrichter.title'))]),
  ]));
  container.appendChild(emptyState(t('kampfrichter.title'), t('kampfrichter.demoDisabled'), null));
}

function functionLabel(fn) {
  return trLabel(REFEREE_FUNCTIONS, fn, 'refereeFunctions');
}

// ---- Gesamtansicht -------------------------------------------------------
function renderView(container, ctx) {
  const { admin, isReferee, settings, ownQualifications, ownAssignments, referees, upcoming } = ctx;
  const wrap = el('div');
  wrap.appendChild(el('div', { class: 'page-head' }, [
    el('div', {}, [el('h1', { class: 'mt-0' }, t('kampfrichter.title'))]),
  ]));
  wrap.appendChild(laneWave());
  wrap.appendChild(el('p', {}, admin && !isReferee ? t('kampfrichter.introAdmin') : t('kampfrichter.introSelf')));

  // Eigene Einsätze zuerst: das ist die häufigste Aufgabe einer
  // Kampfrichter:in; die Qualifikationen sind reine Anzeige.
  wrap.appendChild(tabbedView('kampfrichter', [
    isReferee && { id: 'assignments', label: t('kampfrichter.tabOwnAssignments'), render: () => renderOwnAssignmentsSection(ownAssignments, refresh) },
    isReferee && { id: 'qualifications', label: t('kampfrichter.tabOwnQualifications'), render: () => renderOwnQualificationsSection(ownQualifications, settings) },
    admin && { id: 'referees', label: t('kampfrichter.tabReferees'), render: () => renderRefereesOverviewSection(referees, settings, upcoming, refresh) },
  ]));

  container.appendChild(wrap);

  async function refresh() {
    const isCurrent = beginRender(container);
    clear(container);
    try {
      const data = await loadData(admin, isReferee);
      if (!isCurrent()) return;
      renderView(container, { admin, isReferee, ...data });
    } catch (err) {
      if (!isCurrent()) return;
      renderError(container, err);
    }
  }
}

// ---- Eigene, schreibgeschützte Kampfrichter-Qualifikationen -------------
function renderOwnQualificationsSection(qualifications, settings) {
  const filtered = qualifications.filter((q) => REFEREE_QUALIFICATION_TYPES.includes(q.type));
  const card = el('div', { class: 'card mb-16' }, [el('h3', { class: 'mt-0' }, t('kampfrichter.ownQualificationsSection'))]);
  if (filtered.length === 0) {
    card.appendChild(el('p', {}, t('kampfrichter.noneYetQualifications')));
    return card;
  }
  const table = el('table');
  table.appendChild(el('thead', {}, el('tr', {}, [
    el('th', {}, t('qualifications.colType')), el('th', {}, t('qualifications.colAcquired')),
    el('th', {}, t('qualifications.colExpires')), el('th', {}, t('qualifications.colStatus')),
  ])));
  const tbody = el('tbody');
  filtered.slice().sort((a, b) => (b.acquiredOn || '').localeCompare(a.acquiredOn || '')).forEach((q) => {
    tbody.appendChild(el('tr', {}, [
      el('td', {}, typeLabel(q.type)),
      el('td', {}, fmtDateShort(dateOnly(q.acquiredOn))),
      el('td', {}, q.expiresOn ? fmtDateShort(dateOnly(q.expiresOn)) : '—'),
      el('td', {}, statusBadge(q, thresholdsFor(q.type, settings))),
    ]));
  });
  table.appendChild(tbody);
  card.appendChild(el('div', { class: 'table-wrap' }, table));
  card.appendChild(el('p', { class: 'hint', style: 'margin-top:8px' }, t('kampfrichter.qualificationsHint')));
  return card;
}

// ---- Rückmeldung (Zu-/Absage) ---------------------------------------------
const STATUS_VARIANT = { requested: 'progress', confirmed: 'done', declined: 'open' };

// Selbst erfasste Einsätze haben niemanden, der eine Antwort bräuchte.
export function canRespond(assignment) {
  return !!assignment.createdByAdminId;
}

export function assignmentStatusBadge(assignment) {
  const status = assignment.status || 'confirmed';
  return badge(t(`kampfrichter.status.${status}`), STATUS_VARIANT[status] || 'neutral');
}

function statusCell(a) {
  return el('div', {}, [
    assignmentStatusBadge(a),
    a.responseNote ? el('div', { class: 'text-sm text-slate', style: 'margin-top:3px' }, `„${a.responseNote}“`) : null,
  ]);
}

// Dialog zum Zu-/Absagen — auch aus dem Kalender genutzt (calendar.js).
// `onDone` erhält den aktualisierten Einsatz.
export function openResponseModal(assignment, onDone) {
  const body = el('div');
  const when = fmtDateShort(dateOnly(assignment.date));
  body.appendChild(el('p', { class: 'mt-0' }, [
    el('strong', {}, assignment.competitionName), ` · ${when} · ${functionLabel(assignment.function)}`,
    assignment.competitionPlace ? el('div', { class: 'text-sm text-slate' }, assignment.competitionPlace) : null,
    assignment.note ? el('div', { class: 'text-sm' }, assignment.note) : null,
  ]));
  body.appendChild(el('p', {}, [t('kampfrichter.currentStatus'), ' ', assignmentStatusBadge(assignment)]));
  const fNote = textInput(assignment.responseNote || '', { maxlength: 500, placeholder: t('kampfrichter.responseNotePlaceholder') });
  body.appendChild(field(t('kampfrichter.responseNote'), fNote));
  const errorBox = el('p', { class: 'form-error', style: 'display:none' });
  body.appendChild(errorBox);

  async function answer(status, btn) {
    errorBox.style.display = 'none';
    btn.disabled = true;
    try {
      const updated = await api.respondToRefereeAssignment(assignment.id, { status, responseNote: fNote.value.trim() });
      toast(t(status === 'confirmed' ? 'kampfrichter.confirmedToast' : 'kampfrichter.declinedToast'));
      close();
      onDone?.(updated);
    } catch (err) {
      errorBox.textContent = describeError(err);
      errorBox.style.display = 'block';
    } finally {
      btn.disabled = false;
    }
  }
  const declineBtn = el('button', { type: 'button', class: 'btn btn-danger', onclick: () => answer('declined', declineBtn) }, t('kampfrichter.decline'));
  const confirmBtn = el('button', { type: 'button', class: 'btn btn-primary', onclick: () => answer('confirmed', confirmBtn) }, t('kampfrichter.confirm'));
  body.appendChild(el('div', { class: 'form-actions' }, [
    el('button', { type: 'button', class: 'btn btn-ghost', style: 'margin-right:auto', onclick: () => close() }, t('common.cancel')),
    declineBtn, confirmBtn,
  ]));
  const { close } = openModal({ title: t('kampfrichter.responseModalTitle'), bodyNode: body });
}

// ---- Wettkampfeinsätze: gemeinsame Tabellendarstellung -------------------
function renderAssignmentTable(rows, { onEdit, onDelete, onRespond }) {
  const table = el('table');
  table.appendChild(el('thead', {}, el('tr', {}, [
    el('th', {}, t('kampfrichter.colDate')), el('th', {}, t('kampfrichter.colCompetition')),
    el('th', {}, t('kampfrichter.colFunction')), el('th', {}, t('kampfrichter.colStatus')),
    el('th', {}, t('kampfrichter.colNote')), el('th', {}, ''),
  ])));
  const tbody = el('tbody');
  rows.slice().sort((a, b) => (b.date || '').localeCompare(a.date || '')).forEach((a) => {
    const competitionCell = el('div', {}, [
      el('div', {}, a.competitionName),
      a.competitionPlace ? el('div', { class: 'text-sm text-slate' }, a.competitionPlace) : null,
      a.createdByAdminId ? el('div', { class: 'hint' }, t('kampfrichter.enteredByAdmin')) : null,
    ]);
    tbody.appendChild(el('tr', {}, [
      el('td', {}, fmtDateShort(dateOnly(a.date))),
      el('td', {}, competitionCell),
      el('td', {}, functionLabel(a.function)),
      el('td', {}, statusCell(a)),
      el('td', {}, a.note || '—'),
      el('td', {}, el('div', { class: 'flex gap-8' }, [
        onRespond && canRespond(a)
          ? el('button', { class: `btn btn-sm ${a.status === 'requested' ? 'btn-primary' : 'btn-ghost'}`, onclick: () => onRespond(a) }, t(a.status === 'requested' ? 'kampfrichter.respond' : 'kampfrichter.changeResponse'))
          : null,
        el('button', { class: 'btn btn-ghost btn-sm', onclick: () => onEdit(a) }, t('common.edit')),
        el('button', { class: 'btn btn-danger btn-sm', onclick: () => onDelete(a) }, t('common.delete')),
      ])),
    ]));
  });
  table.appendChild(tbody);
  return el('div', { class: 'table-wrap' }, table);
}

// ---- Eigene Wettkampfeinsätze (referee, volle Selbstverwaltung) ---------
function renderOwnAssignmentsSection(assignments, onChanged) {
  const card = el('div', { class: 'card mb-16' }, [
    el('div', { class: 'flex justify-between items-center mb-16' }, [
      el('h3', { class: 'mt-0' }, t('kampfrichter.ownAssignmentsSection')),
      el('button', {
        class: 'btn btn-primary btn-sm',
        onclick: () => openAssignmentFormModal({ existing: null, onSaved: onChanged }),
      }, t('kampfrichter.addButton')),
    ]),
  ]);
  if (assignments.length === 0) {
    card.appendChild(el('p', {}, t('kampfrichter.noneYetAssignments')));
    return card;
  }
  const open = assignments.filter((a) => a.status === 'requested').length;
  if (open > 0) card.appendChild(el('p', { class: 'referee-open-banner' }, t('kampfrichter.openRequests', { count: open })));
  card.appendChild(renderAssignmentTable(assignments, {
    onRespond: (a) => openResponseModal(a, () => onChanged?.()),
    onEdit: (a) => openAssignmentFormModal({ existing: a, onSaved: onChanged }),
    onDelete: (a) => confirmAction(t('kampfrichter.deleteConfirm'), async () => {
      try {
        await api.deleteMyRefereeAssignment(a.id);
        toast(t('kampfrichter.deleted'));
        onChanged?.();
      } catch (err) {
        toast(describeError(err), 'error');
      }
    }),
  }));
  return card;
}

function openAssignmentFormModal({ existing, onSaved, forMember }) {
  const isEdit = !!existing;
  const form = el('form', { class: 'form-grid' });
  const fDate = dateInput(existing?.date ? dateOnly(existing.date) : todayISO());
  const fCompetitionName = textInput(existing?.competitionName || '');
  const fCompetitionPlace = textInput(existing?.competitionPlace || '');
  const fFunction = selectInput(REFEREE_FUNCTIONS.map((rf) => ({ value: rf.value, label: functionLabel(rf.value) })), existing?.function || REFEREE_FUNCTIONS[0].value);
  const fNote = textInput(existing?.note || '');
  form.appendChild(field(t('kampfrichter.formDate'), fDate));
  form.appendChild(field(t('kampfrichter.formFunction'), fFunction));
  form.appendChild(field(t('kampfrichter.formCompetitionName'), fCompetitionName, { span2: true }));
  form.appendChild(field(t('kampfrichter.formCompetitionPlace'), fCompetitionPlace, { span2: true }));
  form.appendChild(field(t('kampfrichter.formNote'), fNote, { span2: true }));
  const errorBox = el('p', { class: 'form-error', style: 'grid-column:1/-1;display:none' });
  form.appendChild(errorBox);
  const { row: actionsRow, submitBtn } = formActions({ onCancel: () => close(), submitLabel: isEdit ? t('common.save') : t('common.create') });
  form.appendChild(actionsRow);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorBox.style.display = 'none';
    if (!fDate.value) { toast(t('kampfrichter.validationDate'), 'error'); return; }
    if (!fCompetitionName.value.trim()) { toast(t('kampfrichter.validationCompetitionName'), 'error'); return; }
    submitBtn.disabled = true;
    try {
      const payload = {
        date: toIsoDateTime(fDate.value),
        competitionName: fCompetitionName.value.trim(),
        competitionPlace: fCompetitionPlace.value.trim(),
        function: fFunction.value,
        note: fNote.value.trim(),
      };
      if (forMember) {
        if (isEdit) await api.updateMemberRefereeAssignment(forMember.id, existing.id, payload);
        else await api.createMemberRefereeAssignment(forMember.id, payload);
      } else if (isEdit) {
        await api.updateMyRefereeAssignment(existing.id, payload);
      } else {
        await api.createMyRefereeAssignment(payload);
      }
      toast(isEdit ? t('kampfrichter.savedEdit') : t('kampfrichter.savedCreate'));
      close();
      onSaved?.();
    } catch (err) {
      errorBox.textContent = describeError(err);
      errorBox.style.display = 'block';
    } finally {
      submitBtn.disabled = false;
    }
  });
  const title = forMember
    ? (isEdit ? t('kampfrichter.modalEditOnBehalfTitle', { name: forMember.name }) : t('kampfrichter.modalCreateOnBehalfTitle', { name: forMember.name }))
    : (isEdit ? t('kampfrichter.modalEditTitle') : t('kampfrichter.modalCreateTitle'));
  const { close } = openModal({ title, bodyNode: form, wide: true });
}

// ---- Übersicht aller Kampfrichter:innen des Vereins (nur admin) --------
// Kommende Einsätze des Vereins, die noch eine Antwort brauchen oder
// abgesagt wurden — bestätigte Einsätze zählen nur in der Personen-Tabelle.
function renderResponsesSection(upcoming, referees) {
  const names = new Map(referees.map((m) => [m.id, m.name]));
  const pending = upcoming.filter((a) => a.status === 'requested' || a.status === 'declined');
  const card = el('div', { class: 'card mb-16' }, [el('h3', { class: 'mt-0' }, t('kampfrichter.responsesSection'))]);
  if (pending.length === 0) {
    card.appendChild(el('p', {}, t('kampfrichter.responsesNone')));
    return card;
  }
  const table = el('table');
  table.appendChild(el('thead', {}, el('tr', {}, [
    el('th', {}, t('kampfrichter.colDate')), el('th', {}, t('usermgmt.colName')), el('th', {}, t('kampfrichter.colCompetition')),
    el('th', {}, t('kampfrichter.colFunction')), el('th', {}, t('kampfrichter.colStatus')),
  ])));
  const tbody = el('tbody');
  // Absagen zuerst — dort muss die admin-Person handeln (Ersatz suchen).
  pending.slice().sort((a, b) => (a.status === b.status ? a.date.localeCompare(b.date) : a.status === 'declined' ? -1 : 1)).forEach((a) => {
    tbody.appendChild(el('tr', {}, [
      el('td', {}, fmtDateShort(dateOnly(a.date))),
      el('td', {}, names.get(a.userId) || '—'),
      el('td', {}, a.competitionName),
      el('td', {}, functionLabel(a.function)),
      el('td', {}, statusCell(a)),
    ]));
  });
  table.appendChild(tbody);
  card.appendChild(el('div', { class: 'table-wrap' }, table));
  return card;
}

function renderRefereesOverviewSection(referees, settings, upcoming, onChanged) {
  const wrap = el('div');
  const card = el('div', { class: 'card mb-16' }, [el('h3', { class: 'mt-0' }, t('kampfrichter.refereesSection'))]);
  if (referees.length === 0) {
    card.appendChild(emptyState(t('kampfrichter.refereesSection'), t('kampfrichter.noRefereesYet'), null));
    return card;
  }
  wrap.appendChild(renderResponsesSection(upcoming, referees));
  wrap.appendChild(card);
  const countFor = (userId, status) => upcoming.filter((a) => a.userId === userId && a.status === status).length;
  const table = el('table');
  table.appendChild(el('thead', {}, el('tr', {}, [
    el('th', {}, t('usermgmt.colName')), el('th', {}, t('usermgmt.colEmail')), el('th', {}, t('kampfrichter.colUpcoming')), el('th', {}, ''),
  ])));
  const tbody = el('tbody');
  referees.forEach((member) => {
    const open = countFor(member.id, 'requested');
    const declined = countFor(member.id, 'declined');
    const confirmed = countFor(member.id, 'confirmed');
    tbody.appendChild(el('tr', {}, [
      el('td', {}, member.name),
      el('td', {}, member.email),
      el('td', {}, el('div', { class: 'pill-group' }, [
        confirmed ? badge(t('kampfrichter.countConfirmed', { count: confirmed }), 'done') : null,
        open ? badge(t('kampfrichter.countRequested', { count: open }), 'progress') : null,
        declined ? badge(t('kampfrichter.countDeclined', { count: declined }), 'open') : null,
        !confirmed && !open && !declined ? '—' : null,
      ])),
      el('td', {}, el('button', {
        class: 'btn btn-ghost btn-sm',
        onclick: () => openMemberModal(member, settings, onChanged),
      }, t('kampfrichter.manageButton'))),
    ]));
  });
  table.appendChild(tbody);
  card.appendChild(el('div', { class: 'table-wrap' }, table));
  return wrap;
}

function openMemberModal(member, settings, onChanged) {
  const body = el('div', {}, el('p', {}, t('common.loading')));
  const { close } = openModal({ title: t('kampfrichter.membersModalTitle', { name: member.name }), bodyNode: body, wide: true });

  function draw(qualifications, assignments) {
    clear(body);
    const filtered = qualifications.filter((q) => REFEREE_QUALIFICATION_TYPES.includes(q.type));
    body.appendChild(el('h4', { style: 'margin-bottom:8px' }, t('kampfrichter.ownQualificationsSection')));
    if (filtered.length === 0) {
      body.appendChild(el('p', {}, t('kampfrichter.noneYetQualifications')));
    } else {
      const qTable = el('table');
      qTable.appendChild(el('thead', {}, el('tr', {}, [
        el('th', {}, t('qualifications.colType')), el('th', {}, t('qualifications.colExpires')), el('th', {}, t('qualifications.colStatus')),
      ])));
      const qBody = el('tbody');
      filtered.forEach((q) => {
        qBody.appendChild(el('tr', {}, [
          el('td', {}, typeLabel(q.type)),
          el('td', {}, q.expiresOn ? fmtDateShort(dateOnly(q.expiresOn)) : '—'),
          el('td', {}, statusBadge(q, thresholdsFor(q.type, settings))),
        ]));
      });
      qTable.appendChild(qBody);
      body.appendChild(el('div', { class: 'table-wrap mb-16' }, qTable));
    }

    body.appendChild(el('div', { class: 'flex justify-between items-center mb-16' }, [
      el('h4', { class: 'mt-0' }, t('kampfrichter.ownAssignmentsSection')),
      el('button', {
        class: 'btn btn-primary btn-sm',
        onclick: () => openAssignmentFormModal({ existing: null, forMember: member, onSaved: () => reload() }),
      }, t('kampfrichter.addOnBehalfButton')),
    ]));
    if (assignments.length === 0) {
      body.appendChild(el('p', {}, t('kampfrichter.noneYetAssignments')));
      return;
    }
    body.appendChild(renderAssignmentTable(assignments, {
      onEdit: (a) => openAssignmentFormModal({ existing: a, forMember: member, onSaved: () => reload() }),
      onDelete: (a) => confirmAction(t('kampfrichter.deleteConfirm'), async () => {
        try {
          await api.deleteMemberRefereeAssignment(member.id, a.id);
          toast(t('kampfrichter.deleted'));
          reload();
        } catch (err) {
          toast(describeError(err), 'error');
        }
      }),
    }));
  }

  function reload() {
    Promise.all([api.listMemberQualifications(member.id), api.listMemberRefereeAssignments(member.id)])
      .then(([qualResp, assignResp]) => { draw(qualResp.qualifications, assignResp.assignments); onChanged?.(); })
      .catch((err) => { clear(body); body.appendChild(el('p', { class: 'form-error' }, describeError(err))); });
  }

  reload();
  return close;
}
