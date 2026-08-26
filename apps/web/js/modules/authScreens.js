// ============================================================
// modules/authScreens.js — Phase 4: echter Login-Bildschirm + Annahme
// einer Einladung (ersetzt den früheren rein lokalen Profil-Umschalter).
//
// Kein Router-Modul im üblichen Sinn (registerModule/roles) — diese beiden
// Ansichten müssen funktionieren, BEVOR eine Sitzung besteht, und werden
// daher direkt von app.js gerendert, je nach Sitzungs-/URL-Zustand.
// ============================================================
import { el } from '../dom.js';
import { toast } from '../ui.js';
import { openModal } from '../modal.js';
import { field, textInput } from '../forms.js';
import {
  login as loginRequest,
  acceptInvitation as acceptInvitationRequest,
  resetPassword as resetPasswordRequest,
  CURRENT_CONSENT_VERSION,
} from '../state.js';
import * as api from '../apiClient.js';
import { t } from '../i18n.js';
import { buildLegalContent } from './info.js';

// Impressum-Pflicht (§5 TMG) gilt unabhängig vom Login-Status — dieser
// Link macht dieselbe Rechtliches-Seite (siehe modules/info.js) auch vor
// einer Anmeldung erreichbar, ohne den Text ein zweites Mal zu pflegen.
function appendLegalFooterLink(container) {
  container.appendChild(el('div', { class: 'auth-footer' }, [
    el('button', {
      type: 'button',
      onclick: () => openModal({ title: t('legal.pageTitle'), bodyNode: buildLegalContent(), wide: true }),
    }, t('legal.authFooterLink')),
  ]));
}

// ---- Login ----------------------------------------------------------
export function renderLoginScreen(container, onSuccess) {
  container.innerHTML = '';
  const box = el('div', { class: 'auth-box' });

  box.appendChild(el('h1', { class: 'mt-0' }, t('auth.loginTitle')));
  box.appendChild(el('p', { class: 'hint' }, t('auth.loginIntro')));

  const form = el('form', { class: 'form-grid' });
  const fEmail = textInput('', { type: 'email', required: true, autocomplete: 'username' });
  const fPassword = textInput('', { type: 'password', required: true, autocomplete: 'current-password' });
  form.appendChild(field(t('auth.email'), fEmail, { span2: true }));
  form.appendChild(field(t('auth.password'), fPassword, { span2: true }));

  const consentRow = el('label', { class: 'consent-checkbox' }, [
    el('input', { type: 'checkbox', id: 'login-consent' }),
    el('span', {}, t('auth.consentLabel', { version: CURRENT_CONSENT_VERSION })),
  ]);
  form.appendChild(el('div', { style: 'grid-column:1/-1' }, consentRow));
  const fConsent = consentRow.querySelector('input');

  const errorBox = el('p', { class: 'form-error', style: 'grid-column:1/-1;display:none' });
  form.appendChild(errorBox);

  const submitBtn = el('button', { type: 'submit', class: 'btn btn-primary', style: 'grid-column:1/-1' }, t('auth.loginButton'));
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
      const user = await loginRequest(fEmail.value.trim(), fPassword.value, true);
      toast(t('auth.loginSuccess', { name: user.name }));
      onSuccess();
    } catch (err) {
      errorBox.textContent = describeAuthError(err);
      errorBox.style.display = 'block';
    } finally {
      submitBtn.disabled = false;
    }
  });

  box.appendChild(form);
  // "Passwort vergessen" (Sicherheitsreview 2026-08, Befund M5) — löst den
  // Container-Inhalt bewusst NICHT über einen Hash-Route auf (die
  // Router-Reaktivität in app.js wird erst NACH einer Anmeldung
  // aktiviert, siehe dortiger Kommentar zu onRouteChange), sondern ersetzt
  // ihn direkt, analog zu renderLoginScreen()/renderAcceptInvitationScreen()
  // selbst. onBackToLogin reicht denselben onSuccess-Callback weiter, den
  // dieser Login-Bildschirm selbst erhalten hat.
  box.appendChild(el('div', { class: 'auth-footer' }, [
    el('button', {
      type: 'button',
      onclick: () => renderForgotPasswordScreen(container, () => renderLoginScreen(container, onSuccess)),
    }, t('auth.forgotPasswordLink')),
  ]));
  box.appendChild(el('p', { class: 'hint', style: 'margin-top:20px' }, t('auth.noAccountHint')));
  container.appendChild(box);
  appendLegalFooterLink(container);
}

