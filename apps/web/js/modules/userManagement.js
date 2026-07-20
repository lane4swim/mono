// ============================================================
// modules/userManagement.js — "Nutzerverwaltung"
//
// Phase 4: ruft jetzt die echten Backend-Endpunkte auf (POST/GET /api/clubs,
// POST/GET/DELETE /api/invitations — alle bereits in Phase 1 implementiert),
// statt den Ablauf nur lokal in IndexedDB zu simulieren.
//
// Bewusste Lücke: Es gibt (noch) keinen Endpunkt, um bestehende Nutzer:innen
// eines Vereins aufzulisten (kein GET /api/users) — das frühere Element
// "Bestehende Nutzer:innen" entfällt daher hier ersatzlos, statt eine
// erfundene/unvollständige Ansicht zu zeigen. Siehe README für diesen
// offenen Punkt.
// ============================================================
import {
  el, clear, field, textInput, selectInput, openModal, confirmAction, toast, badge,
  emptyState, laneWave, beginRender, fmtDateShort,
} from '../utils.js';
import { getCurrentUser, isSuperAdmin } from '../state.js';
import * as api from '../apiClient.js';
import { ApiError, NetworkError } from '../apiClient.js';
import { t } from '../i18n.js';

export const userManagementModule = {
  id: 'usermgmt',
  roles: ['superadmin', 'admin'],
  icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M17 21v-2a4 4 0 00-4-4H7a4 4 0 00-4 4v2"/><circle cx="10" cy="7" r="4"/><path d="M22 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>`,
  async render(container) {
    const isCurrent = beginRender(container);
    clear(container);
    try {
      const [clubs, invitationsResp] = await Promise.all([
        isSuperAdmin() ? api.listClubs() : Promise.resolve({ clubs: [] }),
        api.listInvitations(),
      ]);
      if (!isCurrent()) return;
      renderView(container, clubs.clubs, invitationsResp.invitations);
    } catch (err) {
      if (!isCurrent()) return;
      renderError(container, err);
    }
  }
};

function renderError(container, err) {
  const message = err instanceof NetworkError ? t('usermgmt.errorNetwork')
    : err instanceof ApiError ? err.message
    : t('usermgmt.errorUnknown');
  container.appendChild(el('div', { class: 'empty-state' }, [
    el('h3', {}, t('common.somethingWentWrong')),
    el('p', {}, message),
  ]));
}

function statusOf(invitation) {
  if (invitation.revokedAt) return 'revoked';
  if (invitation.usedAt) return 'used';
  if (new Date(invitation.expiresAt).getTime() < Date.now()) return 'expired';
  return 'pending';
}
function statusBadge(status) {
  const map = { pending: ['statusPending', 'progress'], used: ['statusUsed', 'done'], expired: ['statusExpired', 'neutral'], revoked: ['statusRevoked', 'open'] };
  const [key, variant] = map[status];
  return badge(t(`usermgmt.${key}`), variant);
}

function buildInviteUrl(token) {
  return `${location.origin}${location.pathname}#/accept-invite/${token}`;
}

function renderView(container, clubs, invitations) {
  const me = getCurrentUser();
  const wrap = el('div');
  wrap.appendChild(el('div', { class: 'page-head' }, [
    el('div', {}, [el('div', { class: 'page-eyebrow' }, t('usermgmt.eyebrow')), el('h1', { class: 'mt-0' }, t('usermgmt.title'))]),
  ]));
  wrap.appendChild(laneWave());
  wrap.appendChild(el('p', {}, isSuperAdmin() ? t('usermgmt.superadminIntro') : t('usermgmt.adminIntro')));

  if (isSuperAdmin()) {
    wrap.appendChild(renderClubsSection(clubs, refresh));
  }

  wrap.appendChild(renderInviteSection(clubs, refresh));
  wrap.appendChild(renderInvitationsList(invitations, clubs, refresh));

  wrap.appendChild(el('p', { class: 'hint', style: 'margin-top:24px' }, t('usermgmt.note')));

  container.appendChild(wrap);

  async function refresh() {
    clear(container);
    try {
      const [c2, i2] = await Promise.all([
        isSuperAdmin() ? api.listClubs() : Promise.resolve({ clubs: [] }),
        api.listInvitations(),
      ]);
      renderView(container, c2.clubs, i2.invitations);
    } catch (err) {
      renderError(container, err);
    }
  }
}

