// Oberfläche der Zwei-Faktor-Anmeldung per TOTP (Issue #97,
// docs/Plans/zwei-faktor-anmeldung-plan.md): Profilbereich (Einrichten,
// Wiederherstellungscodes, Abschalten), Codeschritt der Anmeldung,
// Zurücksetzen für Mitglieder und die Vereinseinstellung "TOTP für Admins
// verlangen". Kein Router-Modul — die Bausteine werden von profile.js,
// authScreens.js und userManagement.js eingebunden.
import { el, clear } from '../dom.js';
import { openModal } from '../modal.js';
import { field, textInput } from '../forms.js';
import { toast, badge } from '../ui.js';
import * as api from '../apiClient.js';
import { describeError } from '../apiClient.js';
import { t } from '../i18n.js';
import { getCurrentUser, applySessionUser } from '../state.js';
import { IS_DEMO } from '../demoMode.js';

// ---- QR-Code ------------------------------------------------------------
// Der Server liefert den QR-Code als SVG-Text. Ein <img> mit data:-URI
// verbietet die CSP (img-src 'self'), und Servertext als Markup einzufügen
// verbietet dom.js (siehe icon()). Stattdessen: SVG parsen und nur die
// Elemente und Attribute nachbauen, aus denen ein QR-Code besteht.
const SVG_NS = 'http://www.w3.org/2000/svg';
const QR_ELEMENTS = new Set(['svg', 'path', 'rect']);
const QR_ATTRIBUTES = new Set(['viewBox', 'width', 'height', 'shape-rendering', 'd', 'fill', 'stroke', 'x', 'y']);

export function buildQrSvg(svgText) {
  const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
  const source = doc.documentElement;
  if (!source || source.nodeName !== 'svg') return null;
  function copy(node) {
    if (!QR_ELEMENTS.has(node.nodeName)) return null;
    const out = document.createElementNS(SVG_NS, node.nodeName);
    for (const attr of Array.from(node.attributes)) {
      if (QR_ATTRIBUTES.has(attr.name) && !/^\s*javascript:/i.test(attr.value)) out.setAttribute(attr.name, attr.value);
    }
    for (const child of Array.from(node.children)) {
      const copied = copy(child);
      if (copied) out.appendChild(copied);
    }
    return out;
  }
  const svg = copy(source);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', t('mfa.qrAlt'));
  svg.setAttribute('class', 'mfa-qr');
  return svg;
}

// Schlüssel in Vierergruppen, leichter abzutippen.
function formatSecret(secret) {
  return secret.replace(/(.{4})/g, '$1 ').trim();
}

// ---- Eingaben -----------------------------------------------------------
export function codeInput() {
  return textInput('', {
    inputmode: 'numeric',
    autocomplete: 'one-time-code',
    pattern: '[0-9 ]*',
    maxlength: '7',
    required: true,
    class: 'mfa-code-input',
  });
}

function recoveryInput() {
  return textInput('', { autocomplete: 'off', required: true, maxlength: '20', spellcheck: 'false' });
}

// Feld für den zweiten Faktor mit Umschalter "Wiederherstellungscode
// verwenden". `value()` liefert { code } oder { recoveryCode }.
export function secondFactorField() {
  let useRecovery = false;
  const codeField = codeInput();
  const recoveryField = recoveryInput();
  const label = el('label', {}, t('mfa.codeLabel'));
  const holder = el('div', { class: 'field span-2' }, [label, codeField]);
  const toggle = el('button', { type: 'button', class: 'btn btn-ghost btn-sm' }, t('mfa.useRecoveryCode'));
  toggle.addEventListener('click', () => {
    useRecovery = !useRecovery;
    holder.replaceChild(useRecovery ? recoveryField : codeField, useRecovery ? codeField : recoveryField);
    label.textContent = useRecovery ? t('mfa.recoveryCodeLabel') : t('mfa.codeLabel');
    toggle.textContent = useRecovery ? t('mfa.useAuthenticatorCode') : t('mfa.useRecoveryCode');
    (useRecovery ? recoveryField : codeField).focus();
  });
  return {
    node: el('div', { style: 'grid-column:1/-1' }, [holder, el('div', { style: 'margin-top:8px' }, toggle)]),
    value: () => (useRecovery ? { recoveryCode: recoveryField.value.trim() } : { code: codeField.value.replace(/\s/g, '') }),
    focus: () => codeField.focus(),
  };
}

