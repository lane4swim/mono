// ============================================================
// admin/admin.js — Superadmin-Oberfläche, nur unter "/admin" erreichbar.
//
// Bewusst als eigenständiges, schlankes Skript (kein Teil des normalen
// Router-/Modul-Systems in ../js/app.js): diese Oberfläche dient
// ausschließlich dem Anlegen neuer Vereine samt deren erster Admin-
// Einladung — eine reine Backend-Verwaltungsaufgabe ohne jeden Offline-
// Bezug. Wiederverwendet aus dem Hauptsystem nur, was KEINE IndexedDB-
// Abhängigkeit hat: apiClient.js, dom.js/ui.js/modal.js/forms.js, i18n.js.
import * as api from '../js/apiClient.js';
import { describeError } from '../js/apiClient.js';
import { el, clear } from '../js/dom.js';
import { toast } from '../js/ui.js';
import { openModal } from '../js/modal.js';
import { field, textInput } from '../js/forms.js';
import { t, getLocale, setLocale, detectInitialLocale } from '../js/i18n.js';
import { CURRENT_CONSENT_VERSION } from '../js/state.js';
import { openCreateClubModal, openEditClubModulesModal } from '../js/modules/clubForm.js';

// Diese Oberfläche zeigt bei einem 401 an JEDER Stelle (Login, Vereinsliste
// laden, Verein anlegen) bewusst t('auth.errorInvalidCredentials') statt
// der rohen Serverantwort — ein abgelaufenes/entzogenes Refresh-Token
// äußert sich hier genauso wie ein falsches Passwort, und beide sollen
// gleich aussehen.
const describeAdminError = (err) => describeError(err, { on401Message: t('auth.errorInvalidCredentials') });

setLocale(detectInitialLocale());

const authScreenEl = document.getElementById('auth-screen');
const shellEl = document.getElementById('admin-shell');
const viewEl = document.getElementById('view');
const currentUserLabel = document.getElementById('current-user-label');
const btnLogout = document.getElementById('btn-logout');

async function boot() {
  if (api.getStoredRefreshToken()) {
    try {
      const result = await api.refreshTokens();
      await handleAuthenticated(result.user);
      return;
    } catch {
      api.clearTokens();
    }
  }
  showLogin();
}

function showLogin(errorMessage) {
  shellEl.hidden = true;
  authScreenEl.hidden = false;
  renderLoginForm(errorMessage);
}

async function handleAuthenticated(user) {
  if (user.role !== 'superadmin') {
    // Kein Superadmin-Konto — diese Oberfläche ist ausschließlich für
    // diese Rolle gedacht. Sofort wieder abmelden statt Zugriff zu zeigen.
    //
    // Sicherheitskorrektur (Code-Review, Befund S6): vormals nur
    // api.clearTokens() (rein lokal) — das gerade erst ausgestellte
    // Refresh Token blieb dadurch serverseitig bis zu seinem regulären
    // Ablauf (Standard: 30 Tage) gültig, obwohl diese Seite den Zugriff
    // sofort verweigert. api.logoutRemote() (analog zum Logout-Button
    // unten) widerruft es zusätzlich beim Server — MUSS vor
    // clearTokens() aufgerufen werden, da logoutRemote() das Token noch
    // aus dem localStorage lesen muss, das clearTokens() entfernt.
    await api.logoutRemote();
    api.clearTokens();
    showLogin(t('admin.notSuperadmin'));
    return;
  }
  authScreenEl.hidden = true;
  shellEl.hidden = false;
  currentUserLabel.textContent = `${user.name} (${t('settings.role_superadmin')})`;
  btnLogout.textContent = t('topbar.logout');
  btnLogout.onclick = async () => {
    await api.logoutRemote();
    api.clearTokens();
    location.reload();
  };
  await renderClubsView();
}

function renderLoginForm(errorMessage) {
  clear(authScreenEl);
  const box = el('div', { class: 'auth-box' });
  box.appendChild(el('h1', { class: 'mt-0' }, t('admin.loginTitle')));
  box.appendChild(el('p', { class: 'hint' }, t('admin.loginIntro')));

  const form = el('form', { class: 'form-grid' });
  const fEmail = textInput('', { type: 'email', required: true, autocomplete: 'username' });
  const fPassword = textInput('', { type: 'password', required: true, autocomplete: 'current-password' });
  form.appendChild(field(t('auth.email'), fEmail, { span2: true }));
  form.appendChild(field(t('auth.password'), fPassword, { span2: true }));

  const consentRow = el('label', { class: 'consent-checkbox' }, [
    el('input', { type: 'checkbox' }),
    el('span', {}, t('auth.consentLabel', { version: CURRENT_CONSENT_VERSION })),
  ]);
  form.appendChild(el('div', { style: 'grid-column:1/-1' }, consentRow));
  const fConsent = consentRow.querySelector('input');

  const errorBox = el('p', { class: 'form-error', style: `grid-column:1/-1;${errorMessage ? '' : 'display:none'}` }, errorMessage || '');
  form.appendChild(errorBox);

  const submitBtn = el('button', { type: 'submit', class: 'btn btn-primary', style: 'grid-column:1/-1' }, t('admin.loginButton'));
  form.appendChild(submitBtn);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorBox.style.display = 'none';
    if (!fConsent.checked) {
      errorBox.textContent = t('auth.consentRequired');
      errorBox.style.display = 'block';
      return;
    }
    submitBtn.disabled = true;
    try {
      const user = await api.login({ email: fEmail.value.trim(), password: fPassword.value, consent: true });
      await handleAuthenticated(user);
    } catch (err) {
      errorBox.textContent = describeAdminError(err);
      errorBox.style.display = 'block';
    } finally {
      submitBtn.disabled = false;
    }
  });

  box.appendChild(form);
  authScreenEl.appendChild(box);
}