// ---------------- Superadmin: Vereine anlegen ----------------
function renderClubsSection(clubs, onChanged) {
  const card = el('div', { class: 'card mb-16' }, [
    el('div', { class: 'flex justify-between items-center mb-16' }, [
      el('h3', { class: 'mt-0' }, t('usermgmt.clubsSection')),
      el('button', { class: 'btn btn-primary btn-sm', onclick: () => openCreateClubModal(onChanged) }, t('usermgmt.createClub')),
    ]),
  ]);
  if (clubs.length === 0) {
    card.appendChild(emptyState(t('usermgmt.clubsSection'), t('usermgmt.noClubsYet'), null));
  } else {
    const table = el('table');
    table.appendChild(el('thead', {}, el('tr', {}, [el('th', {}, t('usermgmt.formClubName')), el('th', {}, '')])));
    const tbody = el('tbody');
    clubs.forEach(club => tbody.appendChild(el('tr', {}, [el('td', {}, club.name), el('td', {}, fmtDateShort((club.createdAt || '').slice(0, 10)))])));
    table.appendChild(tbody);
    card.appendChild(el('div', { class: 'table-wrap' }, table));
  }
  return card;
}

function openCreateClubModal(onChanged) {
  const form = el('form', { class: 'form-grid' });
  const fClubName = textInput('', { required: true });
  const fAdminName = textInput('', { required: true });
  const fAdminEmail = textInput('', { type: 'email', required: true });
  form.appendChild(field(t('usermgmt.formClubName'), fClubName, { span2: true }));
  form.appendChild(field(t('usermgmt.formAdminName'), fAdminName));
  form.appendChild(field(t('usermgmt.formAdminEmail'), fAdminEmail));
  const errorBox = el('p', { class: 'form-error', style: 'grid-column:1/-1;display:none' });
  form.appendChild(errorBox);
  const submitBtn = el('button', { type: 'submit', class: 'btn btn-primary' }, t('common.create'));
  form.appendChild(el('div', { class: 'form-actions', style: 'grid-column:1/-1' }, [
    el('button', { type: 'button', class: 'btn btn-ghost', onclick: () => close() }, t('common.cancel')),
    submitBtn,
  ]));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorBox.style.display = 'none';
    if (!fClubName.value.trim()) { toast(t('usermgmt.validationClubName'), 'error'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fAdminEmail.value.trim())) { toast(t('usermgmt.validationEmail'), 'error'); return; }
    submitBtn.disabled = true;
    try {
      const result = await api.createClub({ name: fClubName.value.trim(), adminEmail: fAdminEmail.value.trim(), adminName: fAdminName.value.trim() });
      toast(t('usermgmt.clubCreated'));
      close();
      onChanged?.();
      showInviteLinkModal(result.invitation);
    } catch (err) {
      errorBox.textContent = describeError(err);
      errorBox.style.display = 'block';
    } finally {
      submitBtn.disabled = false;
    }
  });
  const { close } = openModal({ title: t('usermgmt.clubModalTitle'), bodyNode: form, wide: true });
}

// ---------------- Admin/Superadmin: Team einladen ----------------
function renderInviteSection(clubs, onChanged) {
  const card = el('div', { class: 'card mb-16' }, [
    el('div', { class: 'flex justify-between items-center mb-16' }, [
      el('h3', { class: 'mt-0' }, t('usermgmt.inviteSection')),
      el('button', { class: 'btn btn-accent btn-sm', onclick: () => openInviteModal(clubs, onChanged) }, t('usermgmt.inviteTrainerOrAthlete')),
    ]),
  ]);
  return card;
}

function openInviteModal(clubs, onChanged) {
  const isSuper = isSuperAdmin();
  const form = el('form', { class: 'form-grid' });
  const fRole = selectInput([{ value: 'trainer', label: t('settings.role_trainer') }, { value: 'athlete', label: t('settings.role_athlete') }], 'trainer');
  const fEmail = textInput('', { type: 'email', required: true });
  const fClub = isSuper
    ? selectInput(clubs.map(c => ({ value: c.id, label: c.name })), clubs[0]?.id || '')
    : null;
  form.appendChild(field(t('usermgmt.formRole'), fRole));
  form.appendChild(field(t('usermgmt.formEmail'), fEmail));
  if (fClub) form.appendChild(field(t('usermgmt.colClub'), fClub, { span2: true }));
  const errorBox = el('p', { class: 'form-error', style: 'grid-column:1/-1;display:none' });
  form.appendChild(errorBox);
  const submitBtn = el('button', { type: 'submit', class: 'btn btn-primary' }, t('common.create'));
  form.appendChild(el('div', { class: 'form-actions', style: 'grid-column:1/-1' }, [
    el('button', { type: 'button', class: 'btn btn-ghost', onclick: () => close() }, t('common.cancel')),
    submitBtn,
  ]));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorBox.style.display = 'none';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fEmail.value.trim())) { toast(t('usermgmt.validationEmail'), 'error'); return; }
    submitBtn.disabled = true;
    try {
      const invitation = await api.createInvitation({
        email: fEmail.value.trim(),
        role: fRole.value,
        clubId: isSuper ? fClub.value : undefined,
      });
      toast(t('usermgmt.inviteCreated'));
      close();
      onChanged?.();
      showInviteLinkModal(invitation);
    } catch (err) {
      errorBox.textContent = describeError(err);
      errorBox.style.display = 'block';
    } finally {
      submitBtn.disabled = false;
    }
  });
  const { close } = openModal({ title: t('usermgmt.inviteModalTitle'), bodyNode: form, wide: true });
}

