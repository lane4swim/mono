// Kontozustand eines Athletenprofils (Athlete.accountMode, siehe
// packages/shared-types/src/entities.ts). Nicht jede:r Athlet:in bekommt
// ein eigenes Konto: "managed" pflegen nur Admin/Trainer:innen, nur
// "invitable" darf per Einladung mit einem Konto verknüpft werden — der
// Server erzwingt das (invitations.service.ts, sync.service.ts), dieses
// Modul spiegelt es für die Anzeige.
//
// Ob tatsächlich ein Konto oder eine offene Einladung existiert, steht
// nicht im Sync-Datenbestand, sondern nur hinter den Admin-Endpunkten
// GET /api/users und GET /api/invitations. loadAccountIndex() liefert
// deshalb für Trainer:innen, offline und im Demo-Modus null — die Anzeige
// fällt dann auf das reine accountMode-Flag zurück.
import * as api from './apiClient.js';
import { isAdmin } from './state.js';
import { IS_DEMO } from './demoMode.js';

export function isInvitable(athlete) {
  return athlete?.accountMode === 'invitable';
}

// Offene Konto-Einladung: nicht verwendet, nicht widerrufen, nicht
// abgelaufen, nicht "parent" (Eltern-Einladungen benennen nur das Kind).
function isOpenAccountInvitation(invitation, now) {
  return Boolean(invitation.athleteId)
    && invitation.role !== 'parent'
    && !invitation.usedAt
    && !invitation.revokedAt
    && new Date(invitation.expiresAt).getTime() >= now;
}

export function buildAccountIndex(users, invitations, now = Date.now()) {
  const linked = new Map();
  for (const user of users) if (user.athleteId) linked.set(user.athleteId, user);
  const pending = new Map();
  for (const invitation of invitations) {
    if (isOpenAccountInvitation(invitation, now)) pending.set(invitation.athleteId, invitation);
  }
  return { linked, pending };
}

// 'active' | 'invited' | 'managed' | 'notInvited' | 'invitable'.
// 'invitable' = einladbar, aber Kontozustand unbekannt (index === null).
// Ein verknüpftes Konto oder eine offene Einladung geht dem Flag vor, damit
// die Anzeige den tatsächlichen Zustand zeigt.
export function accountStatus(athlete, index) {
  if (index?.linked.has(athlete.id)) return 'active';
  if (index?.pending.has(athlete.id)) return 'invited';
  if (!isInvitable(athlete)) return 'managed';
  return index ? 'notInvited' : 'invitable';
}

export function canInviteAthlete(athlete, index) {
  return accountStatus(athlete, index) === 'notInvited';
}

export async function loadAccountIndex() {
  if (IS_DEMO || !isAdmin()) return null;
  try {
    const [membersResp, invitationsResp] = await Promise.all([api.listClubMembers(), api.listInvitations()]);
    return buildAccountIndex(membersResp.users, invitationsResp.invitations);
  } catch {
    return null;
  }
}