// Fehlermeldungen der MFA-Endpunkte. 401 heißt je nach Kontext "Passwort
// falsch" (Profil) oder "Anmeldung abgelaufen" (Codeschritt).
export function describeMfaError(err, { on401Message } = {}) {
  const code = err?.body?.error;
  if (code === 'invalid_mfa_code') return t('mfa.errorInvalidCode');
  if (code === 'mfa_code_required') return t('mfa.errorCodeRequired');
  if (code === 'invalid_current_password') return t('profile.errorInvalidCurrentPassword');
  return describeError(err, { on401Message });
}

// ---- Wiederherstellungscodes ---------------------------------------------
function downloadText(filename, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  const a = el('a', { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function renderRecoveryCodes(codes) {
  const text = `${t('mfa.recoveryFileHeader')}\n\n${codes.join('\n')}\n`;
  return el('div', {}, [
    el('p', { class: 'hint' }, t('mfa.recoveryCodesIntro')),
    el('ul', { class: 'mfa-recovery-codes' }, codes.map((c) => el('li', {}, el('code', {}, c)))),
    el('div', { class: 'flex gap-8' }, [
      el('button', {
        type: 'button',
        class: 'btn btn-ghost btn-sm',
        onclick: async () => {
          try {
            await navigator.clipboard.writeText(codes.join('\n'));
            toast(t('mfa.recoveryCodesCopied'));
          } catch {
            toast(t('mfa.recoveryCodesCopyFailed'), 'error');
          }
        },
      }, t('mfa.copyCodes')),
      el('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => downloadText('lane1-wiederherstellungscodes.txt', text) }, t('mfa.downloadCodes')),
    ]),
  ]);
}

function showRecoveryCodesModal(codes, onClose) {
  const done = el('button', { type: 'button', class: 'btn btn-primary' }, t('mfa.recoveryCodesSaved'));
  const body = el('div', {}, [renderRecoveryCodes(codes), el('div', { class: 'form-actions', style: 'margin-top:16px' }, done)]);
  const modal = openModal({ title: t('mfa.recoveryCodesTitle'), bodyNode: body });
  done.addEventListener('click', () => { modal.close(); onClose?.(); });
}

// ---- Bestätigungsdialog (Passwort und/oder zweiter Faktor) ---------------
// `needsPassword`/`needsSecondFactor` steuern die Felder; `onSubmit` erhält
// { currentPassword?, code?, recoveryCode? } und darf werfen — die Meldung
// erscheint im Dialog.
export function openConfirmDialog({ title, intro, needsPassword, needsSecondFactor, submitLabel, danger, onSubmit, on401Message }) {
  const form = el('form', { class: 'form-grid' });
  if (intro) form.appendChild(el('p', { style: 'grid-column:1/-1' }, intro));
  const fPassword = needsPassword ? textInput('', { type: 'password', required: true, autocomplete: 'current-password' }) : null;
  if (fPassword) form.appendChild(field(t('profile.currentPasswordLabel'), fPassword, { span2: true }));
  const secondFactor = needsSecondFactor ? secondFactorField() : null;
  if (secondFactor) form.appendChild(secondFactor.node);
  const errorBox = el('p', { class: 'form-error', style: 'grid-column:1/-1;display:none' });
  form.appendChild(errorBox);
  const submitBtn = el('button', { type: 'submit', class: danger ? 'btn btn-danger' : 'btn btn-primary' }, submitLabel);
  form.appendChild(el('div', { class: 'form-actions', style: 'grid-column:1/-1' }, submitBtn));
  const modal = openModal({ title, bodyNode: form });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorBox.style.display = 'none';
    submitBtn.disabled = true;
    try {
      await onSubmit({ ...(fPassword ? { currentPassword: fPassword.value } : {}), ...(secondFactor ? secondFactor.value() : {}) });
      modal.close();
    } catch (err) {
      errorBox.textContent = describeMfaError(err, { on401Message });
      errorBox.style.display = 'block';
    } finally {
      submitBtn.disabled = false;
    }
  });
  return modal;
}

// ---- Einrichten -----------------------------------------------------------
function openSetupModal(onDone) {
  const body = el('div', {}, el('p', {}, t('common.loading')));
  const modal = openModal({ title: t('mfa.setupTitle'), bodyNode: body });
  api.beginMfaSetup().then((setup) => {
    clear(body);
    body.appendChild(el('p', {}, t('mfa.setupStep1')));
    const qr = buildQrSvg(setup.qrSvg);
    if (qr) body.appendChild(el('div', { class: 'mfa-qr-wrap' }, qr));
    body.appendChild(el('details', { class: 'mb-16' }, [
      el('summary', {}, t('mfa.setupManualSummary')),
      el('p', { class: 'hint' }, t('mfa.setupManualHint')),
      el('code', { class: 'mfa-secret' }, formatSecret(setup.secret)),
    ]));
    const form = el('form', { class: 'form-grid' });
    const fCode = codeInput();
    form.appendChild(field(t('mfa.setupStep2'), fCode, { span2: true }));
    const errorBox = el('p', { class: 'form-error', style: 'grid-column:1/-1;display:none' });
    form.appendChild(errorBox);
    const submitBtn = el('button', { type: 'submit', class: 'btn btn-primary' }, t('mfa.setupConfirm'));
    form.appendChild(el('div', { class: 'form-actions', style: 'grid-column:1/-1' }, submitBtn));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      errorBox.style.display = 'none';
      submitBtn.disabled = true;
      try {
        const { recoveryCodes, user } = await api.confirmMfaSetup(fCode.value.replace(/\s/g, ''));
        applySessionUser(user);
        modal.close();
        toast(t('mfa.enabledToast'));
        showRecoveryCodesModal(recoveryCodes, onDone);
      } catch (err) {
        errorBox.textContent = describeMfaError(err);
        errorBox.style.display = 'block';
      } finally {
        submitBtn.disabled = false;
      }
    });
    body.appendChild(form);
    fCode.focus();
  }).catch((err) => {
    clear(body);
    body.appendChild(el('p', { class: 'form-error' }, describeMfaError(err)));
  });
}

