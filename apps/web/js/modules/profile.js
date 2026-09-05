// ============================================================
// modules/profile.js — "Mein Profil" / "My Profile"
//
// Lets the currently signed-in account (trainer, admin, or athlete)
// change their own personal data — name, plus their preferred display
// language (same setting as the topbar dropdown, surfaced here too since
// it's naturally "my personal data"). The email address is displayed
// read-only in the account card; changing it lives in its own,
// password-gated form further down (security review 2026-08-27, finding
// H2 — an email change is as security-sensitive as a password change, so
// it requires the same re-verification instead of riding along with a
// plain profile-details save).
//
// Deliberately NOT restricted via `roles` on the module: every role
// should be able to manage their own account. Athlete master-data
// (birthdate, group, notes, …) is intentionally out of scope here —
// that remains coach-managed under "Athleten & Team", since it
// reflects team/roster decisions rather than personal account info.
// ============================================================
import { getAll } from '../db.js';
import { el, clear, beginRender } from '../dom.js';
import { laneWave, badge, fullName, toast } from '../ui.js';
import { openModal } from '../modal.js';
import { field, textInput } from '../forms.js';
import { getCurrentUser, updateProfile, setUserLocale, logout, changePassword, changeEmail } from '../state.js';
import * as api from '../apiClient.js';
import { NetworkError, describeError } from '../apiClient.js';
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

// Sicherheitsreview 2026-08, Befund M5 — "Passwort ändern" für die
// aktuell eingeloggte Person, verlangt zusätzlich das aktuelle Passwort
// (siehe apps/api/src/modules/auth/auth.service.ts: changePassword()
// für die Begründung). Reine, eigenständige Funktion statt inline in
// renderView() — analog zu openDeleteAccountModal() unten — hält
// renderView() selbst überschaubar.
function buildChangePasswordCard() {
  const card = el('div', { class: 'card mb-16' }, [el('h3', { class: 'mt-0' }, t('profile.passwordSectionTitle'))]);
  const form = el('form', { class: 'form-grid' });
  const fCurrent = textInput('', { type: 'password', required: true, autocomplete: 'current-password' });
  const fNew = textInput('', { type: 'password', required: true, autocomplete: 'new-password' });
  const fConfirm = textInput('', { type: 'password', required: true, autocomplete: 'new-password' });
  form.appendChild(field(t('profile.currentPasswordLabel'), fCurrent, { span2: true }));
  form.appendChild(field(t('auth.chooseNewPassword'), fNew, { span2: true, hint: t('auth.passwordHint') }));
  form.appendChild(field(t('auth.confirmNewPassword'), fConfirm, { span2: true }));

  const errorBox = el('p', { class: 'form-error', style: 'grid-column:1/-1;display:none' });
  form.appendChild(errorBox);

  const submitBtn = el('button', { type: 'submit', class: 'btn btn-primary' }, t('profile.changePasswordButton'));
  form.appendChild(el('div', { class: 'form-actions', style: 'grid-column:1/-1' }, [submitBtn]));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorBox.style.display = 'none';
    if (fNew.value !== fConfirm.value) {
      errorBox.textContent = t('auth.passwordMismatch');
      errorBox.style.display = 'block';
      return;
    }
    submitBtn.disabled = true;
    try {
      await changePassword(fCurrent.value, fNew.value);
      toast(t('profile.passwordChanged'));
      // Felder leeren statt sie stehen zu lassen — sensible Werte sollen
      // nicht länger als nötig im DOM/Formularzustand verbleiben.
      fCurrent.value = ''; fNew.value = ''; fConfirm.value = '';
    } catch (err) {
      errorBox.textContent = describeError(err, { on401Message: t('profile.errorInvalidCurrentPassword') });
      errorBox.style.display = 'block';
    } finally {
      submitBtn.disabled = false;
    }
  });

  card.appendChild(form);
  return card;
}

