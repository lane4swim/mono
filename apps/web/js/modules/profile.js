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
import { getCurrentUser, updateProfile, setUserLocale, logout } from '../state.js';
import * as api from '../apiClient.js';
import { ApiError, NetworkError } from '../apiClient.js';
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
    onclick: async () => {
      try {
        const bundle = await api.exportMyData();
        downloadJSON(`lane1-meine-daten-${user.id}-${new Date().toISOString().slice(0, 10)}.json`, bundle);
        toast(t('profileData.exportStarted'));
      } catch (err) {
        // Backend nicht erreichbar (offline) — lokal zwischengespeicherte
        // Daten als Ausweichlösung exportieren, statt die Aktion ganz
        // scheitern zu lassen.
        if (err instanceof NetworkError) {
          const bundle = collectMyData(user, athletes, results, entries, actionItems, sessions);
          downloadJSON(`lane1-meine-daten-lokal-${user.id}-${new Date().toISOString().slice(0, 10)}.json`, bundle);
          toast(t('profileData.exportOfflineFallback'));
        } else {
          toast(describeError(err), 'error');
        }
      }
    },
  }, t('profileData.exportButton'));

  const deleteBtn = el('button', { class: 'btn btn-danger', onclick: () => openDeleteAccountModal(user, athletes) }, t('profileData.deleteButton'));

  dataCard.appendChild(el('div', { class: 'flex gap-8', style: 'flex-wrap:wrap' }, [exportBtn, deleteBtn]));
  wrap.appendChild(dataCard);

  container.appendChild(wrap);
}

function describeError(err) {
  if (err instanceof NetworkError) return t('profileData.errorNetwork');
  if (err instanceof ApiError) return err.message;
  return t('profileData.errorUnknown');
}

// Beantragt die echte, serverseitige Löschung (Art. 17 DSGVO — sofortiger
// Soft-Delete, endgültiger Hard-Purge folgt zeitversetzt, siehe Backend-
// README) und räumt erst NACH deren Bestätigung auch den lokalen Cache auf.
// Verlangt zur Bestätigung die exakte Eingabe von "LÖSCHEN"/"DELETE"
// (stärker als das einfache confirmAction()-Muster, da diese Aktion nicht
// rückgängig gemacht werden kann).
function openDeleteAccountModal(user, athletes) {
  const body = el('div');
  body.appendChild(el('p', {}, t('profileData.deleteIntro')));
  body.appendChild(el('p', { class: 'text-sm' }, t('profileData.deleteConfirmPrompt')));
  const confirmInput = textInput('', { placeholder: t('profileData.deleteConfirmWord') });
  body.appendChild(confirmInput);
  const errorBox = el('p', { class: 'form-error', style: 'display:none' });
  body.appendChild(errorBox);
  const confirmDeleteBtn = el('button', { class: 'btn btn-danger', style: 'margin-top:16px', onclick: async () => {
    errorBox.style.display = 'none';
    if (confirmInput.value.trim().toUpperCase() !== t('profileData.deleteConfirmWord').toUpperCase()) {
      toast(t('profileData.deleteConfirmMismatch'), 'error');
      return;
    }
    confirmDeleteBtn.disabled = true;
    try {
      const result = await api.deleteMyAccount();
      // Erst NACH erfolgreicher serverseitiger Löschanfrage auch den
      // lokalen Cache aufräumen — ein fehlgeschlagener Serveraufruf darf
      // niemals dazu führen, dass nur lokal etwas verschwindet, während
      // das Konto serverseitig unverändert weiterbesteht (das war genau
      // der frühere Irreführungs-Bug, siehe Änderungsprotokoll).
      await eraseMyAccountAndData(user, athletes);
      toast(t('profileData.deleted', { date: new Date(result.purgeAfter).toLocaleDateString('de-DE') }));
      close();
      await logout();
      setTimeout(() => location.reload(), 600);
    } catch (err) {
      errorBox.textContent = describeError(err);
      errorBox.style.display = 'block';
      confirmDeleteBtn.disabled = false;
    }
  } }, t('profileData.deleteButtonConfirm'));
  body.appendChild(el('div', { class: 'form-actions' }, [
    el('button', { class: 'btn btn-ghost', onclick: () => close() }, t('common.cancel')),
    confirmDeleteBtn,
  ]));
  const { close } = openModal({ title: t('profileData.deleteButton'), bodyNode: body, wide: true });
}

// Räumt den lokalen Cache auf (Athletenprofil, Ergebnisse, Startlisten-
// einträge, Handlungsfelder, eigene Anwesenheitseinträge) — wird NUR nach
// erfolgreicher serverseitiger Löschanfrage aufgerufen (siehe oben). Die
// serverseitige Löschung selbst erfolgt zeitversetzt per Purge-Job
// (siehe apps/api/src/jobs/purgeExpiredDeletions.ts).
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
