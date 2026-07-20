// packages/shared-types/src/invitation.ts
//
// Vertrag für den einladungsbasierten Registrierungsprozess:
//   - Superadmin legt einen Verein an und lädt dessen ersten Admin ein
//     (POST /api/clubs).
//   - Admin (oder Superadmin) lädt Trainer:innen/Athlet:innen eines
//     bestehenden Vereins ein (POST /api/invitations).
//   - Eine offene Registrierung ohne gültige Einladung existiert nicht mehr
//     — POST /auth/register verlangt zwingend ein Einladungs-Token.
import { z } from 'zod';

export const ClubSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Club = z.infer<typeof ClubSchema>;

// Für die Superadmin-Oberfläche (Abschnitt "/admin"): Anzahl aktiver
// Mitglieder je Rolle, pro Verein. Athlet:innen-Konten zählen hier
// getrennt von Trainer:innen, damit die Übersicht auf einen Blick zeigt,
// wie "besetzt" ein Verein ist.
export const ClubMemberCountsSchema = z.object({
  admin: z.number().int().nonnegative(),
  trainer: z.number().int().nonnegative(),
  athlete: z.number().int().nonnegative(),
});
export type ClubMemberCounts = z.infer<typeof ClubMemberCountsSchema>;

export const ClubWithCountsSchema = ClubSchema.extend({
  memberCounts: ClubMemberCountsSchema,
});
export type ClubWithCounts = z.infer<typeof ClubWithCountsSchema>;

export const CreateClubRequestSchema = z.object({
  name: z.string().min(1),
  adminEmail: z.string().email(),
  adminName: z.string().min(1),
});
export type CreateClubRequest = z.infer<typeof CreateClubRequestSchema>;

// Nur diese drei Rollen lassen sich per Einladung vergeben — "superadmin"
// wird bewusst nie über die API vergeben (siehe scripts/createSuperAdmin.ts).
export const InvitationRoleSchema = z.enum(['admin', 'trainer', 'athlete']);
export type InvitationRole = z.infer<typeof InvitationRoleSchema>;

export const CreateInvitationRequestSchema = z.object({
  email: z.string().email(),
  role: InvitationRoleSchema,
  // Pflicht, wenn ein:e Superadmin eine:n Admin für einen bestehenden Verein
  // einlädt. Für Admin-Nutzer:innen, die Trainer:innen/Athlet:innen
  // einladen, wird clubId serverseitig ignoriert und stattdessen der eigene
  // Verein verwendet (siehe invitations.service.ts) — ein Admin kann nicht
  // in einen fremden Verein einladen.
  clubId: z.string().uuid().optional(),
  // Nur bei role === 'athlete' sinnvoll: verknüpft die Einladung mit einem
  // bereits angelegten Athletenprofil.
  athleteId: z.string().uuid().nullable().optional(),
});
export type CreateInvitationRequest = z.infer<typeof CreateInvitationRequestSchema>;

// Wird genau einmal zurückgegeben (bei Erstellung) — enthält das
// Klartext-Token. Danach ist nur noch der Hash gespeichert; das Token lässt
// sich nicht erneut abrufen (nur widerrufen und neu ausstellen).
export const IssuedInvitationSchema = z.object({
  id: z.string().uuid(),
  token: z.string(),
  email: z.string().email(),
  role: InvitationRoleSchema,
  clubId: z.string().uuid().nullable(),
  expiresAt: z.string().datetime(),
});
export type IssuedInvitation = z.infer<typeof IssuedInvitationSchema>;

export const CreateClubResponseSchema = z.object({
  club: ClubSchema,
  invitation: IssuedInvitationSchema,
});
export type CreateClubResponse = z.infer<typeof CreateClubResponseSchema>;

// Für Auflistungen (Verwaltungsansicht) — bewusst ohne Token.
export const InvitationSummarySchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  role: InvitationRoleSchema,
  clubId: z.string().uuid().nullable(),
  invitedById: z.string().uuid().nullable(),
  expiresAt: z.string().datetime(),
  usedAt: z.string().datetime().nullable(),
  revokedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});
export type InvitationSummary = z.infer<typeof InvitationSummarySchema>;

// Öffentlicher, nicht-authentifizierter Abruf vor dem Registrieren — zeigt
// der eingeladenen Person, für welchen Verein/welche Rolle die Einladung
// gilt, ohne interne IDs preiszugeben.
export const InvitationPreviewSchema = z.object({
  email: z.string().email(),
  role: InvitationRoleSchema,
  clubName: z.string().nullable(),
  expiresAt: z.string().datetime(),
});
export type InvitationPreview = z.infer<typeof InvitationPreviewSchema>;

export const AcceptInvitationRequestSchema = z.object({
  token: z.string().min(1),
  name: z.string().min(1),
  password: z.string().min(8, 'Passwort muss mindestens 8 Zeichen lang sein'),
  consent: z
    .literal(true)
    .refine((v) => v === true, { message: 'Die Einwilligung zur Datenverarbeitung ist erforderlich.' }),
});
export type AcceptInvitationRequest = z.infer<typeof AcceptInvitationRequestSchema>;