// ---- Passwort vergessen (Sicherheitsreview 2026-08, Befund M5) --------
export function renderForgotPasswordScreen(container, onBackToLogin) {
  container.innerHTML = '';
  const box = el('div', { class: 'auth-box' });
  box.appendChild(el('h1', { class: 'mt-0' }, t('auth.forgotPasswordTitle')));
  box.appendChild(el('p', { class: 'hint' }, t('auth.forgotPasswordIntro')));

  const form = el('form', { class: 'form-grid' });
  const fEmail = textInput('', { type: 'email', required: true, autocomplete: 'username' });
  form.appendChild(field(t('auth.email'), fEmail, { span2: true }));

  const errorBox = el('p', { class: 'form-error', style: 'grid-column:1/-1;display:none' });
  form.appendChild(errorBox);

  const submitBtn = el('button', { type: 'submit', class: 'btn btn-primary', style: 'grid-column:1/-1' }, t('auth.forgotPasswordButton'));
  form.appendChild(submitBtn);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorBox.style.display = 'none';
    submitBtn.disabled = true;
    try {
      // Liefert serverseitig IMMER dieselbe generische Antwort, unabhängig
      // davon, ob die E-Mail-Adresse zu einem Konto gehört (siehe
      // apiClient.js: forgotPassword() — verhindert User-Enumeration). Der
      // Erfolgsbildschirm unten ersetzt daher bewusst das GESAMTE Formular
      // (statt nur einen Toast zu zeigen) — verhindert zusätzlich
      // versehentliches Mehrfach-Absenden per Doppelklick/erneutem Enter.
      await api.forgotPassword(fEmail.value.trim());
      renderForgotPasswordSentScreen(container, onBackToLogin);
    } catch (err) {
      errorBox.textContent = describeAuthError(err);
      errorBox.style.display = 'block';
    } finally {
      submitBtn.disabled = false;
    }
  });

  box.appendChild(form);
  box.appendChild(el('div', { class: 'auth-footer' }, [
    el('button', { type: 'button', onclick: onBackToLogin }, t('auth.backToLogin')),
  ]));
  container.appendChild(box);
  appendLegalFooterLink(container);
}

function renderForgotPasswordSentScreen(container, onBackToLogin) {
  container.innerHTML = '';
  const box = el('div', { class: 'auth-box' });
  box.appendChild(el('h1', { class: 'mt-0' }, t('auth.forgotPasswordSentTitle')));
  box.appendChild(el('p', {}, t('auth.forgotPasswordSentMessage')));
  box.appendChild(el('button', { type: 'button', class: 'btn btn-primary', style: 'margin-top:16px', onclick: onBackToLogin }, t('auth.backToLogin')));
  container.appendChild(box);
  appendLegalFooterLink(container);
}

// ---- Neues Passwort vergeben (per E-Mail zugestellter Link) -----------
export function renderResetPasswordScreen(container, token, onSuccess) {
  container.innerHTML = '';
  const box = el('div', { class: 'auth-box' });
  box.appendChild(el('h1', { class: 'mt-0' }, t('auth.resetPasswordTitle')));
  box.appendChild(el('p', { class: 'hint' }, t('auth.resetPasswordIntro')));

  const form = el('form', { class: 'form-grid' });
  const fPassword = textInput('', { type: 'password', required: true, autocomplete: 'new-password' });
  const fConfirm = textInput('', { type: 'password', required: true, autocomplete: 'new-password' });
  form.appendChild(field(t('auth.chooseNewPassword'), fPassword, { span2: true, hint: t('auth.passwordHint') }));
  form.appendChild(field(t('auth.confirmNewPassword'), fConfirm, { span2: true }));

  const errorBox = el('p', { class: 'form-error', style: 'grid-column:1/-1;display:none' });
  form.appendChild(errorBox);

  const submitBtn = el('button', { type: 'submit', class: 'btn btn-primary', style: 'grid-column:1/-1' }, t('auth.resetPasswordButton'));
  form.appendChild(submitBtn);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorBox.style.display = 'none';
    if (fPassword.value !== fConfirm.value) {
      errorBox.textContent = t('auth.passwordMismatch');
      errorBox.style.display = 'block';
      return;
    }
    submitBtn.disabled = true;
    try {
      await resetPasswordRequest(token, fPassword.value);
      toast(t('auth.resetPasswordSuccess'));
      onSuccess();
    } catch (err) {
      errorBox.textContent = describeAuthError(err, { on410Message: t('auth.errorResetTokenExpired') });
      errorBox.style.display = 'block';
    } finally {
      submitBtn.disabled = false;
    }
  });

  box.appendChild(form);
  container.appendChild(box);
  appendLegalFooterLink(container);
}