// Baut den Einladungslink relativ zum SITE-ROOT, nicht relativ zu "/admin"
// selbst: admin.js läuft unter ".../admin/" bzw. ".../admin/index.html",
// die eigentliche Annahme-Seite (#/accept-invite/<token>) liegt aber in
// der Haupt-App EINE Ebene darüber (analog zur Scope-Erkennung in
// ../sw.js). Ein simples location.pathname (wie in
// modules/userManagement.js: buildInviteUrl(), das im Kontext der
// Haupt-App bereits am Site-Root läuft) würde hier fälschlich
// ".../admin/#/accept-invite/<token>" ergeben.
function buildInviteUrl(token) {
  const rootPath = location.pathname.replace(/admin\/?(index\.html)?$/, '');
  return `${location.origin}${rootPath}#/accept-invite/${token}`;
}

// Sicherheitskorrektur (Sicherheitsreview 2026-08, Befund M3): ohne
// konfiguriertes SMTP protokolliert der Server die Einladung nur noch
// OHNE den Klartext-Link (siehe mail/mailer.ts: ConsoleMailSender) — die
// Vereinsübersicht zeigte den frisch erstellten Admin-Einladungslink
// bislang gar nicht an (nur einen Toast mit der Ziel-E-Mail), sodass der
// Server-Log-Eintrag die EINZIGE Möglichkeit war, ihn ohne funktionierenden
// E-Mail-Versand zu teilen (z. B. per WhatsApp). Analog zu
// modules/userManagement.js: showInviteLinkModal() wird der Link jetzt
// zusätzlich hier angezeigt (samt "Link kopieren") — unabhängig als
// eigene Funktion, da admin.js bewusst nicht auf userManagement.js
// zugreift (siehe Kopfkommentar: keine IndexedDB-/Modul-Registry-Kopplung).
function showInviteLinkModal(invitation) {
  const url = buildInviteUrl(invitation.token);
  const body = el('div');
  body.appendChild(el('p', {}, t('usermgmt.inviteLinkHint', { date: new Date(invitation.expiresAt).toLocaleDateString(getLocale()) })));
  const linkRow = el('div', { class: 'flex gap-8', style: 'margin-top:12px' }, [
    el('input', { type: 'text', readonly: true, value: url, style: 'flex:1', onclick: (e) => e.target.select() }),
    el('button', { class: 'btn btn-accent btn-sm', onclick: async () => {
      try { await navigator.clipboard.writeText(url); toast(t('usermgmt.linkCopied')); }
      catch { toast(t('usermgmt.linkCopied')); }
    } }, t('usermgmt.copyLink')),
  ]);
  body.appendChild(linkRow);
  openModal({ title: t('usermgmt.inviteLinkTitle'), bodyNode: body, wide: true });
}

// ---------------- Vereinsübersicht ----------------
async function renderClubsView() {
  clear(viewEl);
  viewEl.appendChild(el('div', { class: 'page-head' }, [
    el('div', {}, [el('div', { class: 'page-eyebrow' }, t('admin.eyebrow')), el('h1', { class: 'mt-0' }, t('admin.title'))]),
    el('button', { class: 'btn btn-primary', onclick: () => openCreateClubModal({
      onSuccess: async (result) => {
        toast(t('admin.clubCreatedMailSent', { email: result.invitation.email }));
        await renderClubsView();
        showInviteLinkModal(result.invitation);
      },
    }) }, t('admin.createClub')),
  ]));

  const listHost = el('div', { class: 'card' }, el('p', {}, t('common.loading')));
  viewEl.appendChild(listHost);

  try {
    const { clubs } = await api.listClubs();
    clear(listHost);
    if (clubs.length === 0) {
      listHost.appendChild(el('p', {}, t('admin.noClubsYet')));
    } else {
      const table = el('table');
      table.appendChild(el('thead', {}, el('tr', {}, [
        el('th', {}, t('admin.colClubName')),
        el('th', { class: 'data' }, t('admin.colAdmins')),
        el('th', { class: 'data' }, t('admin.colTrainers')),
        el('th', { class: 'data' }, t('admin.colAthletes')),
        el('th', {}, t('admin.colCreatedAt')),
        el('th', {}, ''),
      ])));
      const tbody = el('tbody');
      clubs.forEach((club) => {
        tbody.appendChild(el('tr', {}, [
          el('td', {}, club.name),
          el('td', { class: 'data' }, String(club.memberCounts.admin)),
          el('td', { class: 'data' }, String(club.memberCounts.trainer)),
          el('td', { class: 'data' }, String(club.memberCounts.athlete)),
          el('td', {}, new Date(club.createdAt).toLocaleDateString(getLocale())),
          el('td', {}, el('button', { class: 'btn btn-ghost', onclick: () => openEditClubModulesModal({
            club,
            onSuccess: async () => { toast(t('usermgmt.clubModulesUpdated')); await renderClubsView(); },
          }) }, t('usermgmt.editClub'))),
        ]));
      });
      table.appendChild(tbody);
      listHost.appendChild(el('div', { class: 'table-wrap' }, table));
    }
  } catch (err) {
    clear(listHost);
    listHost.appendChild(el('p', { class: 'form-error' }, describeAdminError(err)));
  }
}

boot();