function showInviteLinkModal(invitation) {
  const url = buildInviteUrl(invitation.token);
  const body = el('div');
  body.appendChild(el('p', {}, t('usermgmt.inviteLinkHint', { date: fmtDateShort((invitation.expiresAt || '').slice(0, 10)) })));
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

// Zeigt den Einladungslink für eine BEREITS bestehende, noch nicht
// angenommene Einladung erneut an — z. B. um ihn per SMS statt E-Mail zu
// teilen. Wichtig: das Klartext-Token wird serverseitig NIE gespeichert
// (nur sein Hash, analog zu einem Passwort) und lässt sich daher nicht
// nachträglich auslesen. Diese Funktion widerruft die alte Einladung und
// stellt eine neue mit denselben Daten (E-Mail/Rolle/Verein) aus — der
// alte Link wird dadurch ungültig, was auch so kommuniziert wird
// (siehe usermgmt.regenerateLinkConfirm).
async function regenerateInvitationLink(invitation, onChanged) {
  try {
    await api.revokeInvitation(invitation.id);
    const fresh = await api.createInvitation({
      email: invitation.email,
      role: invitation.role,
      clubId: invitation.clubId || undefined,
    });
    toast(t('usermgmt.linkRegenerated'));
    onChanged?.();
    showInviteLinkModal(fresh);
  } catch (err) {
    toast(describeError(err), 'error');
  }
}

// ---------------- Ausstehende/verwendete Einladungen ----------------
function renderInvitationsList(invitations, clubs, onChanged) {
  const card = el('div', { class: 'card mb-16' }, [el('h3', { class: 'mt-0' }, t('usermgmt.pendingInvitesSection'))]);
  if (invitations.length === 0) { card.appendChild(el('p', {}, t('usermgmt.noInvitesYet'))); return card; }

  const table = el('table');
  table.appendChild(el('thead', {}, el('tr', {}, [
    el('th', {}, t('usermgmt.colEmail')), el('th', {}, t('usermgmt.colRole')), el('th', {}, t('usermgmt.colClub')),
    el('th', {}, t('usermgmt.colStatus')), el('th', {}, t('usermgmt.colExpires')), el('th', {}, ''),
  ])));
  const tbody = el('tbody');
  invitations.slice().sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')).forEach(invitation => {
    const status = statusOf(invitation);
    const club = clubs.find(c => c.id === invitation.clubId);
    tbody.appendChild(el('tr', {}, [
      el('td', {}, invitation.email), el('td', {}, badge(t(`settings.role_${invitation.role}`), 'neutral')),
      el('td', {}, club?.name || (invitation.clubId ? t('usermgmt.yourClubLabel') : '—')), el('td', {}, statusBadge(status)),
      el('td', {}, fmtDateShort((invitation.expiresAt || '').slice(0, 10))),
      el('td', {}, status === 'pending' ? el('div', { class: 'flex gap-8' }, [
        el('button', {
          class: 'btn btn-ghost btn-sm',
          onclick: () => confirmAction(t('usermgmt.regenerateLinkConfirm'), () => regenerateInvitationLink(invitation, onChanged), {
            title: t('usermgmt.regenerateLinkTitle'), confirmLabel: t('usermgmt.regenerateLinkButton'),
          }),
        }, t('usermgmt.regenerateLinkButton')),
        el('button', {
          class: 'btn btn-danger btn-sm',
          onclick: () => confirmAction(t('usermgmt.revokeConfirm'), async () => {
            try {
              await api.revokeInvitation(invitation.id);
              toast(t('usermgmt.inviteRevoked'));
              onChanged?.();
            } catch (err) {
              toast(describeError(err), 'error');
            }
          }),
        }, t('usermgmt.revokeInvite')),
      ]) : null),
    ]));
  });
  table.appendChild(tbody);
  card.appendChild(el('div', { class: 'table-wrap' }, table));
  return card;
}

function describeError(err) {
  if (err instanceof NetworkError) return t('usermgmt.errorNetwork');
  if (err instanceof ApiError) return err.message;
  return t('usermgmt.errorUnknown');
}
