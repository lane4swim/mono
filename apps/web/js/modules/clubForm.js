// ============================================================
// modules/clubForm.js — "Verein anlegen"-Formular.
//
// Code-Review, Befund R4: war byte-identisch (Felder, Validierung,
// Fehlerbehandlung) in modules/userManagement.js UND admin/admin.js
// dupliziert — einziger Unterschied war, was nach erfolgreichem Anlegen
// passiert (userManagement.js öffnet showInviteLinkModal(), admin.js zeigt
// stattdessen einen Toast mit der Ziel-E-Mail und wartet auf ein Refresh
// der Vereinsliste). Dieser Unterschied bleibt beim jeweiligen Aufrufer —
// hier nur der onSuccess(result)-Callback dafür.
import { el, field, textInput, toast, openModal, formActions } from '../utils.js';
import { describeError } from '../apiClient.js';
import * as api from '../apiClient.js';
import { t } from '../i18n.js';

export function openCreateClubModal({ onSuccess }) {
  const form = el('form', { class: 'form-grid' });
  const fClubName = textInput('', { required: true });
  const fAdminName = textInput('', { required: true });
  const fAdminEmail = textInput('', { type: 'email', required: true });
  form.appendChild(field(t('usermgmt.formClubName'), fClubName, { span2: true }));
  form.appendChild(field(t('usermgmt.formAdminName'), fAdminName));
  form.appendChild(field(t('usermgmt.formAdminEmail'), fAdminEmail));
  const errorBox = el('p', { class: 'form-error', style: 'grid-column:1/-1;display:none' });
  form.appendChild(errorBox);
  const { row: actionsRow, submitBtn } = formActions({ onCancel: () => close(), submitLabel: t('common.create') });
  form.appendChild(actionsRow);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorBox.style.display = 'none';
    if (!fClubName.value.trim()) { toast(t('usermgmt.validationClubName'), 'error'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fAdminEmail.value.trim())) { toast(t('usermgmt.validationEmail'), 'error'); return; }
    submitBtn.disabled = true;
    try {
      const result = await api.createClub({ name: fClubName.value.trim(), adminEmail: fAdminEmail.value.trim(), adminName: fAdminName.value.trim() });
      close();
      await onSuccess(result);
    } catch (err) {
      errorBox.textContent = describeError(err);
      errorBox.style.display = 'block';
    } finally {
      submitBtn.disabled = false;
    }
  });
  const { close } = openModal({ title: t('usermgmt.clubModalTitle'), bodyNode: form, wide: true });
}
