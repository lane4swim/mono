// ============================================================
// modules/qualifications.js — Qualifikationsmanagement (docs/
// nutzer-qualifikationen-plan.md). Zubuchbares Modul (siehe Abschnitt 1.2)
// — erscheint nur, wenn der Verein 'qualifications' gebucht hat.
//
// Rollenabhängige Ansicht statt zweier Einstiegspunkte (siehe Plan,
// Abschnitt 4.1): jede Person sieht immer die eigene, schreibgeschützte
// Liste; `admin` sieht zusätzlich alle Mitglieder samt Verwaltung sowie die
// Einstellungen für die Erinnerungs-Schwellen je Qualifikationstyp.
// ============================================================
import { el, clear, beginRender } from '../dom.js';
import { fmtDateShort, dateOnly, toIsoDateTime, todayISO } from '../dates.js';
import { badge, laneWave, toast } from '../ui.js';
import { openModal, confirmAction } from '../modal.js';
import { field, textInput, selectInput, dateInput, formActions } from '../forms.js';
import { isAdmin } from '../state.js';
import { QUALIFICATION_TYPES } from '../refdata.js';
import { t, trLabel } from '../i18n.js';
import * as api from '../apiClient.js';
import { describeError } from '../apiClient.js';

export const qualificationsModule = {
  id: 'qualifications',
  roles: ['admin', 'trainer', 'athlete'],
  icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 2l2.5 5.5L20 8.5l-4 4 1 6-5-3-5 3 1-6-4-4 5.5-1z"/></svg>`,
  async render(container) {
    const isCurrent = beginRender(container);
    clear(container);
    try {
      const admin = isAdmin();
      // listQualificationSettings() ist lesend für JEDE Rolle erreichbar
      // (siehe qualifications.route.ts) — auch trainer/athlete brauchen die
      // konfigurierten Schwellen, um den Status-Badge der eigenen
      // Qualifikationen unten korrekt zu berechnen (thresholdsFor()).
      // listClubMembers() bleibt dagegen admin-only, daher weiterhin ein
      // separater Zweig statt eines gemeinsamen Promise.all() mit allen drei
      // Aufrufen.
      const [own, settings] = await Promise.all([api.listMyQualifications(), api.listQualificationSettings()]);
      let members = [];
      if (admin) {
        members = (await api.listClubMembers()).users;
      }
      if (!isCurrent()) return;
      renderView(container, admin, own.qualifications, members, settings);
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

// ---- Statusermittlung (Plan, Abschnitt 4.2) ----------------------------
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function daysUntil(dateStr, now) {
  return Math.ceil((new Date(dateOnly(dateStr) + 'T00:00:00').getTime() - now.getTime()) / MS_PER_DAY);
}

// `thresholds`: aufsteigend sortierte Tage-Werte (z. B. [14, 60]) — die
// GRÖSSTE davon markiert den Übergang von "gültig" zu "läuft bald ab".
function statusOf(qualification, thresholds, now = new Date()) {
  if (!qualification.expiresOn) return { key: 'unlimited', variant: 'neutral' };
  const remaining = daysUntil(qualification.expiresOn, now);
  const renewalScheduled = qualification.renewalCourseOrganizedOn && daysUntil(qualification.renewalCourseOrganizedOn, now) >= 0;
  const maxThreshold = thresholds.length ? Math.max(...thresholds) : 0;
  if (remaining < 0) {
    return renewalScheduled ? { key: 'scheduled', variant: 'scheduled' } : { key: 'expired', variant: 'open' };
  }
  if (remaining <= maxThreshold) {
    return renewalScheduled ? { key: 'scheduled', variant: 'scheduled' } : { key: 'soon', variant: 'progress' };
  }
  return { key: 'valid', variant: 'done' };
}

function statusBadge(qualification, thresholds) {
  const status = statusOf(qualification, thresholds);
  if (status.key === 'scheduled') {
    return badge(t('qualifications.statusScheduled', { date: fmtDateShort(qualification.renewalCourseOrganizedOn) }), status.variant);
  }
  return badge(t(`qualifications.status_${status.key}`), status.variant);
}

function thresholdsFor(type, settings) {
  const row = settings.settings.find((s) => s.type === type);
  return row ? row.thresholdsDays : settings.defaultThresholdsDays;
}

function typeLabel(type) {
  return trLabel(QUALIFICATION_TYPES, type, 'qualificationTypes');
}

// ---- Gesamtansicht -------------------------------------------------------
function renderView(container, admin, own, members, settings) {
  const wrap = el('div');
  wrap.appendChild(el('div', { class: 'page-head' }, [
    el('div', {}, [el('div', { class: 'page-eyebrow' }, t('qualifications.eyebrow')), el('h1', { class: 'mt-0' }, t('qualifications.title'))]),
  ]));
  wrap.appendChild(laneWave());
  wrap.appendChild(el('p', {}, admin ? t('qualifications.introAdmin') : t('qualifications.introSelf')));

  wrap.appendChild(renderOwnSection(own, settings, admin));
  if (admin) {
    wrap.appendChild(renderMembersSection(members, settings, refresh));
    wrap.appendChild(renderSettingsSection(settings, refresh));
  }

  container.appendChild(wrap);

  async function refresh() {
    const isCurrent = beginRender(container);
    clear(container);
    try {
      const [ownData, membersData, settingsData] = await Promise.all([
        api.listMyQualifications(),
        admin ? api.listClubMembers() : Promise.resolve({ users: [] }),
        api.listQualificationSettings(),
      ]);
      if (!isCurrent()) return;
      renderView(container, admin, ownData.qualifications, membersData.users, settingsData);
    } catch (err) {
      if (!isCurrent()) return;
      renderError(container, err);
    }
  }
}

// ---- Eigene, schreibgeschützte Liste (jede Rolle) -----------------------
function renderOwnSection(own, settings, admin) {
  const card = el('div', { class: 'card mb-16' }, [el('h3', { class: 'mt-0' }, t('qualifications.ownSection'))]);
  if (own.length === 0) {
    card.appendChild(el('p', {}, t('qualifications.noneYetOwn')));
    return card;
  }
  card.appendChild(renderQualificationTable(own, settings, { editable: false }));
  if (admin) card.appendChild(el('p', { class: 'hint', style: 'margin-top:8px' }, t('qualifications.ownEditHint')));
  return card;
}

function renderQualificationTable(rows, settings, { editable, onEdit, onDelete } = {}) {
  const table = el('table');
  const headCells = [
    el('th', {}, t('qualifications.colType')), el('th', {}, t('qualifications.colAcquired')),
    el('th', {}, t('qualifications.colExpires')), el('th', {}, t('qualifications.colStatus')),
    el('th', {}, t('qualifications.colNote')),
  ];
  if (editable) headCells.push(el('th', {}, ''));
  table.appendChild(el('thead', {}, el('tr', {}, headCells)));
  const tbody = el('tbody');
  rows.slice().sort((a, b) => (b.acquiredOn || '').localeCompare(a.acquiredOn || '')).forEach((q) => {
    const cells = [
      el('td', {}, typeLabel(q.type)),
      el('td', {}, fmtDateShort(dateOnly(q.acquiredOn))),
      el('td', {}, q.expiresOn ? fmtDateShort(dateOnly(q.expiresOn)) : '—'),
      el('td', {}, statusBadge(q, thresholdsFor(q.type, settings))),
      el('td', {}, q.note || '—'),
    ];
    if (editable) {
      cells.push(el('td', {}, el('div', { class: 'flex gap-8' }, [
        el('button', { class: 'btn btn-ghost btn-sm', onclick: () => onEdit(q) }, t('common.edit')),
        el('button', { class: 'btn btn-danger btn-sm', onclick: () => onDelete(q) }, t('common.delete')),
      ])));
    }
    tbody.appendChild(el('tr', {}, cells));
  });
  table.appendChild(tbody);
  return el('div', { class: 'table-wrap' }, table);
}

// ---- Mitgliederverwaltung (nur admin) -----------------------------------
function renderMembersSection(members, settings, onChanged) {
  const card = el('div', { class: 'card mb-16' }, [el('h3', { class: 'mt-0' }, t('qualifications.membersSection'))]);
  if (members.length === 0) {
    card.appendChild(el('p', {}, t('usermgmt.noMembersYet')));
    return card;
  }
  const table = el('table');
  table.appendChild(el('thead', {}, el('tr', {}, [
    el('th', {}, t('usermgmt.colName')), el('th', {}, t('usermgmt.colRole')), el('th', {}, ''),
  ])));
  const tbody = el('tbody');
  members.forEach((member) => {
    tbody.appendChild(el('tr', {}, [
      el('td', {}, member.name),
      el('td', {}, el('div', { class: 'flex gap-8' }, member.roles.map((r) => badge(t(`settings.role_${r}`), 'neutral')))),
      el('td', {}, el('button', {
        class: 'btn btn-ghost btn-sm',
        onclick: () => openMemberQualificationsModal(member, settings, onChanged),
      }, t('qualifications.manageButton'))),
    ]));
  });
  table.appendChild(tbody);
  card.appendChild(el('div', { class: 'table-wrap' }, table));
  return card;
}

function openMemberQualificationsModal(member, settings, onChanged) {
  const body = el('div', {}, el('p', {}, t('common.loading')));
  const { close } = openModal({ title: t('qualifications.membersModalTitle', { name: member.name }), bodyNode: body, wide: true });

  function draw(rows) {
    clear(body);
    body.appendChild(el('div', { class: 'flex justify-between items-center mb-16' }, [
      el('span', {}, ''),
      el('button', {
        class: 'btn btn-primary btn-sm',
        onclick: () => openQualificationFormModal(member, null, () => reload()),
      }, t('qualifications.addButton')),
    ]));
    if (rows.length === 0) {
      body.appendChild(el('p', {}, t('qualifications.noneYet')));
      return;
    }
    body.appendChild(renderQualificationTable(rows, settings, {
      editable: true,
      onEdit: (q) => openQualificationFormModal(member, q, () => reload()),
      onDelete: (q) => confirmAction(t('qualifications.deleteConfirm'), async () => {
        try {
          await api.deleteQualification(member.id, q.id);
          toast(t('qualifications.deleted'));
          reload();
        } catch (err) {
          toast(describeError(err), 'error');
        }
      }),
    }));
  }

  function reload() {
    api.listMemberQualifications(member.id)
      .then((resp) => { draw(resp.qualifications); onChanged?.(); })
      .catch((err) => { clear(body); body.appendChild(el('p', { class: 'form-error' }, describeError(err))); });
  }

  reload();
  return close;
}

function openQualificationFormModal(member, existing, onSaved) {
  const isEdit = !!existing;
  const form = el('form', { class: 'form-grid' });
  const fType = selectInput(QUALIFICATION_TYPES.map((qt) => ({ value: qt.value, label: typeLabel(qt.value) })), existing?.type || QUALIFICATION_TYPES[0].value);
  const fAcquired = dateInput(existing?.acquiredOn || todayISO());
  const fExpires = dateInput(existing?.expiresOn || '');
  const fRenewal = dateInput(existing?.renewalCourseOrganizedOn || '');
  const fNote = textInput(existing?.note || '');
  form.appendChild(field(t('qualifications.formType'), fType));
  form.appendChild(field(t('qualifications.formAcquiredOn'), fAcquired));
  form.appendChild(field(t('qualifications.formExpiresOn'), fExpires, { hint: t('qualifications.formExpiresOnHint') }));
  form.appendChild(field(t('qualifications.formRenewalCourseOrganizedOn'), fRenewal, { hint: t('qualifications.formRenewalCourseOrganizedOnHint'), span2: true }));
  form.appendChild(field(t('qualifications.formNote'), fNote, { span2: true }));
  const errorBox = el('p', { class: 'form-error', style: 'grid-column:1/-1;display:none' });
  form.appendChild(errorBox);
  const { row: actionsRow, submitBtn } = formActions({ onCancel: () => close(), submitLabel: isEdit ? t('common.save') : t('common.create') });
  form.appendChild(actionsRow);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorBox.style.display = 'none';
    if (!fAcquired.value) { toast(t('qualifications.validationAcquiredOn'), 'error'); return; }
    submitBtn.disabled = true;
    try {
      const payload = {
        type: fType.value,
        note: fNote.value.trim(),
        acquiredOn: toIsoDateTime(fAcquired.value),
        expiresOn: fExpires.value ? toIsoDateTime(fExpires.value) : null,
        renewalCourseOrganizedOn: fRenewal.value ? toIsoDateTime(fRenewal.value) : null,
      };
      if (isEdit) await api.updateQualification(member.id, existing.id, payload);
      else await api.createQualification(member.id, payload);
      toast(isEdit ? t('qualifications.savedEdit') : t('qualifications.savedCreate'));
      close();
      onSaved?.();
    } catch (err) {
      errorBox.textContent = describeError(err);
      errorBox.style.display = 'block';
    } finally {
      submitBtn.disabled = false;
    }
  });
  const { close } = openModal({
    title: isEdit ? t('qualifications.modalEditTitle') : t('qualifications.modalCreateTitle', { name: member.name }),
    bodyNode: form,
    wide: true,
  });
}

// ---- Einstellungen: Erinnerungs-Schwellen je Typ (nur admin) ------------
function renderSettingsSection(settings, onChanged) {
  const card = el('div', { class: 'card mb-16' }, [
    el('h3', { class: 'mt-0' }, t('qualifications.settingsSection')),
    el('p', { class: 'hint' }, t('qualifications.settingsHint')),
  ]);
  const table = el('table');
  table.appendChild(el('thead', {}, el('tr', {}, [
    el('th', {}, t('qualifications.colType')), el('th', {}, t('qualifications.formThresholds')), el('th', {}, ''),
  ])));
  const tbody = el('tbody');
  QUALIFICATION_TYPES.forEach((qt) => {
    const configured = settings.settings.find((s) => s.type === qt.value);
    const isDefault = !configured;
    const values = configured ? configured.thresholdsDays : settings.defaultThresholdsDays;
    const input = textInput(values.join(', '), { style: 'width:160px' });
    const saveBtn = el('button', { class: 'btn btn-ghost btn-sm', onclick: async () => {
      const parsed = input.value.split(',').map((v) => parseInt(v.trim(), 10)).filter((n) => Number.isInteger(n) && n > 0);
      if (parsed.length === 0) { toast(t('qualifications.validationThresholds'), 'error'); return; }
      try {
        await api.setQualificationSetting(qt.value, parsed);
        toast(t('qualifications.settingsSaved'));
        onChanged?.();
      } catch (err) {
        toast(describeError(err), 'error');
      }
    } }, t('common.save'));
    tbody.appendChild(el('tr', {}, [
      el('td', {}, typeLabel(qt.value)),
      el('td', {}, [input, isDefault ? el('div', { class: 'hint' }, t('qualifications.settingsDefaultNote')) : null]),
      el('td', {}, saveBtn),
    ]));
  });
  table.appendChild(tbody);
  card.appendChild(el('div', { class: 'table-wrap' }, table));
  return card;
}
