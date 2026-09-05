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
import { MODULE_KEYS, ModuleKeySchema } from './modules.js';
import { NormalizedEmailSchema } from './user.js';

export const ClubSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  // Modul-Pakete, die dieser Verein gebucht hat — siehe modules.ts:
  // MODULE_PACKAGES. Steuert Frontend-Sichtbarkeit und Sync-Zugriff.
  enabledModules: z.array(ModuleKeySchema),
  // Externe Vereinskennung für den Ergebnisimport (DSV7/Lenex) — generisch
  // statt DSV-spezifisch, siehe docs/dsv7-lenex-import-plan.md Abschnitt 3.1.
  // z. B. nationalIDType = "DSV", nationalID = die 4-stellige
  // DSV-Vereinskennzahl.
  nationalID: z.string().max(50).nullable(),
  nationalIDType: z.string().max(50).nullable(),
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
  // docs/kampfrichter-modul-plan.md, Abschnitt 2 — eine Person mit
  // mehreren Rollen (z. B. trainer + referee) zählt seit Phase A in
  // JEDEM passenden Zähler mit, die Summe kann also die Zahl der
  // tatsächlichen Konten übersteigen.
  referee: z.number().int().nonnegative(),
});
export type ClubMemberCounts = z.infer<typeof ClubMemberCountsSchema>;

export const ClubWithCountsSchema = ClubSchema.extend({
  memberCounts: ClubMemberCountsSchema,
});
export type ClubWithCounts = z.infer<typeof ClubWithCountsSchema>;

// `.max(200)` (Sicherheitsreview 2026-08, Befund N2): analog zu den
// entsprechenden Namensfeldern in entities.ts — Fastifys 1-MB-Bodylimit
// begrenzt den Schaden zwar auf HTTP-Ebene, aber ein einzelnes, absichtlich
// riesiges Feld hätte trotzdem unbemerkt akzeptiert und dauerhaft
// gespeichert werden können. `Club.name` wird zusätzlich in den
// E-Mail-Betreff geschrieben (siehe mail/mailer.ts).
export const CreateClubRequestSchema = z.object({
  name: z.string().min(1).max(200),
  // Sicherheitsreview 2026-08-29, Befund M2 — siehe NormalizedEmailSchema
  // (packages/shared-types/src/user.ts): die hier erfasste Adresse landet
  // unverändert in der Einladung und später als `User.email`; eine
  // versehentlich groß geschriebene Eingabe sperrte die eingeladene
  // Person sonst dauerhaft aus.
  adminEmail: NormalizedEmailSchema,
  adminName: z.string().min(1).max(200),
  // Default: alle Module aktiv — das Anlegen-Formular (clubForm.js) schickt
  // dieses Feld zwar immer explizit, andere/künftige Aufrufer sollen aber
  // nicht versehentlich einen Verein ohne jedes Modul anlegen.
  enabledModules: z.array(ModuleKeySchema).default(() => [...MODULE_KEYS]),
});
export type CreateClubRequest = z.infer<typeof CreateClubRequestSchema>;

export const UpdateClubRequestSchema = z.object({
  enabledModules: z.array(ModuleKeySchema),
});
export type UpdateClubRequest = z.infer<typeof UpdateClubRequestSchema>;

// Eigenständiger Endpunkt (statt Erweiterung von UpdateClubRequestSchema
// oben), damit Admins ihre eigene Vereinskennung pflegen können, ohne die
// Superadmin-only-Modulverwaltung mitzubenötigen — siehe
// invitations.service.ts: updateClubIdentity() und
// docs/dsv7-lenex-import-plan.md Abschnitt 3.1. Leerstring wird serverseitig
// als "löschen" (→ null) behandelt, damit eine einmal gesetzte Kennung im
// Formular auch wieder entfernt werden kann.
export const UpdateClubIdentityRequestSchema = z.object({
  nationalID: z.string().max(50).nullable(),
  nationalIDType: z.string().max(50).nullable(),
});
export type UpdateClubIdentityRequest = z.infer<typeof UpdateClubIdentityRequestSchema>;

// Nur diese vier Rollen lassen sich per Einladung vergeben — "superadmin"
// wird bewusst nie über die API vergeben (siehe scripts/createSuperAdmin.ts).
// "referee" (Kampfrichter:in, docs/kampfrichter-modul-plan.md, Abschnitt 2)
// kann wie jede andere Rolle direkt per Einladung vergeben werden — z. B.
// für eine Person, die im Verein ausschließlich als Kampfrichter:in aktiv
// ist, ohne selbst zu trainieren/zu schwimmen. Weitere Rollen kommen
// nachträglich ausschließlich über PATCH /api/users/:userId/roles hinzu
// (Abschnitt 1.4), nie direkt bei der Registrierung.
export const InvitationRoleSchema = z.enum(['admin', 'trainer', 'athlete', 'referee']);
export type InvitationRole = z.infer<typeof InvitationRoleSchema>;

export const CreateInvitationRequestSchema = z.object({
  // Sicherheitsreview 2026-08-29, Befund M2 — siehe CreateClubRequestSchema
  // oben bzw. NormalizedEmailSchema (packages/shared-types/src/user.ts).
  email: NormalizedEmailSchema,
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

// Sicherheitskorrektur (Sicherheitsreview 2026-08, Befund M3): das Token
// wurde zuvor als URL-Pfadparameter übertragen (GET /api/invitations/
// preview/:token) — Fastify protokolliert req.url für jede Anfrage, das
// Token landete dadurch im Klartext in Zugriffs-/Anwendungslogs. Als
// Body eines POST-Requests wird es nicht mitgeloggt. Der geteilte
// Einladungslink selbst (#/accept-invite/<token>, siehe
// invitations.service.ts: buildInviteUrl()) ist davon unberührt — das
// Token steht dort im URL-FRAGMENT, das der Browser nie an einen Server
// sendet; erst der Client liest es aus und schickt es hierüber weiter.
export const InvitationPreviewRequestSchema = z.object({
  token: z.string().min(1),
});
export type InvitationPreviewRequest = z.infer<typeof InvitationPreviewRequestSchema>;

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
  // `.max(200)` (Sicherheitsreview 2026-08, Befund N2) — siehe Begründung
  // bei CreateClubRequestSchema oben. `User.name` wird in jeder
  // Mitgliederliste gerendert.
  name: z.string().min(1).max(200),
  // `.max(200)` (Sicherheitsreview 2026-08, Befund N7): argon2id
  // verarbeitet beliebig lange Eingaben — bei 64 MiB Speicherkosten pro
  // Hashing-Versuch wäre ein unbegrenztes Feld ein unnötiger DoS-
  // Verstärker. 200 Zeichen liegt weit über jeder realistischen
  // Passphrase (siehe auth.passwordHint im Frontend).
  password: z.string().min(8, 'Passwort muss mindestens 8 Zeichen lang sein').max(200),
  consent: z
    .literal(true)
    .refine((v) => v === true, { message: 'Die Einwilligung zur Datenverarbeitung ist erforderlich.' }),
});
export type AcceptInvitationRequest = z.infer<typeof AcceptInvitationRequestSchema>;
