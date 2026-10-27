// Kampfgericht eines Wettkampfs: wie viele Kampfrichter:innen der Verein
// laut Ausschreibung stellen muss (Competition.refereesRequired) und wer
// dafür eingeteilt ist.
//
// Die Anzahl wird immer von Hand im Wettkampf-Formular erfasst — die
// DSV7-/DSV8-Wettkampfdefinitionsliste hat dafür kein Element (siehe
// resultsImport/dsv7DefinitionParser.js). Die Einteilung sind gewöhnliche
// Wettkampfeinsätze des Kampfrichter-Moduls (modules/kampfrichter.js), die
// per competitionId auf diesen Wettkampf verweisen; admin-seitig angelegt
// starten sie als Anfrage, die die Kampfrichter:in zu- oder absagt.
// Einteilen kann nur admin, und nur mit gebuchtem Kampfrichter-Modul
// (REST-Endpunkte, daher nicht in der Demo); alle anderen sehen nur die
// Vorgabe.
import { el } from '../dom.js';
import { toIsoDateTime } from '../dates.js';
import { toast, badge } from '../ui.js';
import { openModal, confirmAction } from '../modal.js';
import { field, textInput, selectInput, formActions } from '../forms.js';
import { isAdmin, getEnabledModules } from '../state.js';
import { REFEREE_FUNCTIONS } from '../refdata.js';
import { t, trLabel } from '../i18n.js';
import * as api from '../apiClient.js';
import { describeError } from '../apiClient.js';
import { IS_DEMO } from '../demoMode.js';
import { assignmentStatusBadge } from './kampfrichter.js';

export const MAX_REFEREES_REQUIRED = 99;

// Formularwert -> gespeicherter Wert: leer = keine Vorgabe (null), sonst
// eine ganze Zahl 0..MAX_REFEREES_REQUIRED; undefined bei ungültiger
// Eingabe.
export function parseRefereesRequired(value) {
  const trimmed = String(value ?? '').trim();
  if (trimmed === '') return null;
  if (!/^\d+$/.test(trimmed)) return undefined;
  const n = Number(trimmed);
  return n <= MAX_REFEREES_REQUIRED ? n : undefined;
}

// Abgesagte Einsätze zählen nicht; offene Anfragen getrennt von Zusagen,
// damit "voll besetzt" erst gilt, wenn genug zugesagt haben.
export function refereeStaffing(required, assignments) {
  const confirmed = assignments.filter((a) => a.status === 'confirmed').length;
  const requested = assignments.filter((a) => a.status === 'requested').length;
  const declined = assignments.filter((a) => a.status === 'declined').length;
  const hasTarget = required != null;
  return {
    required: hasTarget ? required : null,
    confirmed,
    requested,
    declined,
    missing: hasTarget ? Math.max(0, required - confirmed - requested) : 0,
    complete: hasTarget && confirmed >= required,
  };
}

export function canAssignReferees() {
  return !IS_DEMO && isAdmin() && getEnabledModules().includes('kampfrichter');
}

function functionLabel(fn) {
  return trLabel(REFEREE_FUNCTIONS, fn, 'refereeFunctions');
}

function staffingBadges(staffing) {
  const { required, confirmed, requested, declined, missing, complete } = staffing;
  return el('div', { class: 'pill-group' }, [
    required != null
      ? badge(t('competitions.refereesConfirmedOf', { confirmed, required }), complete ? 'done' : 'open')
      : badge(t('kampfrichter.countConfirmed', { count: confirmed }), 'neutral'),
    requested ? badge(t('kampfrichter.countRequested', { count: requested }), 'progress') : null,
    declined ? badge(t('kampfrichter.countDeclined', { count: declined }), 'neutral') : null,
    missing ? badge(t('competitions.refereesMissing', { count: missing }), 'open') : null,
  ]);
}

