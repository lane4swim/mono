// Anzeige eines frisch erzeugten Einladungslinks — gemeinsam genutzt von
// modules/userManagement.js (Team einladen, Link neu erzeugen) und
// modules/athletes.js (Athlet:in aus dem Profil heraus einladen).
import { el } from './dom.js';
import { fmtDateShort } from './dates.js';
import { toast } from './ui.js';
import { openModal } from './modal.js';
import { t } from './i18n.js';

function buildInviteUrl(token) {
  return `${location.origin}${location.pathname}#/accept-invite/${token}`;
}

export function showInviteLinkModal(invitation) {
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
