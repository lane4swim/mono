// Saisonplanung im Kalender: Anlegen/Bearbeiten/Löschen der Einträge im
// Store "calendarEntries" (Ferien, Feiertage, Hallenbadschließungen,
// Trainingslager, regelmäßige Trainingszeiten) sowie die Übersicht aller
// Einträge. Kein eigenes Router-Modul — wird ausschließlich aus
// calendar.js geöffnet (nur für Trainer:innen/Admins, wie
// STORE_PERMISSIONS.calendarEntries in sync.permissions.ts).
import { getAll, put, remove } from '../db.js';
import { el, clear } from '../dom.js';
import { dateOnly, toIsoDateTime, todayISO, fmtDateShort, isoAddDays } from '../dates.js';
import { toast } from '../ui.js';
import { openModal, confirmAction } from '../modal.js';
import { field, textInput, dateInput, selectInput, formActions } from '../forms.js';
import { COURSES } from '../refdata.js';
import { t, trOptions, getLocale } from '../i18n.js';
import { ENTRY_KINDS, CLUB_WIDE_KINDS, PAUSE_KINDS, DEFAULT_PAUSE_DURING, slotDates } from './calendarEvents.js';

const DAY_INDEXES = [0, 1, 2, 3, 4, 5, 6];

function weekdayName(i) {
  // 2024-01-01 war ein Montag (Index 0, wie CalendarEntrySchema.weekdays).
  return new Date(Date.UTC(2024, 0, 1 + i)).toLocaleDateString(getLocale(), { timeZone: 'UTC', weekday: 'short' });
}

function checkboxGroup(options, selected) {
  const chosen = new Set(selected);
  const inputs = options.map(({ value, label }) => {
    const input = el('input', { type: 'checkbox' });
    input.checked = chosen.has(value);
    input.dataset.value = String(value);
    return { input, node: el('label', { class: 'consent-checkbox' }, [input, el('span', {}, label)]) };
  });
  return {
    node: el('div', { class: 'cal-entry-checks' }, inputs.map((i) => i.node)),
    values: () => inputs.filter((i) => i.input.checked).map((i) => i.input.dataset.value),
  };
}

