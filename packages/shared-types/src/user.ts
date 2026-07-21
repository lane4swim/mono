// packages/shared-types/src/user.ts
//
// Vertrag für einen Nutzer-Datensatz, wie er zwischen Client und Server
// ausgetauscht wird.
//
// Rollenmodell (siehe docs/backend-plan.md, jetzt erweitert um den
// einladungsbasierten Registrierungsprozess):
//   - superadmin: legt neue Vereine an und lädt deren erste:n Admin ein.
//                 Gehört selbst zu keinem Verein (clubId: null).
//   - admin:      verwaltet genau einen Verein, lädt Trainer:innen und
//                 Athlet:innen dieses Vereins ein.
//   - trainer / athlete: wie bisher, jeweils genau einem Verein zugehörig.
import { z } from 'zod';

export const RoleSchema = z.enum(['superadmin', 'admin', 'trainer', 'athlete']);
export type Role = z.infer<typeof RoleSchema>;

export const LocaleSchema = z.enum(['de-DE', 'en-US']);
export type Locale = z.infer<typeof LocaleSchema>;

export const UserSchema = z.object({
  id: z.string().uuid(),
  // null nur für role === 'superadmin' — jede andere Rolle gehört genau
  // einem Verein an.
  clubId: z.string().uuid().nullable(),
  name: z.string().min(1),
  email: z.string().email(),
  role: RoleSchema,
  athleteId: z.string().uuid().nullable(),
  locale: LocaleSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type User = z.infer<typeof UserSchema>;

// Antwort von GET /api/users (Nutzerverwaltung: bestehende
// Vereinsmitglieder anzeigen) — dieselbe öffentliche Nutzer-Form wie
// UserSchema, nur als Liste. Server sortiert bereits nach Rolle
// (admin → trainer → athlete) und danach nach Namen; das Frontend gruppiert
// zusätzlich visuell nach Rolle.
export const ClubMembersResponseSchema = z.object({
  users: z.array(UserSchema),
});
export type ClubMembersResponse = z.infer<typeof ClubMembersResponseSchema>;
