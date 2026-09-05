// ============================================================
// modules/kampfrichter.js — Kampfrichter-Modul (docs/kampfrichter-modul-
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
// ============================================================
import { el, clear, beginRender } from '../dom.js';
import { fmtDateShort, dateOnly, toIsoDateTime, todayISO } from '../dates.js';
import { emptyState, laneWave, toast } from '../ui.js';
import { openModal, confirmAction } from '../modal.js';
import { field, textInput, selectInput, dateInput, formActions } from '../forms.js';
import { isAdmin, hasRole } from '../state.js';
import { REFEREE_QUALIFICATION_TYPES, REFEREE_FUNCTIONS } from '../refdata.js';
import { statusBadge, thresholdsFor, typeLabel } from './qualifications.js';
import { t, trLabel } from '../i18n.js';
import * as api from '../apiClient.js';
import { describeError } from '../apiClient.js';

export const kampfrichterModule = {
  id: 'kampfrichter',
  roles: ['admin', 'referee'],
  icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 15a4 4 0 004-4V5a4 4 0 10-8 0v6a4 4 0 004 4z"/><path d="M19 11a7 7 0 01-14 0"/><path d="M12 18v4M8 22h8"/></svg>`,
  async render(container) {
    const isCurrent = beginRender(container);
    clear(container);
    try {
      const admin = isAdmin();
      const isReferee = hasRole('referee');
      // Erinnerungs-Schwellen sind für JEDE Rolle lesbar (siehe
      // qualifications.route.ts: selfGuard) — hier gebraucht, um den
      // Status-Badge der eigenen Kampfrichter-Qualifikationen korrekt zu
      // berechnen, analog qualifications.js.
      const [settings, own, referees] = await Promise.all([
        api.listQualificationSettings(),
        isReferee ? api.listMyQualifications() : Promise.resolve({ qualifications: [] }),
        admin ? api.listClubMembers() : Promise.resolve({ users: [] }),
      ]);
      const ownAssignments = isReferee ? await api.listMyRefereeAssignments() : { assignments: [] };
      if (!isCurrent()) return;
      renderView(container, {
        admin,
        isReferee,
        settings,
        ownQualifications: own.qualifications,
        ownAssignments: ownAssignments.assignments,
        referees: referees.users.filter((m) => m.roles.includes('referee')),
      });
    } catch (err) {
      if (!isCurrent()) return;
      renderError(container, err);
    }
  },
};

function renderError(container, err) {
  container.appendChild(el('div', { class: 'empty-state' }, [
    el('h3', {}, t('common.somethingWentWrong')),
    el('p', {}, describeError(err)),
  ]));
}

function functionLabel(fn) {
  return trLabel(REFEREE_FUNCTIONS, fn, 'refereeFunctions');
}

// ---- Gesamtansicht -------------------------------------------------------
function renderView(container, ctx) {
  const { admin, isReferee, settings, ownQualifications, ownAssignments, referees } = ctx;
  const wrap = el('div');
  wrap.appendChild(el('div', { class: 'page-head' }, [
    el('div', {}, [el('div', { class: 'page-eyebrow' }, t('kampfrichter.eyebrow')), el('h1', { class: 'mt-0' }, t('kampfrichter.title'))]),
  ]));
  wrap.appendChild(laneWave());
  wrap.appendChild(el('p', {}, admin && !isReferee ? t('kampfrichter.introAdmin') : t('kampfrichter.introSelf')));

  if (isReferee) {
    wrap.appendChild(renderOwnQualificationsSection(ownQualifications, settings));
    wrap.appendChild(renderOwnAssignmentsSection(ownAssignments, refresh));
  }
  if (admin) {
    wrap.appendChild(renderRefereesOverviewSection(referees, settings, refresh));
  }

  container.appendChild(wrap);

  async function refresh() {
    const isCurrent = beginRender(container);
    clear(container);
    try {
      const [settingsData, ownData, membersData] = await Promise.all([
        api.listQualificationSettings(),
        isReferee ? api.listMyQualifications() : Promise.resolve({ qualifications: [] }),
        admin ? api.listClubMembers() : Promise.resolve({ users: [] }),
      ]);
      const ownAssignmentsData = isReferee ? await api.listMyRefereeAssignments() : { assignments: [] };
      if (!isCurrent()) return;
      renderView(container, {
        admin,
        isReferee,
        settings: settingsData,
        ownQualifications: ownData.qualifications,
        ownAssignments: ownAssignmentsData.assignments,
        referees: membersData.users.filter((m) => m.roles.includes('referee')),
      });
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

// ---- Wettkampfeinsätze: gemeinsame Tabellendarstellung -------------------
function renderAssignmentTable(rows, { onEdit, onDelete }) {
  const table = el('table');
  table.appendChild(el('thead', {}, el('tr', {}, [
    el('th', {}, t('kampfrichter.colDate')), el('th', {}, t('kampfrichter.colCompetition')),
    el('th', {}, t('kampfrichter.colFunction')), el('th', {}, t('kampfrichter.colNote')), el('th', {}, ''),
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
      el('td', {}, a.note || '—'),
      el('td', {}, el('div', { class: 'flex gap-8' }, [
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
  card.appendChild(renderAssignmentTable(assignments, {
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
function renderRefereesOverviewSection(referees, settings, onChanged) {
  const card = el('div', { class: 'card mb-16' }, [el('h3', { class: 'mt-0' }, t('kampfrichter.refereesSection'))]);
  if (referees.length === 0) {
    card.appendChild(emptyState(t('kampfrichter.refereesSection'), t('kampfrichter.noRefereesYet'), null));
    return card;
  }
  const table = el('table');
  table.appendChild(el('thead', {}, el('tr', {}, [
    el('th', {}, t('usermgmt.colName')), el('th', {}, t('usermgmt.colEmail')), el('th', {}, ''),
  ])));
  const tbody = el('tbody');
  referees.forEach((member) => {
    tbody.appendChild(el('tr', {}, [
      el('td', {}, member.name),
      el('td', {}, member.email),
      el('td', {}, el('button', {
        class: 'btn btn-ghost btn-sm',
        onclick: () => openMemberModal(member, settings, onChanged),
      }, t('kampfrichter.manageButton'))),
    ]));
  });
  table.appendChild(tbody);
  card.appendChild(el('div', { class: 'table-wrap' }, table));
  return card;
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
