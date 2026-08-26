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
import { el } from '../dom.js';
import { toast } from '../ui.js';
import { openModal } from '../modal.js';
import { field, textInput, formActions } from '../forms.js';
import { describeError } from '../apiClient.js';
import * as api from '../apiClient.js';
import { t } from '../i18n.js';
import { MODULE_KEYS } from '../router.js';

// Eine Checkbox je togglebarem Modul-Paket (siehe router.js: MODULE_KEYS/
// CORE_MODULE_IDS) — Kern-Module (Dashboard/Profil/...) tauchen hier
// bewusst nicht auf, da sie nie abschaltbar sind. Labels über die
// ohnehin vorhandenen Sidebar-Übersetzungen `nav.<key>` (Modul-Key ===
// Router-ID, siehe MODULE_KEYS-Kommentar) — keine eigenen Übersetzungen
// je Modul nötig. Wiederverwendet von openCreateClubModal() UND admin.js'
// Bearbeiten-Ansicht (dort mit den aktuell gebuchten Modulen vorbelegt).
export function buildModuleCheckboxes(selected = MODULE_KEYS) {
  const selectedSet = new Set(selected);
  const rows = MODULE_KEYS.map((key) => {
    const input = el('input', { type: 'checkbox' });
    input.checked = selectedSet.has(key);
    input.dataset.moduleKey = key;
    return el('label', { class: 'consent-checkbox' }, [input, el('span', {}, t(`nav.${key}`))]);
  });
  const node = el('div', { style: 'grid-column:1/-1;display:flex;flex-direction:column;gap:6px' }, [
    el('span', { class: 'hint' }, t('usermgmt.formModules')),
    ...rows,
  ]);
  const getSelected = () => rows
    .filter((row) => row.querySelector('input').checked)
    .map((row) => row.querySelector('input').dataset.moduleKey);
  return { node, getSelected };
}

export function openCreateClubModal({ onSuccess }) {
  const form = el('form', { class: 'form-grid' });
  const fClubName = textInput('', { required: true });
  const fAdminName = textInput('', { required: true });
  const fAdminEmail = textInput('', { type: 'email', required: true });
  form.appendChild(field(t('usermgmt.formClubName'), fClubName, { span2: true }));
  form.appendChild(field(t('usermgmt.formAdminName'), fAdminName));
  form.appendChild(field(t('usermgmt.formAdminEmail'), fAdminEmail));
  // Neuer Verein startet standardmäßig mit ALLEN Modulen aktiv (siehe
  // buildModuleCheckboxes()-Default) — die/der Superadmin deselektiert
  // gezielt, statt bei jedem neuen Verein erst alles einzeln anhaken zu
  // müssen.
  const { node: modulesNode, getSelected: getSelectedModules } = buildModuleCheckboxes();
  form.appendChild(modulesNode);
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
      const result = await api.createClub({
        name: fClubName.value.trim(),
        adminEmail: fAdminEmail.value.trim(),
        adminName: fAdminName.value.trim(),
        enabledModules: getSelectedModules(),
      });
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

// "Module bearbeiten"-Formular für einen BESTEHENDEN Verein — von
// userManagement.js (Nutzerverwaltung, für superadmin) UND admin/admin.js
// (eigenständige "/admin"-Oberfläche) gleichermaßen genutzt, damit die
// Modul-Zuordnung eines Vereins an beiden Stellen konsistent bearbeitbar
// ist. `club` braucht nur `id`, `name` und `enabledModules`.
export function openEditClubModulesModal({ club, onSuccess }) {
  const form = el('form', { class: 'form-grid' });
  const { node: modulesNode, getSelected: getSelectedModules } = buildModuleCheckboxes(club.enabledModules);
  form.appendChild(modulesNode);
  const errorBox = el('p', { class: 'form-error', style: 'grid-column:1/-1;display:none' });
  form.appendChild(errorBox);
  const { row: actionsRow, submitBtn } = formActions({ onCancel: () => close(), submitLabel: t('common.save') });
  form.appendChild(actionsRow);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorBox.style.display = 'none';
    submitBtn.disabled = true;
    try {
      const result = await api.updateClub(club.id, { enabledModules: getSelectedModules() });
      close();
      await onSuccess(result);
    } catch (err) {
      errorBox.textContent = describeError(err);
      errorBox.style.display = 'block';
    } finally {
      submitBtn.disabled = false;
    }
  });
  const { close } = openModal({ title: `${t('usermgmt.editClubModalTitle')} — ${club.name}`, bodyNode: form, wide: true });
}
