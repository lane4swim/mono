// ============================================================
// modules/profile.js — "Mein Profil" / "My Profile"
//
// Lets the currently signed-in account (trainer, admin, or athlete)
// change their own personal data — name and email — plus their
// preferred display language (same setting as the topbar dropdown,
// surfaced here too since it's naturally "my personal data").
//
// Deliberately NOT restricted via `roles` on the module: every role
// should be able to manage their own account. Athlete master-data
// (birthdate, group, notes, …) is intentionally out of scope here —
// that remains coach-managed under "Athleten & Team", since it
// reflects team/roster decisions rather than personal account info.
// ============================================================
import { getAll, put, remove } from '../db.js';
import { el, clear, field, textInput, toast, laneWave, badge, fullName, beginRender, confirmAction, openModal } from '../utils.js';
import { getCurrentUser, updateProfile, setUserLocale } from '../state.js';
import { t, getLocale, getAvailableLocales } from '../i18n.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const profileModule = {
  id: 'profile',
  icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="8" r="3.6"/><path d="M4.5 20c0-4.1 3.4-7 7.5-7s7.5 2.9 7.5 7"/><path d="M18.5 5.5l1.4 1.4M20 4l-1.5 1.5" opacity=".6"/></svg>`,
  async render(container) {
    const isCurrent = beginRender(container);
    clear(container);
    const [athletes, results, entries, actionItems, sessions] = await Promise.all(
      ['athletes', 'results', 'entries', 'actionItems', 'sessions'].map(getAll)
    );
    if (!isCurrent()) return;
    renderView(container, athletes, results, entries, actionItems, sessions);
  }
};

// Sammelt alle Daten, die zum aktuellen Konto gehören — analog zur
// Vorschau, die das Backend künftig unter GET /api/me/export liefert
// (Art. 15 DSGVO, Recht auf Auskunft). Athlet:innen-spezifische Daten
// (Ergebnisse, Startlisteneinträge, Handlungsfelder, Anwesenheit) werden
// nur eingeschlossen, wenn das Konto über athleteId mit einem
// Athletenprofil verknüpft ist.
function collectMyData(user, athletes, results, entries, actionItems, sessions) {
  const linkedAthlete = user.athleteId ? athletes.find(a => a.id === user.athleteId) || null : null;
  const myResults = linkedAthlete ? results.filter(r => r.athleteId === linkedAthlete.id) : [];
  const myEntries = linkedAthlete ? entries.filter(e => e.athleteId === linkedAthlete.id) : [];
  const myActionItems = linkedAthlete ? actionItems.filter(a => a.athleteId === linkedAthlete.id) : [];
  const myAttendance = [];
  if (linkedAthlete) {
    sessions.forEach(s => {
      const rec = (s.attendance || []).find(a => a.athleteId === linkedAthlete.id);
      if (rec) myAttendance.push({ sessionId: s.id, date: s.date, ...rec });
    });
  }
  return {
    exportedAt: new Date().toISOString(),
    format: 'lane1-user-data-export-v1',
    user,
    athlete: linkedAthlete,
    results: myResults,
    entries: myEntries,
    actionItems: myActionItems,
    attendance: myAttendance,
  };
}

function downloadJSON(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function renderView(container, athletes, results, entries, actionItems, sessions) {
  const user = getCurrentUser();
  const wrap = el('div');
  wrap.appendChild(el('div', { class: 'page-head' }, [
    el('div', {}, [el('div', { class: 'page-eyebrow' }, t('profile.eyebrow')), el('h1', { class: 'mt-0' }, t('profile.title'))]),
  ]));
  wrap.appendChild(laneWave());

  if (!user) { container.appendChild(wrap); return; }

  const linkedAthlete = user.athleteId ? athletes.find(a => a.id === user.athleteId) : null;

  // ---- Personal data form ----
  const card = el('div', { class: 'card mb-16' }, [el('h3', { class: 'mt-0' }, t('profile.accountSection'))]);
  const form = el('form', { class: 'form-grid' });
  const fName = textInput(user.name || '', { required: true });
  const fEmail = textInput(user.email || '', { type: 'email', required: true });
  form.appendChild(field(t('profile.formName'), fName, { span2: true }));
  form.appendChild(field(t('profile.formEmail'), fEmail, { span2: true }));

  const roleRow = el('div', { class: 'field span-2' }, [
    el('label', {}, t('profile.roleLabel')),
    el('div', {}, badge(t(`settings.role_${user.role}`), 'neutral')),
  ]);
  form.appendChild(roleRow);

  const athleteRow = el('div', { class: 'field span-2' }, [
    el('label', {}, t('profile.linkedAthlete')),
    el('div', {}, linkedAthlete ? el('span', {}, fullName(linkedAthlete)) : el('span', { class: 'text-slate text-sm' }, t('profile.noLinkedAthlete'))),
    linkedAthlete ? el('div', { class: 'hint' }, t('profile.linkedAthleteNote')) : null,
  ].filter(Boolean));
  form.appendChild(athleteRow);

  form.appendChild(el('div', { class: 'form-actions', style: 'grid-column:1/-1' }, [
    el('button', { type: 'submit', class: 'btn btn-primary' }, t('common.save')),
  ]));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = fName.value.trim(), email = fEmail.value.trim();
    if (!name) { toast(t('profile.validationName'), 'error'); return; }
    if (!EMAIL_RE.test(email)) { toast(t('profile.validationEmail'), 'error'); return; }
    await updateProfile({ name, email });
    toast(t('profile.saved'));
  });

  card.appendChild(form);
  wrap.appendChild(card);

  // ---- Language preference ----
  const langCard = el('div', { class: 'card' }, [
    el('h3', { class: 'mt-0' }, t('profile.languageSectionTitle')),
    el('p', { class: 'text-sm' }, t('profile.languageSectionHint')),
  ]);
  const langButtons = el('div', { class: 'pill-group' });
  getAvailableLocales().forEach(loc => {
    const isActive = loc.code === getLocale();
    const pill = el('button', {
      type: 'button',
      class: `pill ${isActive ? 'active' : ''}`,
      onclick: async () => { await setUserLocale(loc.code); },
    }, `${loc.flag} ${loc.label}`);
    langButtons.appendChild(pill);
  });
  langCard.appendChild(langButtons);
  wrap.appendChild(langCard);

  // ---- Meine Daten: Auskunft (Export) & Löschung (Art. 15 + 17 DSGVO) ----
  const dataCard = el('div', { class: 'card' }, [el('h3', { class: 'mt-0' }, t('profileData.section'))]);
  const exportBtn = el('button', {
    class: 'btn btn-ghost',
    onclick: () => {
      const bundle = collectMyData(user, athletes, results, entries, actionItems, sessions);
      downloadJSON(`lane1-meine-daten-${user.id}-${new Date().toISOString().slice(0, 10)}.json`, bundle);
      toast(t('profileData.exportStarted'));
    },
  }, t('profileData.exportButton'));

  const deleteBtn = el('button', { class: 'btn btn-danger', onclick: () => openDeleteAccountModal(user, athletes) }, t('profileData.deleteButton'));

  dataCard.appendChild(el('div', { class: 'flex gap-8', style: 'flex-wrap:wrap' }, [exportBtn, deleteBtn]));
  dataCard.appendChild(el('p', { class: 'hint', style: 'margin-top:12px' }, t('profileData.serverDeletionNote')));
  wrap.appendChild(dataCard);

  container.appendChild(wrap);
}

// Löscht das eigene Konto sowie alle damit verbundenen fachlichen Daten
// unwiderruflich aus IndexedDB — verlangt zur Bestätigung die exakte
// Eingabe von "LÖSCHEN"/"DELETE" (stärker als das einfache confirmAction()-
// Muster, da diese Aktion nicht rückgängig gemacht werden kann). Meldet den
// aktuellen Nutzer danach ab, indem die Seite neu geladen wird — initSession()
// wählt beim nächsten Start automatisch ein verbleibendes Konto.
function openDeleteAccountModal(user, athletes) {
  const body = el('div');
  body.appendChild(el('p', {}, t('profileData.deleteIntro')));
  body.appendChild(el('p', { class: 'form-error', style: 'font-weight:600' }, t('profileData.serverDeletionWarning')));
  body.appendChild(el('p', { class: 'text-sm' }, t('profileData.deleteConfirmPrompt')));
  const confirmInput = textInput('', { placeholder: t('profileData.deleteConfirmWord') });
  body.appendChild(confirmInput);
  const confirmDeleteBtn = el('button', { class: 'btn btn-danger', style: 'margin-top:16px', onclick: async () => {
    if (confirmInput.value.trim().toUpperCase() !== t('profileData.deleteConfirmWord').toUpperCase()) {
      toast(t('profileData.deleteConfirmMismatch'), 'error');
      return;
    }
    await eraseMyAccountAndData(user, athletes);
    toast(t('profileData.deleted'));
    close();
    // Abmelden statt nur neu zu laden: das Konto besteht serverseitig
    // weiterhin (siehe serverDeletionWarning) — ohne Logout würde ein
    // nachfolgender Sync-Pull die eben lokal gelöschten Daten sofort
    // wieder vom Server herunterladen.
    const { logout } = await import('../state.js');
    await logout();
    setTimeout(() => location.reload(), 600);
  } }, t('profileData.deleteButtonConfirm'));
  body.appendChild(el('div', { class: 'form-actions' }, [
    el('button', { class: 'btn btn-ghost', onclick: () => close() }, t('common.cancel')),
    confirmDeleteBtn,
  ]));
  const { close } = openModal({ title: t('profileData.deleteButton'), bodyNode: body, wide: true });
}

// Entfernt: eigenen Nutzer-Datensatz, verknüpftes Athletenprofil (falls
// vorhanden) sowie dessen Ergebnisse/Startlisteneinträge/Handlungsfelder,
// und streicht die eigenen Anwesenheitseinträge aus allen Trainingseinheiten
// (statt die ganze Einheit zu löschen, da sie auch andere Athlet:innen
// betrifft).
async function eraseMyAccountAndData(user, athletes) {
  const linkedAthlete = user.athleteId ? athletes.find(a => a.id === user.athleteId) : null;

  if (linkedAthlete) {
    const [results, entries, actionItems, sessions] = await Promise.all(
      ['results', 'entries', 'actionItems', 'sessions'].map(getAll)
    );
    for (const r of results.filter(x => x.athleteId === linkedAthlete.id)) await remove('results', r.id);
    for (const e of entries.filter(x => x.athleteId === linkedAthlete.id)) await remove('entries', e.id);
    for (const a of actionItems.filter(x => x.athleteId === linkedAthlete.id)) await remove('actionItems', a.id);
    for (const s of sessions) {
      const filtered = (s.attendance || []).filter(a => a.athleteId !== linkedAthlete.id);
      if (filtered.length !== (s.attendance || []).length) {
        await put('sessions', { ...s, attendance: filtered });
      }
    }
    await remove('athletes', linkedAthlete.id);
  }

  await remove('users', user.id);
}