// ---- Profilbereich ----------------------------------------------------------
export function buildMfaCard() {
  const card = el('div', { class: 'card mb-16' }, [el('h3', { class: 'mt-0' }, t('mfa.sectionTitle'))]);
  const content = el('div', {}, el('p', { class: 'hint' }, t('common.loading')));
  card.appendChild(content);

  if (IS_DEMO) {
    clear(content);
    content.appendChild(el('p', { class: 'hint' }, t('mfa.demoDisabled')));
    return card;
  }

  async function load() {
    try {
      const status = await api.getMfaStatus();
      render(status);
    } catch (err) {
      clear(content);
      content.appendChild(el('p', { class: 'form-error' }, describeError(err)));
    }
  }

  function render(status) {
    clear(content);
    content.appendChild(el('p', { class: 'hint' }, t('mfa.sectionIntro')));
    if (!status.available) {
      content.appendChild(el('p', {}, t('mfa.notAvailable')));
      return;
    }
    if (status.required && !status.enabled) content.appendChild(el('p', { class: 'form-error' }, t('mfa.requiredNotice')));
    else if (status.required) content.appendChild(el('p', { class: 'hint' }, t('mfa.requiredInfo')));
    else if (!status.enforced && !status.enabled && getCurrentUser()?.roles?.includes('superadmin')) {
      content.appendChild(el('p', { class: 'hint' }, t('mfa.recommendedForSuperadmin')));
    }

    if (!status.enabled) {
      content.appendChild(el('p', {}, [badge(t('mfa.statusOff'), 'neutral')]));
      content.appendChild(el('button', { type: 'button', class: 'btn btn-primary', onclick: () => openSetupModal(load) }, t('mfa.setupButton')));
      return;
    }

    content.appendChild(el('p', {}, [
      badge(t('mfa.statusOn'), 'done'), ' ',
      el('span', { class: 'hint' }, t('mfa.recoveryRemaining', { count: status.recoveryCodesRemaining })),
    ]));
    if (status.recoveryCodesRemaining <= 2) content.appendChild(el('p', { class: 'form-error' }, t('mfa.recoveryLow')));
    content.appendChild(el('div', { class: 'flex gap-8' }, [
      el('button', {
        type: 'button',
        class: 'btn btn-ghost',
        onclick: () => openConfirmDialog({
          title: t('mfa.regenerateTitle'),
          intro: t('mfa.regenerateIntro'),
          needsSecondFactor: true,
          submitLabel: t('mfa.regenerateButton'),
          onSubmit: async (input) => {
            const { recoveryCodes } = await api.regenerateRecoveryCodes(input);
            showRecoveryCodesModal(recoveryCodes, load);
          },
        }),
      }, t('mfa.regenerateButton')),
      el('button', {
        type: 'button',
        class: 'btn btn-ghost',
        onclick: () => openConfirmDialog({
          title: t('mfa.disableTitle'),
          intro: t('mfa.disableIntro'),
          needsPassword: true,
          needsSecondFactor: true,
          danger: true,
          submitLabel: t('mfa.disableButton'),
          on401Message: t('profile.errorInvalidCurrentPassword'),
          onSubmit: async (input) => {
            applySessionUser(await api.disableMfa(input));
            toast(t('mfa.disabledToast'));
            load();
          },
        }),
      }, t('mfa.disableButton')),
    ]));
  }

  load();
  return card;
}