// Öffnet den Dialog für einen neuen (entry ohne id, optional mit
// Vorbelegung, z. B. { kind, startDate }) oder bestehenden Eintrag.
// `onSaved` läuft nach Speichern UND Löschen.
export function openEntryModal(entry, groups, onSaved) {
  const isEdit = !!entry?.id;
  const today = todayISO();
  const data = {
    kind: 'schoolHoliday', title: '', startDate: today, endDate: today, groupId: null,
    weekdays: [], startTime: null, endTime: null, pauseDuring: DEFAULT_PAUSE_DURING, poolLength: null,
    location: '', note: '',
    ...entry,
  };

  const form = el('form', { class: 'form-grid' });
  const fKind = selectInput(ENTRY_KINDS.map((k) => ({ value: k, label: t(`calendar.types.${k}`) })), data.kind, { disabled: isEdit });
  const fTitle = textInput(data.title, { required: true, maxlength: 200 });
  const fStart = dateInput(data.startDate, { required: true });
  const fEnd = dateInput(data.endDate || data.startDate, { required: true });
  const fGroup = selectInput([{ value: '', label: t('calendar.entry.wholeClub') }, ...groups.map((g) => ({ value: g.id, label: g.name }))], data.groupId || '');
  const fLocation = textInput(data.location, { maxlength: 200 });
  const fNote = el('textarea', { maxlength: 2000 }, data.note || '');
  const fStartTime = el('input', { type: 'time', value: data.startTime || '' });
  const fEndTime = el('input', { type: 'time', value: data.endTime || '' });
  const fPool = selectInput([{ value: '', label: t('plans.poolLengthNotSet') }, ...trOptions(COURSES, 'courses')], data.poolLength || '');
  const weekdays = checkboxGroup(DAY_INDEXES.map((i) => ({ value: i, label: weekdayName(i) })), data.weekdays);
  const pauses = checkboxGroup(PAUSE_KINDS.map((k) => ({ value: k, label: t(`calendar.types.${k}`) })), data.pauseDuring);

  const startLabel = el('span');
  const endLabel = el('span');
  const groupField = field(t('calendar.entry.group'), fGroup);
  const slotFields = [
    field(t('calendar.entry.weekdays'), weekdays.node, { span2: true }),
    field(t('calendar.entry.startTime'), fStartTime),
    field(t('calendar.entry.endTime'), fEndTime),
    field(t('calendar.entry.pauseDuring'), pauses.node, { span2: true, hint: t('calendar.entry.pauseHint') }),
    field(t('plans.formPoolLength'), fPool),
  ];

  form.appendChild(field(t('calendar.entry.kind'), fKind));
  form.appendChild(field(t('calendar.entry.title'), fTitle));
  const startField = field('', fStart);
  const endField = field('', fEnd);
  startField.querySelector('label').appendChild(startLabel);
  endField.querySelector('label').appendChild(endLabel);
  form.appendChild(startField);
  form.appendChild(endField);
  form.appendChild(groupField);
  form.appendChild(field(t('calendar.entry.location'), fLocation));
  slotFields.forEach((f) => form.appendChild(f));
  form.appendChild(field(t('calendar.entry.note'), fNote, { span2: true }));

  function syncKind() {
    const kind = fKind.value;
    const slot = kind === 'trainingSlot';
    groupField.style.display = CLUB_WIDE_KINDS.includes(kind) ? 'none' : '';
    slotFields.forEach((f) => { f.style.display = slot ? '' : 'none'; });
    startLabel.textContent = t(slot ? 'calendar.entry.validFrom' : 'calendar.entry.startDate');
    endLabel.textContent = t(slot ? 'calendar.entry.validUntil' : 'calendar.entry.endDate');
    if (!fTitle.value && !isEdit) fTitle.placeholder = t(`calendar.types.${kind}`);
    // Eine Trainingszeit gilt meist eine Saison lang — ein eintägiger
    // Gültigkeitszeitraum (Vorbelegung der übrigen Arten) wäre fast nie gemeint.
    if (slot && !isEdit && fStart.value && fEnd.value === fStart.value) fEnd.value = isoAddDays(fStart.value, 181);
  }
  fKind.addEventListener('change', syncKind);
  // Ende folgt dem Beginn, solange es davor läge — spart bei eintägigen
  // Einträgen (Feiertage) das doppelte Eingeben.
  fStart.addEventListener('change', () => { if (!fEnd.value || fEnd.value < fStart.value) fEnd.value = fStart.value; });
  syncKind();

  const { row } = formActions({ onCancel: () => close(), submitLabel: isEdit ? t('common.save') : t('common.create') });
  if (isEdit) {
    row.insertBefore(el('button', {
      type: 'button', class: 'btn btn-danger', style: 'margin-right:auto',
      onclick: () => confirmAction(t('calendar.entry.deleteConfirm'), async () => {
        await remove('calendarEntries', entry.id);
        toast(t('calendar.entry.deleted'));
        close(); onSaved?.();
      }),
    }, t('common.delete')), row.firstChild);
  }
  form.appendChild(row);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const kind = fKind.value;
    const slot = kind === 'trainingSlot';
    const title = fTitle.value.trim() || t(`calendar.types.${kind}`);
    if (!fStart.value || !fEnd.value) { toast(t('calendar.entry.validationDates'), 'error'); return; }
    if (fEnd.value < fStart.value) { toast(t('calendar.entry.validationOrder'), 'error'); return; }
    const days = weekdays.values().map(Number);
    if (slot && days.length === 0) { toast(t('calendar.entry.validationWeekdays'), 'error'); return; }
    if (slot && slotDates({ startDate: fStart.value, endDate: fEnd.value, weekdays: days }).length === 0) { toast(t('calendar.entry.validationNoDates'), 'error'); return; }
    if (slot && fStartTime.value && fEndTime.value && fEndTime.value <= fStartTime.value) { toast(t('calendar.entry.validationTimes'), 'error'); return; }
    await put('calendarEntries', {
      ...data,
      kind, title,
      startDate: toIsoDateTime(fStart.value),
      endDate: toIsoDateTime(fEnd.value),
      groupId: CLUB_WIDE_KINDS.includes(kind) ? null : (fGroup.value || null),
      weekdays: slot ? days : [],
      startTime: slot ? (fStartTime.value || null) : null,
      endTime: slot ? (fEndTime.value || null) : null,
      pauseDuring: slot ? pauses.values() : [],
      poolLength: slot ? (fPool.value || null) : null,
      location: fLocation.value.trim(),
      note: fNote.value.trim(),
    });
    toast(isEdit ? t('calendar.entry.savedEdit') : t('calendar.entry.savedCreate'));
    close(); onSaved?.();
  });

  const { close } = openModal({ title: t(isEdit ? 'calendar.entry.modalEdit' : 'calendar.entry.modalCreate'), bodyNode: form, wide: true });
}