// Sicherheitsreview 2026-08-27, Befund H2 — E-Mail-Wechsel für die
// aktuell eingeloggte Person, verlangt wie buildChangePasswordCard()
// zusätzlich das aktuelle Passwort (siehe apps/api/src/modules/auth/
// auth.service.ts: changeEmail() für die Begründung: ohne diese Prüfung
// hätte ein kurzzeitig entwendeter, noch gültiger Access Token gereicht,
// um kombiniert mit "Passwort vergessen" eine dauerhafte Kontoübernahme
// zu erreichen). Bewusst ein eigenes Formular statt eines Feldes im
// Kontodaten-Formular oben — dort ist die E-Mail-Adresse seither nur
// noch eine reine Anzeige.
function buildChangeEmailCard() {
  const card = el('div', { class: 'card mb-16' }, [el('h3', { class: 'mt-0' }, t('profile.emailSectionTitle'))]);
  const form = el('form', { class: 'form-grid' });
  const fCurrentPassword = textInput('', { type: 'password', required: true, autocomplete: 'current-password' });
  const fNewEmail = textInput('', { type: 'email', required: true, autocomplete: 'email' });
  form.appendChild(field(t('profile.currentPasswordLabel'), fCurrentPassword, { span2: true }));
  form.appendChild(field(t('profile.newEmailLabel'), fNewEmail, { span2: true }));

  const errorBox = el('p', { class: 'form-error', style: 'grid-column:1/-1;display:none' });
  form.appendChild(errorBox);

  const submitBtn = el('button', { type: 'submit', class: 'btn btn-primary' }, t('profile.changeEmailButton'));
  form.appendChild(el('div', { class: 'form-actions', style: 'grid-column:1/-1' }, [submitBtn]));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorBox.style.display = 'none';
    const newEmail = fNewEmail.value.trim();
    if (!EMAIL_RE.test(newEmail)) {
      errorBox.textContent = t('profile.validationEmail');
      errorBox.style.display = 'block';
      return;
    }
    submitBtn.disabled = true;
    try {
      await changeEmail(fCurrentPassword.value, newEmail);
      toast(t('profile.emailChanged'));
      // Felder leeren statt sie stehen zu lassen — analog zu
      // buildChangePasswordCard() (sensible Werte sollen nicht länger als
      // nötig im DOM/Formularzustand verbleiben). changeEmail() (state.js)
      // löst über emit()/onUserChange bereits ein automatisches Neu-
      // Rendern der Ansicht aus, das die Kontodaten-Anzeige aktualisiert.
      fCurrentPassword.value = ''; fNewEmail.value = '';
    } catch (err) {
      errorBox.textContent = describeError(err, { on401Message: t('profile.errorInvalidCurrentPassword') });
      errorBox.style.display = 'block';
    } finally {
      submitBtn.disabled = false;
    }
  });

  card.appendChild(form);
  return card;
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
  form.appendChild(field(t('profile.formName'), fName, { span2: true }));

  // Sicherheitsreview 2026-08-27, Befund H2: reine Anzeige statt eines
  // editierbaren Feldes — ein Wechsel läuft ausschließlich über das
  // eigene, per aktuellem Passwort abgesicherte Formular weiter unten
  // (buildChangeEmailCard()), analog zu roleRow/athleteRow hier.
  const emailRow = el('div', { class: 'field span-2' }, [
    el('label', {}, t('profile.formEmail')),
    el('div', {}, el('span', {}, user.email || '')),
  ]);
  form.appendChild(emailRow);

  const roleRow = el('div', { class: 'field span-2' }, [
    el('label', {}, t('profile.roleLabel')),
    el('div', { class: 'flex gap-8' }, user.roles.map((r) => badge(t(`settings.role_${r}`), 'neutral'))),
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
    const name = fName.value.trim();
    if (!name) { toast(t('profile.validationName'), 'error'); return; }
    await updateProfile({ name });
    toast(t('profile.saved'));
  });

  card.appendChild(form);
  wrap.appendChild(card);

  // ---- E-Mail-Wechsel (Sicherheitsreview 2026-08-27, Befund H2) ----
  wrap.appendChild(buildChangeEmailCard());

  // ---- Passwortwechsel (Sicherheitsreview 2026-08, Befund M5) ----
  wrap.appendChild(buildChangePasswordCard());

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

  const deleteBtn = el('button', { class: 'btn btn-danger', onclick: () => openDeleteAccountModal() }, t('profileData.deleteButton'));

  dataCard.appendChild(el('div', { class: 'flex gap-8', style: 'flex-wrap:wrap' }, [exportBtn, deleteBtn]));
  wrap.appendChild(dataCard);

  container.appendChild(wrap);
}

// Beantragt die echte, serverseitige Löschung (Art. 17 DSGVO — sofortiger
// Soft-Delete, endgültiger Hard-Purge folgt zeitversetzt, siehe Backend-
// README) und räumt erst NACH deren Bestätigung auch den lokalen Cache auf.
// Verlangt zur Bestätigung die exakte Eingabe von "LÖSCHEN"/"DELETE"
// (stärker als das einfache confirmAction()-Muster, da diese Aktion nicht
// rückgängig gemacht werden kann).
function openDeleteAccountModal() {
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
      toast(t('profileData.deleted', { date: new Date(result.purgeAfter).toLocaleDateString(getLocale()) }));
      close();
      // Code-Review, Befund R2: räumte den lokalen Cache zuvor Datensatz
      // für Datensatz per eigener eraseMyAccountAndData()-Funktion auf —
      // vollständig überflüssig, denn logout() (state.js) ruft ohnehin
      // wipeAll() auf, das ALLE Stores leert, und lief nur drei Zeilen
      // später. Schlimmer als nur überflüssig: sie nutzte die
      // sync-erzeugenden remove()/put() statt removeWithoutSync()/
      // putWithoutSync() — für ein Konto, das serverseitig soeben
      // soft-gelöscht und dessen Refresh Tokens widerrufen wurden, wurden
      // dadurch kurzzeitig unnötige Sync-Events erzeugt (darunter ein
      // Event für den Store "users", den die Sync-API gar nicht kennt),
      // die wipeAll() zwar sofort mitlöschte, aber als offene Falle für
      // eine künftige Reihenfolge-Änderung bestehen blieben.
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