// Karte für die Wettkampf-Detailseite, oder null, wenn es nichts zu zeigen
// gibt (keine Vorgabe und keine Einteilungsmöglichkeit).
export function competitionRefereesCard(comp) {
  const required = comp.refereesRequired ?? null;
  const canAssign = canAssignReferees();
  if (required == null && !canAssign) return null;

  const card = el('div', { class: 'card' });
  const head = el('div', { class: 'flex justify-between items-center mb-16' }, [
    el('h3', { class: 'mt-0' }, t('competitions.refereesTitle')),
  ]);
  card.appendChild(head);
  const body = el('div');
  card.appendChild(body);

  if (!canAssign) {
    body.appendChild(el('p', {}, t('competitions.refereesRequiredInfo', { count: required })));
    return card;
  }

  let members = null;
  const assignBtn = el('button', { class: 'btn btn-accent btn-sm', onclick: () => openAssignModal(comp, members || [], load) }, t('competitions.refereesAssign'));
  assignBtn.disabled = true;
  head.appendChild(assignBtn);
  body.appendChild(el('p', {}, t('common.loading')));

  async function load() {
    try {
      const [membersResp, assignmentsResp] = await Promise.all([
        members ? Promise.resolve({ users: members }) : api.listClubMembers(),
        api.listCompetitionRefereeAssignments(comp.id),
      ]);
      members = membersResp.users;
      assignBtn.disabled = false;
      draw(assignmentsResp.assignments);
    } catch (err) {
      body.replaceChildren(el('p', { class: 'form-error' }, describeError(err)));
    }
  }

  function draw(assignments) {
    const names = new Map(members.map((m) => [m.id, m.name]));
    body.replaceChildren();
    body.appendChild(staffingBadges(refereeStaffing(required, assignments)));
    if (required == null) body.appendChild(el('p', { class: 'hint' }, t('competitions.refereesNoTarget')));
    if (assignments.length === 0) {
      body.appendChild(el('p', {}, t('competitions.refereesNone')));
      return;
    }
    const table = el('table');
    table.appendChild(el('thead', {}, el('tr', {}, [
      el('th', {}, t('usermgmt.colName')), el('th', {}, t('kampfrichter.colFunction')),
      el('th', {}, t('kampfrichter.colStatus')), el('th', {}, t('kampfrichter.colNote')), el('th', {}, ''),
    ])));
    const tbody = el('tbody');
    assignments.forEach((a) => {
      tbody.appendChild(el('tr', {}, [
        el('td', {}, names.get(a.userId) || '—'),
        el('td', {}, functionLabel(a.function)),
        el('td', {}, [
          assignmentStatusBadge(a),
          a.responseNote ? el('div', { class: 'text-sm text-slate', style: 'margin-top:3px' }, `„${a.responseNote}“`) : null,
        ]),
        el('td', {}, a.note || '—'),
        el('td', {}, el('button', {
          class: 'btn btn-danger btn-sm',
          onclick: () => confirmAction(t('competitions.refereesRemoveConfirm'), async () => {
            try {
              await api.deleteMemberRefereeAssignment(a.userId, a.id);
              toast(t('kampfrichter.deleted'));
              load();
            } catch (err) {
              toast(describeError(err), 'error');
            }
          }),
        }, t('common.remove'))),
      ]));
    });
    table.appendChild(tbody);
    body.appendChild(el('div', { class: 'table-wrap', style: 'margin-top:12px' }, table));
  }

  load();
  return card;
}

function openAssignModal(comp, members, onSaved) {
  const referees = members.filter((m) => m.roles.includes('referee'));
  const form = el('form', { class: 'form-grid' });
  if (referees.length === 0) {
    form.appendChild(el('p', { style: 'grid-column:1/-1' }, t('kampfrichter.noRefereesYet')));
    form.appendChild(formActions({ onCancel: () => close(), submitLabel: t('common.close') }).row);
    form.addEventListener('submit', (e) => { e.preventDefault(); close(); });
    const { close } = openModal({ title: t('competitions.refereesAssignTitle', { name: comp.name }), bodyNode: form });
    return;
  }
  const fReferee = selectInput(referees.map((m) => ({ value: m.id, label: m.name })), referees[0].id);
  const fFunction = selectInput(REFEREE_FUNCTIONS.map((rf) => ({ value: rf.value, label: functionLabel(rf.value) })), REFEREE_FUNCTIONS[0].value);
  const fNote = textInput('', { maxlength: 500 });
  form.appendChild(field(t('competitions.refereesFormPerson'), fReferee, { span2: true }));
  form.appendChild(field(t('kampfrichter.formFunction'), fFunction));
  form.appendChild(field(t('kampfrichter.formNote'), fNote));
  form.appendChild(el('p', { class: 'hint', style: 'grid-column:1/-1' }, t('competitions.refereesAssignHint')));
  const errorBox = el('p', { class: 'form-error', style: 'grid-column:1/-1;display:none' });
  form.appendChild(errorBox);
  const { row, submitBtn } = formActions({ onCancel: () => close(), submitLabel: t('competitions.refereesAssignSubmit') });
  form.appendChild(row);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorBox.style.display = 'none';
    submitBtn.disabled = true;
    try {
      await api.createMemberRefereeAssignment(fReferee.value, {
        competitionName: comp.name.slice(0, 200),
        competitionPlace: (comp.location || '').slice(0, 300),
        competitionId: comp.id,
        date: toIsoDateTime(comp.date),
        function: fFunction.value,
        note: fNote.value.trim(),
      });
      toast(t('competitions.refereesAssigned'));
      close();
      onSaved?.();
    } catch (err) {
      errorBox.textContent = describeError(err);
      errorBox.style.display = 'block';
    } finally {
      submitBtn.disabled = false;
    }
  });
  const { close } = openModal({ title: t('competitions.refereesAssignTitle', { name: comp.name }), bodyNode: form, wide: true });
}