// Übersicht aller Einträge, nach Art gruppiert — der einzige Weg, eine
// Trainingszeit selbst zu bearbeiten: ein Klick auf einen ihrer Termine im
// Kalender öffnet bzw. legt den Trainingsplan dieses Tages an.
export async function openEntryList(onChanged) {
  const body = el('div', { class: 'cal-entry-list' });
  const { close } = openModal({ title: t('calendar.entry.listTitle'), bodyNode: body, wide: true });

  async function draw() {
    const [entries, groups] = await Promise.all([getAll('calendarEntries'), getAll('groups')]);
    const groupName = new Map(groups.map((g) => [g.id, g.name]));
    clear(body);
    body.appendChild(el('div', { class: 'flex gap-8 mb-16' }, [
      el('button', { type: 'button', class: 'btn btn-primary', onclick: () => openEntryModal(null, groups, changed) }, t('calendar.entry.add')),
    ]));
    if (entries.length === 0) { body.appendChild(el('p', {}, t('calendar.entry.listEmpty'))); return; }
    for (const kind of ENTRY_KINDS) {
      const list = entries.filter((e) => e.kind === kind).sort((a, b) => dateOnly(a.startDate).localeCompare(dateOnly(b.startDate)));
      if (list.length === 0) continue;
      body.appendChild(el('h4', { class: `cal-entry-list-head cal-type-${kind}` }, t(`calendar.types.${kind}`)));
      for (const entry of list) {
        const start = dateOnly(entry.startDate);
        const end = dateOnly(entry.endDate || entry.startDate);
        const when = end > start ? `${fmtDateShort(start)} – ${fmtDateShort(end)}` : fmtDateShort(start);
        const slotInfo = kind === 'trainingSlot'
          ? [(entry.weekdays || []).map(weekdayName).join(', '), [entry.startTime, entry.endTime].filter(Boolean).join('–')].filter(Boolean).join(' · ')
          : '';
        body.appendChild(el('button', {
          type: 'button', class: `cal-chip cal-type-${kind} cal-entry-row`,
          onclick: () => openEntryModal(entry, groups, changed),
        }, el('span', { class: 'cal-chip-text' }, [
          el('span', { class: 'cal-chip-title' }, entry.title),
          el('span', { class: 'cal-chip-detail' }, [when, slotInfo, groupName.get(entry.groupId), entry.location].filter(Boolean).join(' · ')),
        ])));
      }
    }
  }

  // Der Bearbeiten-Dialog ersetzt das Listen-Modal (es gibt nur einen
  // Modal-Slot) — nach dem Speichern die Liste neu öffnen.
  function changed() { onChanged?.(); openEntryList(onChanged); }
  await draw();
  return { close };
}
