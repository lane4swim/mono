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

// docs/kampfrichter-modul-plan.md, Abschnitt 1.2: ein Konto kann künftig
// mehrere Rollen GLEICHZEITIG haben (z. B. Trainer:in UND Athlet:in),
// nicht nur genau eine. "superadmin" bleibt Sonderfall — exklusiv, nie mit
// einer anderen Rolle kombiniert (kein eigener Verein, siehe
// UserSchema.clubId-Kommentar unten) — und wird weiterhin nie per API
// vergeben (nur scripts/createSuperAdmin.ts).
export const UserRolesSchema = z
  .array(RoleSchema)
  .min(1, 'Mindestens eine Rolle ist erforderlich.')
  .refine((roles) => new Set(roles).size === roles.length, { message: 'Rollen dürfen nicht doppelt vorkommen.' })
  .refine((roles) => !(roles.includes('superadmin') && roles.length > 1), {
    message: '"superadmin" kann nicht mit einer anderen Rolle kombiniert werden.',
  });
export type UserRoles = z.infer<typeof UserRolesSchema>;

export const LocaleSchema = z.enum(['de-DE', 'en-US']);
export type Locale = z.infer<typeof LocaleSchema>;

// Sicherheitsreview 2026-08-29, Befund M2: E-Mail-Adressen wurden an
// KEINER Stelle normalisiert. `User.email` trägt in PostgreSQL ein
// `@unique` (siehe schema.prisma), und dessen Vergleich ist
// zeichengenau — „Anna@verein.de" und „anna@verein.de" waren dadurch
// zwei verschiedene Adressen. Drei konkrete Folgen:
//
//   1. Anmelde-Sackgasse: wer bei der Einladung als „Anna@verein.de"
//      erfasst wurde und sich später als „anna@verein.de" anmeldet,
//      bekommt „E-Mail-Adresse oder Passwort ist ungültig" — richtige
//      Zugangsdaten, kein Hinweis auf die Ursache.
//   2. Stille Sackgasse bei „Passwort vergessen": der Endpunkt antwortet
//      aus gutem Grund IMMER generisch (verhindert User-Enumeration,
//      siehe auth.service.ts: requestPasswordReset()) — eine
//      Schreibweisen-Abweichung ist von „Konto existiert nicht" also
//      nicht unterscheidbar, es kommt schlicht nie eine E-Mail an.
//   3. Doppelkonten: die Duplikat-Prüfungen in acceptInvitation() und
//      changeEmail() (beide über UserRepository.findByEmail()) ließen
//      sich durch eine abweichende Groß-/Kleinschreibung umgehen — für
//      EIN reales Postfach konnten zwei Konten mit unterschiedlichen
//      Rollen entstehen.
//
// Diese Schema-Ebene deckt Punkt (1) bis (3) für alle NEUEN Eingaben ab
// (`.trim().toLowerCase()` laufen als Zod-String-Checks in der hier
// notierten Reihenfolge, also VOR der `.email()`-Prüfung). Bereits
// gespeicherte Adressen in gemischter Schreibweise bleiben davon
// unberührt — deshalb ist der Abgleich in
// PrismaUserRepository.findByEmail() zusätzlich case-insensitiv
// (`mode: 'insensitive'`), statt hier eine Datenmigration zu erzwingen,
// die an genau den Doppelkonten aus (3) scheitern könnte.
//
// BEWUSST nur für EINGABE-Schemas (Login, „Passwort vergessen",
// E-Mail-Wechsel, Einladungen) — nicht für die Ausgabe-Schemas
// (UserSchema.email unten, InvitationSummarySchema, …): die beschreiben,
// was der Server LIEFERT, und dürfen einen bereits gespeicherten Wert
// nicht nachträglich umschreiben.
export const NormalizedEmailSchema = z.string().trim().toLowerCase().email();

export const UserSchema = z.object({
  id: z.string().uuid(),
  // null nur, wenn roles === ['superadmin'] — jede andere Rolle gehört
  // genau einem Verein an.
  clubId: z.string().uuid().nullable(),
  name: z.string().min(1),
  email: z.string().email(),
  roles: UserRolesSchema,
  athleteId: z.string().uuid().nullable(),
  locale: LocaleSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type User = z.infer<typeof UserSchema>;

// PATCH /api/users/:userId/roles (admin, eigener Verein) — ersetzt die
// vollständige Rollenmenge einer Person, siehe
// docs/kampfrichter-modul-plan.md Abschnitt 1.4. Bewusst kein Add/Remove-
// Diff-Endpunkt (Race-Condition-Vermeidung bei zwei gleichzeitigen
// Änderungen) — der Client schickt immer die vollständige Zielmenge.
export const UpdateUserRolesRequestSchema = z.object({
  roles: UserRolesSchema,
});
export type UpdateUserRolesRequest = z.infer<typeof UpdateUserRolesRequestSchema>;

// Antwort von GET /api/users (Nutzerverwaltung: bestehende
// Vereinsmitglieder anzeigen) — dieselbe öffentliche Nutzer-Form wie
// UserSchema, nur als Liste. Server sortiert bereits nach Rolle
// (admin → trainer → athlete) und danach nach Namen; das Frontend gruppiert
// zusätzlich visuell nach Rolle.
export const ClubMembersResponseSchema = z.object({
  users: z.array(UserSchema),
});
export type ClubMembersResponse = z.infer<typeof ClubMembersResponseSchema>;