// ---- Einladung annehmen ----------------------------------------------
export async function renderAcceptInvitationScreen(container, token, onSuccess) {
  container.innerHTML = '';
  const box = el('div', { class: 'auth-box' });
  box.appendChild(el('h1', { class: 'mt-0' }, t('auth.acceptInviteTitle')));

  let preview;
  try {
    preview = await api.getInvitationPreview(token);
  } catch {
    box.appendChild(el('p', { class: 'form-error' }, t('auth.invitationInvalid')));
    box.appendChild(el('a', { href: '#/', class: 'btn btn-ghost', style: 'margin-top:16px' }, t('auth.backToLogin')));
    container.appendChild(box);
    appendLegalFooterLink(container);
    return;
  }

  box.appendChild(el('p', {}, t('auth.acceptInviteIntro', {
    email: preview.email,
    role: t(`settings.role_${preview.role}`),
    club: preview.clubName || t('auth.noClubYetLabel'),
  })));

  const form = el('form', { class: 'form-grid' });
  const fName = textInput('', { required: true, autocomplete: 'name' });
  const fPassword = textInput('', { type: 'password', required: true, autocomplete: 'new-password' });
  form.appendChild(field(t('auth.yourName'), fName, { span2: true }));
  form.appendChild(field(t('auth.chooseNewPassword'), fPassword, { span2: true, hint: t('auth.passwordHint') }));

  const consentRow = el('label', { class: 'consent-checkbox' }, [
    el('input', { type: 'checkbox', id: 'accept-consent' }),
    el('span', {}, t('auth.consentLabel', { version: CURRENT_CONSENT_VERSION })),
  ]);
  form.appendChild(el('div', { style: 'grid-column:1/-1' }, consentRow));
  const fConsent = consentRow.querySelector('input');

  const errorBox = el('p', { class: 'form-error', style: 'grid-column:1/-1;display:none' });
  form.appendChild(errorBox);

  const submitBtn = el('button', { type: 'submit', class: 'btn btn-primary', style: 'grid-column:1/-1' }, t('auth.acceptInviteButton'));
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
      const user = await acceptInvitationRequest(token, fName.value.trim(), fPassword.value, true);
      toast(t('auth.acceptInviteSuccess', { name: user.name }));
      onSuccess();
    } catch (err) {
      errorBox.textContent = describeAuthError(err);
      errorBox.style.display = 'block';
    } finally {
      submitBtn.disabled = false;
    }
  });

  box.appendChild(form);
  container.appendChild(box);
  appendLegalFooterLink(container);
}

// `on410Message`, wenn gesetzt, überschreibt die 410-Meldung für einen
// Aufrufer mit ANDEREM Kontext als "Einladung" (z. B.
// renderResetPasswordScreen() — "dieser Link ist ungültig/abgelaufen"
// bedeutet dort ein Passwort-Reset-Token, nicht eine Einladung; die
// Standardmeldung "Diese Einladung ist ungültig…" wäre dort irreführend).
// Analog zu describeError()s on401Message-Parameter in apiClient.js.
function describeAuthError(err, { on410Message } = {}) {
  if (err instanceof api.NetworkError) return t('auth.errorNetwork');
  if (err instanceof api.ApiError) {
    if (err.status === 401) return t('auth.errorInvalidCredentials');
    if (err.status === 410) return on410Message ?? t('auth.errorInvitationExpired');
    if (err.status === 409) return t('auth.errorEmailTaken');
    return err.message;
  }
  return t('auth.errorUnknown');
}