// ---- Codeschritt der Anmeldung ----------------------------------------------
// Ersetzt den Inhalt von `container` durch das Code-Formular. `onSubmit`
// bekommt { code } oder { recoveryCode }; `onExpired` führt zurück zur
// Anmeldung (mfaToken abgelaufen oder nach zu vielen Fehlversuchen gesperrt).
export function renderMfaStep(container, { onSubmit, onSuccess, onExpired }) {
  clear(container);
  const box = el('div', { class: 'auth-box' });
  box.appendChild(el('h1', { class: 'mt-0' }, t('mfa.loginTitle')));
  box.appendChild(el('p', { class: 'hint' }, t('mfa.loginIntro')));
  const form = el('form', { class: 'form-grid' });
  const secondFactor = secondFactorField();
  form.appendChild(secondFactor.node);
  const errorBox = el('p', { class: 'form-error', style: 'grid-column:1/-1;display:none' });
  form.appendChild(errorBox);
  const submitBtn = el('button', { type: 'submit', class: 'btn btn-primary', style: 'grid-column:1/-1' }, t('mfa.loginButton'));
  form.appendChild(submitBtn);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorBox.style.display = 'none';
    submitBtn.disabled = true;
    try {
      const user = await onSubmit(secondFactor.value());
      onSuccess(user);
    } catch (err) {
      if (err instanceof api.ApiError && err.status === 401) {
        onExpired(t('mfa.loginExpired'));
        return;
      }
      errorBox.textContent = describeMfaError(err);
      errorBox.style.display = 'block';
    } finally {
      submitBtn.disabled = false;
    }
  });
  box.appendChild(form);
  box.appendChild(el('div', { class: 'auth-footer' }, [
    el('button', { type: 'button', onclick: () => onExpired(null) }, t('auth.backToLogin')),
  ]));
  container.appendChild(box);
  secondFactor.focus();
}

// ---- Verwaltung durch Admins/Superadmins ---------------------------------------
// Zurücksetzen für ein Mitglied (verlorenes Gerät). Bestätigung mit eigenem
// Passwort und — falls die handelnde Person selbst TOTP nutzt — einem Code.
export function openResetMemberMfaModal(member, onDone) {
  openConfirmDialog({
    title: t('mfa.resetTitle'),
    intro: t('mfa.resetIntro', { name: member.name }),
    needsPassword: true,
    needsSecondFactor: Boolean(getCurrentUser()?.mfaEnabled),
    danger: true,
    submitLabel: t('mfa.resetButton'),
    on401Message: t('profile.errorInvalidCurrentPassword'),
    onSubmit: async (input) => {
      await api.resetUserMfa(member.id, input);
      toast(t('mfa.resetToast', { name: member.name }));
      onDone?.();
    },
  });
}

// Ob die handelnde Person das TOTP dieses Mitglieds zurücksetzen darf —
// spiegelt die Serverprüfung (mfa.service.ts: resetForUser()).
export function canResetMemberMfa(member) {
  const me = getCurrentUser();
  if (!me || !member.mfaEnabled || member.id === me.id) return false;
  if (me.roles?.includes('superadmin')) return true;
  return Boolean(me.roles?.includes('admin') && member.clubId === me.clubId && !member.roles?.includes('superadmin'));
}

export function mfaBadge(member) {
  return member.mfaEnabled ? badge(t('mfa.badgeOn'), 'done') : null;
}

// Vereinseinstellung "TOTP für alle Admins verlangen" (admin: eigener Verein;
// superadmin: jeder). Einschalten setzt eigenes, aktives TOTP voraus.
export function buildClubMfaPolicyCard(club, onChanged) {
  const card = el('div', { class: 'card mb-16' }, [el('h3', { class: 'mt-0' }, t('mfa.clubPolicyTitle'))]);
  card.appendChild(el('p', { class: 'hint' }, t('mfa.clubPolicyHint')));
  card.appendChild(clubMfaPolicyControl(club, onChanged));
  return card;
}

export function clubMfaPolicyControl(club, onChanged) {
  const enabled = Boolean(club.mfaRequiredForAdmins);
  const me = getCurrentUser();
  const wrap = el('div', { class: 'flex gap-8 items-center' }, [
    badge(enabled ? t('mfa.clubPolicyOn') : t('mfa.clubPolicyOff'), enabled ? 'done' : 'neutral'),
  ]);
  const button = el('button', { type: 'button', class: 'btn btn-ghost btn-sm' }, enabled ? t('mfa.clubPolicyTurnOff') : t('mfa.clubPolicyTurnOn'));
  if (!enabled && !me?.mfaEnabled) {
    button.disabled = true;
    button.title = t('mfa.clubPolicyNeedsOwnMfa');
  }
  button.addEventListener('click', () => openConfirmDialog({
    title: t('mfa.clubPolicyTitle'),
    intro: enabled ? t('mfa.clubPolicyTurnOffIntro', { club: club.name }) : t('mfa.clubPolicyTurnOnIntro', { club: club.name }),
    needsPassword: true,
    needsSecondFactor: Boolean(me?.mfaEnabled),
    submitLabel: enabled ? t('mfa.clubPolicyTurnOff') : t('mfa.clubPolicyTurnOn'),
    on401Message: t('profile.errorInvalidCurrentPassword'),
    onSubmit: async (input) => {
      const result = await api.setClubMfaPolicy(club.id, { requiredForAdmins: !enabled, ...input });
      toast(result.mfaRequiredForAdmins ? t('mfa.clubPolicyOnToast') : t('mfa.clubPolicyOffToast'));
      onChanged?.(result.mfaRequiredForAdmins);
    },
  }));
  wrap.appendChild(button);
  if (!enabled && !me?.mfaEnabled) wrap.appendChild(el('span', { class: 'hint' }, t('mfa.clubPolicyNeedsOwnMfa')));
  return wrap;
}
