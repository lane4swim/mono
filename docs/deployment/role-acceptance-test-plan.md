# Lane 1 — Role-Based Deployment Acceptance Test Plan

**Applies to:** every new deployment of Lane 1 (`apps/api` + `apps/web`),
on any host covered by `docs/deployment/` (Hetzner, netcup, OVHcloud,
Raspberry Pi, macOS, GitHub Codespaces). That means first installs,
upgrades (new commit or new migrations) and infrastructure changes (new
server, new Nginx/TLS config, a new database).

**Goal:** show, before a deployment is released to clubs, that **each of the
six roles** (`superadmin`, `admin`, `trainer`, `athlete`, `referee`, `parent`;
see `packages/shared-types/src/user.ts`) can do everything it is meant to do,
and can do **nothing** it is not meant to do. This must hold in the UI and,
more importantly, at the API, where the UI can be bypassed.

**Sources of truth this plan is derived from** (if they change, update this
plan):

| Concern | File |
|---|---|
| Role enum, role combination rules | `packages/shared-types/src/user.ts` |
| Invitable roles | `packages/shared-types/src/invitation.ts` (`InvitationRoleSchema`) |
| Module packages ↔ routes ↔ stores | `packages/shared-types/src/modules.ts` |
| Sync read/write matrix per store | `apps/api/src/modules/sync/sync.permissions.ts` |
| Athlete row/field scoping | `apps/api/src/modules/sync/sync.athleteScope.ts`, `sync.service.ts` |
| REST role guards | `apps/api/src/modules/*/*.route.ts` (`requireAnyRole(...)`) |
| UI module visibility | `roles:` in `apps/web/js/modules/*.js`, `apps/web/js/router.js`, `apps/web/js/shell.js` |
| MFA enforcement | `apps/api/src/modules/mfa/mfa.core.ts`, `MFA_ENFORCE` |

---

## 1. Process overview

| Phase | Name | Who | Blocking? | Est. time |
|---|---|---|---|---|
| P0 | Pre-deployment gate | Deployer | Yes | 15 min |
| P1 | Infrastructure smoke | Deployer | Yes | 15 min |
| P2 | Test fixtures | Deployer | Yes | 20 min |
| P3 | Common account tests (every role) | Tester | Yes | 45 min |
| P4 | Per-role functional suites | Tester(s), one per role is ideal | Yes | 2–3 h |
| P5 | API access-control matrix | Tester / script | Yes | 30 min (scripted) |
| P6 | Sync permission matrix | Tester / script | Yes | 30 min |
| P7 | Multi-role and role-change tests | Tester | Yes | 30 min |
| P8 | Tenant isolation (club A vs. club B) | Tester | Yes | 30 min |
| P9 | Module-package gating | Tester | Yes | 30 min |
| P10 | Offline / PWA / sync conflicts | Tester | Yes for releases touching `apps/web` or sync | 45 min |
| P11 | Background jobs, e-mail, push | Deployer | Yes for first installs; spot-check on upgrades | 30 min |
| P12 | Audit-log verification | Tester (admin + superadmin) | Yes | 15 min |
| P13 | Clean-up, sign-off, rollback decision | Deployer | Yes | 15 min |

**Reduced run (hotfix / patch upgrade without migrations):** P0, P1, P3 for
all roles, P5 fully (scripted), and the P4 cases tagged **[core]**. A full
run is mandatory for any deployment that
- adds or changes a Prisma migration,
- touches `sync.permissions.ts`, `sync.athleteScope.ts`, `authorize.ts`,
  `authenticate.ts`, any `*.route.ts`, `modules.ts`, `user.ts` or `invitation.ts`,
- changes `roles:` of any frontend module, or
- is the first deployment on a new host.

### 1.1 Severity and go/no-go

| Severity | Definition | Release? |
|---|---|---|
| **S1 — Critical** | Privilege escalation, cross-club data access, a role sees data it must not see (e.g. foreign athletes' birthdate, other athletes' attendance, trainer notes), auth bypass, data loss, or the deployment is unreachable. | **No.** Roll back (P13). |
| **S2 — Major** | A role cannot do a core task it is entitled to (log in, sync, accept an invitation, record attendance, respond to a referee assignment, see a child's overview). | **No**, unless a documented workaround exists and the product owner signs off in writing. |
| **S3 — Minor** | A non-core feature is broken, there is a wrong label or translation, or the layout is broken on one viewport. | Yes, with a ticket. |
| **S4 — Cosmetic** | Anything else. | Yes. |

**Exit criteria:** zero open S1/S2 findings, 100 % of P5/P6 matrix cells
pass, and every executed case is recorded with *Pass / Fail / Blocked* plus
evidence (see §14).

### 1.2 Conventions used in test cases

- **ID scheme:** `<phase>-<role>-<nn>`, e.g. `P4-ATH-07`. Role codes:
  `SA` superadmin, `ADM` admin, `TRN` trainer, `ATH` athlete, `REF` referee,
  `PAR` parent, `ALL` = repeat for every role.
- **UI** = through the PWA at `https://<host>/` (or `/admin` for superadmin).
  **API** = direct HTTP call with the role's access token (see §13 helpers),
  which bypasses any UI hiding.
- **Expected `403`** means HTTP 403 with body `{"error":"forbidden",…}` from
  `requireAnyRole`, unless `module_not_enabled` is stated.
- Every negative test must be run **at the API**. A hidden button proves
  nothing.

---

## 2. P0 — Pre-deployment gate

| ID | Check | Expected |
|---|---|---|
| P0-01 | CI (`.github/workflows/ci.yml`) is green on the exact commit being deployed. | All jobs green: lint, typecheck, unit tests for `apps/api`, `apps/web` and `packages/*`, and the integration tests (`apps/api/test-integration`). |
| P0-02 | Record the commit SHA, the previous production SHA, and the list of new migrations in `apps/api/prisma/migrations/` between the two. | Written into the test record. |
| P0-03 | Database backup taken **before** `prisma migrate deploy`, and a restore of that backup tested on a scratch DB (at least on first install and before every migration-bearing release). | Backup file exists, restore succeeds, row counts match. |
| P0-04 | `apps/api/.env` reviewed against `apps/api/.env.example`: `NODE_ENV=production`, `DATABASE_URL` uses the DML-only role `lane1_app` (**not** `lane1_migrator`), `CORS_ORIGIN` and `FRONTEND_BASE_URL` equal the real public origin, `TRUSTED_PROXY_IPS` set, JWT key pair present, `TOTP_ENCRYPTION_KEY` set, `MFA_ENFORCE=true` (production), SMTP configured, VAPID keys configured if push is offered, `JOB_SCHEDULER_ENABLED=true`. | All present. The API refuses to start on invalid config (see `apps/api/src/config/env.ts`). |
| P0-05 | Confirm that `create-test-accounts.sh` / `prisma/seed.ts` will **not** be run against production (they share one known password across accounts, including a superadmin). | Acknowledged. Production fixtures are created via invitations (§4.2). |

## 3. P1 — Infrastructure smoke

| ID | Check | Expected |
|---|---|---|
| P1-01 | `curl -s https://<host>/health` | `200`, `{"status":"ok","uptimeSeconds":…,"jobs":"ok"\|"unknown"}`. `jobs:"unknown"` is acceptable only right after a first install; it must not be `"stale"`. |
| P1-02 | `npx prisma migrate status` (run as `lane1_migrator`) | "Database schema is up to date"; every migration listed in P0-02 is applied. |
| P1-03 | Process manager: `pm2 status lane1-api` (or the host's equivalent) | `online`, no restart loop (restart count stable over 5 min). |
| P1-04 | TLS: `curl -vI https://<host>/` and `http://<host>/` | Valid certificate for the domain; HTTP redirects to HTTPS. |
| P1-05 | Security headers on `/` and `/api/me` | HSTS, CSP, `X-Content-Type-Options: nosniff` and frame protection present (as set by `apps/api/src/plugins/security.ts` and Nginx). |
| P1-06 | CORS: `OPTIONS /api/me` with `Origin: https://evil.example` | No `Access-Control-Allow-Origin` for the foreign origin; the configured origin is allowed. |
| P1-07 | Static assets: `/`, `/manifest.json`, `/sw.js`, `/admin/`, `/help/` | All `200`; `sw.js` is not cached long-term (it must update). |
| P1-08 | The DB user of the running API has no DDL rights: as `lane1_app`, `CREATE TABLE x(id int);` | `permission denied`. |
| P1-09 | Unauthenticated `GET /api/me` | `401 unauthorized`. |
| P1-10 | Server log after start | No stack traces; no secrets (tokens, passwords, TOTP secrets) logged. |

## 4. P2 — Test fixtures

### 4.1 Required accounts

Two clubs are required so tenant isolation can be tested (P8).

| Alias | Club | Roles | Notes |
|---|---|---|---|
| `SA` | — | `superadmin` | `clubId = null`; TOTP set up. |
| `A-ADM1` | A | `admin` | |
| `A-ADM2` | A | `admin` | Second admin, needed for the last-admin rule (P7). |
| `A-TRN1` | A | `trainer` | Assigned as trainer of group `A-G1`. |
| `A-TRN2` | A | `trainer` | Not assigned to `A-G1`. |
| `A-ATH1` | A | `athlete` | Linked athlete profile `Ath-1` (`accountMode: invitable`) in `A-G1`. |
| `A-ATH2` | A | `athlete` | Linked athlete profile `Ath-2` in `A-G1`, used for "other athlete" checks. |
| `A-REF1` | A | `referee` | Pure referee. |
| `A-PAR1` | A | `parent` | Linked to `Child-1` (`accountMode: managed`). |
| `A-TA` | A | `trainer`, `athlete` | Multi-role combination. |
| `A-TR` | A | `trainer`, `referee` | Multi-role combination. |
| `A-AR` | A | `athlete`, `referee` | Multi-role combination. |
| `B-ADM1` | B | `admin` | Foreign club. |
| `B-TRN1` | B | `trainer` | |
| `B-ATH1` | B | `athlete` | |

Club A has **all module packages** enabled. Club B has all enabled
initially; P9 switches them off one at a time.

Seed data in club A (created by `A-ADM1`/`A-TRN1` during P4, or beforehand):
group `A-G1`, at least 3 athlete profiles (`Ath-1`, `Ath-2`, `Child-1`)
with birthdate, gender, joinDate and notes filled in, 1 competition with
entries and `refereesRequired > 0`, 2 training sessions in `A-G1` with
attendance for `Ath-1` and `Ath-2` and a `trainerNote`, 1 plan, 1 template,
1 exercise, 1 section template, 1 calendar entry, 1 announcement,
2 action items (one for `Ath-1`, one for `Ath-2`), and results for
`Ath-1` and `Ath-2`.

### 4.2 How to create them

- **Test/staging/Codespace instance:**
  `bash scripts/create-test-accounts.sh --count=2` creates `test-<role>-<n>@example.org`
  for all six roles, a test club and a test group. Combination accounts,
  club B, the second admin and the seed data are then added through the UI
  as described for production below.
- **Production:** create fixtures **only through the real invitation flow**,
  which doubles as the test of that flow:
  `SA` creates club "ZZ-Abnahmetest-A" and "ZZ-Abnahmetest-B" (clearly
  named, so they can be deleted later) → admin invitations → admins invite
  the other roles. Use mailboxes the testers control (plus-addressing), or
  copy the invitation links from user management. `SA` on production is the
  real operator account; never create an extra superadmin on production
  without the operator's approval.
- Record every fixture e-mail in the test record. Store passwords in the
  team password manager, never in tickets.

---

## 5. P3 — Common account tests (run for **every** role: `ALL`)

Run each case once per role: `SA`, `A-ADM1`, `A-TRN1`, `A-ATH1`, `A-REF1`, `A-PAR1`.

| ID | Case | Steps | Expected |
|---|---|---|---|
| P3-ALL-01 **[core]** | Invitation acceptance | Open invitation link → `POST /api/invitations/preview` shows club and role → set password and accept consent → `POST /auth/register`. | Account created with exactly the invited role and the correct `clubId`. Lands on the role's start page (see P3-ALL-05). |
| P3-ALL-02 | Invitation edge cases | (a) reuse a consumed link, (b) use an expired link (shorten the TTL on staging), (c) use a revoked link, (d) tamper with the token, (e) use a password from the common-passwords list or one shorter than the policy. | (a)–(d) clear error, no account created; (e) rejected by `passwordPolicy.ts`. |
| P3-ALL-03 **[core]** | Login | `POST /auth/login` with correct credentials, e-mail in mixed case and with whitespace. | `200`, tokens issued. Mixed-case e-mail works (normalized). |
| P3-ALL-04 | Login failures | Wrong password; unknown e-mail; repeated wrong passwords up to the rate limit. | Identical generic error for wrong password and unknown e-mail (no user enumeration). `429` after the limit. `auth.loginFailed` written to the audit log. |
| P3-ALL-05 **[core]** | Default start page | Log in through the UI. | `superadmin` → `/admin` user management (`usermgmt`); pure `referee` → `kampfrichter`; pure `parent` → `parent` view; trainer/admin/athlete → dashboard (`shell.js: DEFAULT_ROUTE_BY_ROLE`). |
| P3-ALL-06 **[core]** | Navigation shows only permitted modules | Compare the visible navigation against §6 "Visible modules" for the role. | Exact match: nothing missing, nothing extra. |
| P3-ALL-07 | Deep link to a forbidden module | Navigate manually to a hash route of a module that is not permitted for the role (e.g. `#athletes` as athlete). | Module is not rendered; redirected to the start page or shown "not available". No data flashes on screen. |
| P3-ALL-08 **[core]** | Token refresh | Wait past `JWT_ACCESS_TTL_SECONDS` (900 s by default; shorten it on staging), then use the app. | Silent refresh. The old refresh token is rotated; replaying it returns 401, revokes the session family and logs `auth.refreshTokenReuse`. |
| P3-ALL-09 **[core]** | Logout | Log out, then call `/api/me` with the old access token after it expires, and `/auth/refresh` with the old refresh token. | Refresh fails with 401. Local data is cleared or bound to the owner: logging in as another user on the same browser must not show the previous user's data (`state.localStoreOwner`). |
| P3-ALL-10 | Forgot / reset password | `POST /auth/forgot-password` for an existing and a non-existing address, then use the reset link. | Same generic response in both cases. E-mail only for the existing account. Reset works once; all sessions are revoked afterwards. Audit: `auth.passwordResetRequested`, `auth.passwordReset`. |
| P3-ALL-11 | Change password | Profile → Security → change password (`POST /api/me/password`). | Requires the current password. Other sessions are revoked. `user.passwordChanged` logged. Rate limit 5/min. |
| P3-ALL-12 | Change e-mail | `POST /api/me/email`, including to an address already in use (in different case). | Duplicate rejected (case-insensitive). `user.emailChanged` logged. |
| P3-ALL-13 | Profile & locale | `GET/PATCH /api/me`; switch the language de-DE ↔ en-US. | Persisted; the UI and `<html lang>` change. |
| P3-ALL-14 | Voluntary MFA (TOTP) | Profile → Security: set up TOTP, confirm, log out, log in (`/auth/login` → `mfaRequired` → `/auth/login/mfa`), use a recovery code, regenerate recovery codes, disable TOTP. | Each step works. A used recovery code is single-use. Audit: `mfa.enabled`, `auth.recoveryCodeUsed`, `mfa.recoveryCodesRegenerated`, `mfa.disabled`. A wrong code logs `auth.mfaFailed`. |
| P3-ALL-15 | GDPR export | Profile → Data → export (`GET /api/me/export`). | File contains only this person's data; no data about other people beyond what the role may see. |
| P3-ALL-16 | Account deletion request | Run on a **throw-away second account per role**, not the fixture: `DELETE /api/me`. | Login is blocked immediately and sessions are revoked. `user.deletionRequested` is logged. Actual purge happens after `DATA_ERASURE_RETENTION_DAYS` through the `purge-deleted-data` job (see P11). Deleting the last admin of a club must be handled (rejected or warned). |
| P3-ALL-17 | Consent version | Log in with an account whose stored consent is older than `CURRENT_CONSENT_VERSION` (`apps/web/js/state.js`). | Consent prompt shown before access. |
| P3-ALL-18 | Club legal info | Info page: `GET /api/clubs/<own id>/legal-info` | Visible for every club role. `superadmin` can read any club. A foreign club id → 403 (P8). |
| P3-ALL-19 | Help pages | `/help/`, `/help/faq.html`; `/help/admin.html` for admin/superadmin. | Load without errors. |

---

## 6. P4 — Per-role functional suites

Each suite has three parts:
**(a) Visible modules** (expected navigation),
**(b) Positive cases** (must work),
**(c) Negative cases** (must be refused, **verified at the API**).

### 6.1 Superadmin (`SA`) — operator, belongs to no club

**(a) Visible:** the `/admin` interface: club list, create club, edit club
modules, background jobs card, user management, audit log. **No** team
modules (no dashboard data, athletes, plans, sessions …).

**(b) Positive**

| ID | Case | Expected |
|---|---|---|
| P4-SA-01 **[core]** | Forced MFA on login (with `MFA_ENFORCE=true`): log in without TOTP. | Login returns `mfaSetupRequired` + `setupToken`. Access is only granted after `/auth/mfa-setup` + `/auth/mfa-setup/confirm`. With TOTP already set up: `mfaRequired` → `/auth/login/mfa`. |
| P4-SA-02 **[core]** | Create a club (`POST /api/clubs`) with a name, first admin and a module selection. | Club and admin invitation are created atomically. Invitation e-mail is sent (or the link is shown). Audit: `club.created`, `invitation.created`. |
| P4-SA-03 | List clubs (`GET /api/clubs`). | All clubs are listed, including the test clubs. |
| P4-SA-04 | Edit a club's module packages (`PATCH /api/clubs/:id`). | Persisted. Takes effect for club members (P9). `club.modulesChanged` logged. |
| P4-SA-05 | Edit club identity (`PATCH /api/clubs/:id/identity`) for any club. | Persisted. `club.identityChanged` logged. |
| P4-SA-06 | Invite an admin into an existing club (`POST /api/invitations`, `role: admin`, `clubId` given). | Works. Without `clubId` → 403 ("an existing club must be given"). |
| P4-SA-07 | Invite trainer/athlete/referee/parent into a club with an explicit `clubId`. | Works. Without `clubId` → 403. |
| P4-SA-08 | List and revoke invitations (`GET /api/invitations`, `DELETE /api/invitations/:id`). | Sees invitations of **all** clubs. Revoke works; the link then fails. `invitation.revoked` logged. |
| P4-SA-09 | List users of any club (`GET /api/users?clubId=<A>`). | Lists club A members. |
| P4-SA-10 | Reset another user's MFA (`POST /api/users/:userId/mfa/reset`). | Works for any club user. `mfa.reset` logged. |
| P4-SA-11 | Set the club MFA policy (`PATCH /api/clubs/:id/mfa`) for club A. | `mfaRequiredForAdmins` is persisted. `club.mfaPolicyChanged` logged. Verified in P4-ADM-02. |
| P4-SA-12 | Edit club legal info (`PATCH /api/clubs/:id/legal-info`). | Persisted; `club.legalInfoChanged` logged. |
| P4-SA-13 **[core]** | Background jobs status (`GET /api/admin/jobs`, jobs card in `/admin`). | All three jobs listed: `purge-deleted-data`, `notify-expiring-qualifications`, `notify-upcoming-sessions`, with last run / next run / outcome. |
| P4-SA-14 | Audit log (`GET /api/audit-log`). | Entries across clubs are visible, including `club.*` entries. |
| P4-SA-15 | CLI operator tasks on the host: `scripts/resetMfa.ts` (operator MFA reset), `scripts/createSuperAdmin.ts` (staging only). | Work as documented; `resetMfa` is audited. |

**(c) Negative — API**

| ID | Request as `SA` | Expected |
|---|---|---|
| P4-SA-N1 | `POST /api/sync/push`, `GET /api/sync/pull` | 403 (not a sync role). |
| P4-SA-N2 | `PATCH /api/users/:id/roles` with any role set | 403 (admin-only). The `superadmin` role can never be assigned through the API at all (checked as admin in P4-ADM-N3). |
| P4-SA-N3 | `GET /api/parents/overview`, `/api/parents/:id/links` | 403. |
| P4-SA-N4 | `GET /api/me/qualifications`, `/api/qualification-settings`, any `/api/users/:id/qualifications` | 403. |
| P4-SA-N5 | `GET /api/me/referee-assignments`, `/api/referee-assignments/upcoming` | 403. |
| P4-SA-N6 | `GET /api/push/public-key`, `POST /api/push/subscriptions` | 403. |
| P4-SA-N7 | `GET /api/users/trainers` | 403. |
| P4-SA-N8 | Disabling own MFA while `MFA_ENFORCE=true` | Not possible, or the next login forces setup again. |

### 6.2 Admin (`A-ADM1`) — manages exactly one club

**(a) Visible:** dashboard, calendar, athletes (incl. groups), competitions,
times, qualifications (tabs own/members/settings), kampfrichter (tab
"referees" overview), stats, attendance overview, action items,
announcements, user management, audit log, sync queue, profile, info.
**Not visible** to a pure admin: plans, sessions, templates, catalog,
section templates (these are trainer-facing; check the `roles:` arrays).

**(b) Positive**

| ID | Case | Expected |
|---|---|---|
| P4-ADM-01 **[core]** | Accept the admin invitation created by `SA`. | Account in club A with `roles:["admin"]`. |
| P4-ADM-02 | MFA policy: after P4-SA-11 (`mfaRequiredForAdmins=true`), log in as `A-ADM1` without TOTP. | Forced MFA setup. Trainers/athletes in the same club are **not** forced. |
| P4-ADM-03 **[core]** | Invite trainer, athlete, referee and parent (`POST /api/invitations`). | Invitations are always for club A, even if a different `clubId` is sent in the body (silently ignored, check the stored invitation). |
| P4-ADM-04 | Invite an athlete for a `managed` athlete profile. | Refused (only `invitable` profiles can be linked to an account; `athlete_has_account` if already linked). |
| P4-ADM-05 | List / revoke own club's invitations. | Only club A invitations are listed. |
| P4-ADM-06 **[core]** | List members (`GET /api/users`). | Only club A users, sorted admin → trainer → athlete …; `?clubId=<B>` is ignored or refused, never returns club B. |
| P4-ADM-07 **[core]** | Change roles (`PATCH /api/users/:id/roles`): give `A-TRN2` the roles `["trainer","referee"]`. | Persisted. **All sessions of the target are revoked** (the target is logged out at the next refresh). `user.rolesChanged` with old/new roles. |
| P4-ADM-08 | Manage athlete master data (create/edit/deactivate athletes and groups, assign group trainers). | Works and syncs to other devices. |
| P4-ADM-09 | Manage parent links (`GET/POST/DELETE /api/parents/:userId/links[/:athleteId]`) for `A-PAR1` ↔ `Child-1`. | Works. `parentLink.added` / `parentLink.removed`. Linking to a user without the `parent` role → refused (`UserNotParentError`). Linking to a club B athlete → refused. |
| P4-ADM-10 | Qualifications: record a qualification for `A-TRN1` (`POST /api/users/:id/qualifications`), edit it, delete it; set reminder thresholds (`PUT /api/qualification-settings/:type`). | Works. `qualification.created` logged. |
| P4-ADM-11 | Referee management: list upcoming assignments, per-competition assignments; create/edit/delete an assignment for `A-REF1`. | Works. `refereeAssignment.created` logged. `A-REF1` is notified (push/e-mail, see P11). |
| P4-ADM-12 | Competitions: create a competition with entries and `refereesRequired`; DSV7/DSV8 result import; required-times check in the start list. | Works. Import matches athletes. |
| P4-ADM-13 | Announcements: create an announcement in own name. | Visible to trainers/athletes. Spoofing another author → `announcement_author_mismatch`. |
| P4-ADM-14 | Attendance overview and stats render with the seed data. | Numbers match the seed sessions. |
| P4-ADM-15 | Club identity (`PATCH /api/clubs/<A>/identity`), legal info (`PATCH /api/clubs/<A>/legal-info`), club MFA policy (`PATCH /api/clubs/<A>/mfa`). | Works for **own** club. |
| P4-ADM-16 | Reset MFA of a club A member (`POST /api/users/:id/mfa/reset`). | Works. `mfa.reset` logged. |
| P4-ADM-17 | Audit log (`GET /api/audit-log`). | Only club A entries. |
| P4-ADM-18 | Sync queue view: shows pending/failed events after an offline edit (P10). | Correct. |

**(c) Negative — API**

| ID | Request as `A-ADM1` | Expected |
|---|---|---|
| P4-ADM-N1 | `POST /api/clubs`, `GET /api/clubs`, `PATCH /api/clubs/<A>` (modules) | 403 (superadmin only). |
| P4-ADM-N2 | `POST /api/invitations` with `role:"admin"` | 403 (only superadmin may issue admin invitations). |
| P4-ADM-N3 | `PATCH /api/users/:id/roles` with `["superadmin"]` or `["superadmin","admin"]` | Rejected (validation / `CannotAssignSuperadminError`). |
| P4-ADM-N4 | Remove `admin` from **both** `A-ADM1` and `A-ADM2` in turn | First succeeds, the second is refused (`LastAdminError`). The club always keeps ≥ 1 admin. |
| P4-ADM-N5 | `GET /api/admin/jobs` | 403. |
| P4-ADM-N6 | Any club B id in `/api/clubs/<B>/identity`, `/legal-info` (PATCH), `/mfa`, `/api/users/<B-user>/roles`, `/mfa/reset`, `/qualifications`, `/referee-assignments`, `/api/parents/<B-user>/links` | 403 / 404, never a change in club B (see P8). |
| P4-ADM-N7 | `GET /api/parents/overview` | 403 (parent only). |
| P4-ADM-N8 | `GET /api/me/referee-assignments` as a pure admin | 403 (referee only). |

### 6.3 Trainer (`A-TRN1`)

**(a) Visible:** dashboard, calendar, athletes (incl. groups), competitions,
times, plans (incl. cycles), templates, catalog, section templates,
sessions, qualifications (own tab only), stats, action items,
announcements, sync queue, profile, info. **Not visible:** user management,
audit log, attendance overview, kampfrichter (unless also referee).

**(b) Positive**

| ID | Case | Expected |
|---|---|---|
| P4-TRN-01 **[core]** | Initial sync after login (`GET /api/sync/pull`, paginated). | All club A data of the stores the trainer can read arrives; the `hasMore` cursor loop terminates. |
| P4-TRN-02 **[core]** | Create a training session for `A-G1`, record attendance/RPE for `Ath-1` and `Ath-2`, add a `trainerNote`, set the actual distance. | Saved and pushed (`POST /api/sync/push` → `ok`). Visible on a second device as `A-TRN2`. |
| P4-TRN-03 | Plans: create a plan, apply a template, create a plan cycle; plan live mode; PDF export; plan transfer. | Works. Pool length is respected. |
| P4-TRN-04 | Templates, section templates, exercise catalog: create/edit/delete; library transfer (import/export). | Works. |
| P4-TRN-05 | Competitions: create one, add entries, live mode with stopwatch, record results. | Results stored in `results`. |
| P4-TRN-06 | Times / personal bests: add a result for any athlete. | Allowed (staff role). |
| P4-TRN-07 | Action items and comments: create an item for `Ath-1`, comment on it. | `Ath-1` sees it, `Ath-2` does not (P4-ATH). Comment authorship is enforced. |
| P4-TRN-08 | Announcements: create one in own name. | Works; recipients are notified (P11). |
| P4-TRN-09 | Calendar entries: holidays, training times, camps, closures. | Works; visible to all club roles, including parent and referee calendars. |
| P4-TRN-10 | Stats: attendance, training load, performance tabs. | Render with seed data, no console errors. |
| P4-TRN-11 | `GET /api/users/trainers` | `200`, trainers and admins of club A only. |
| P4-TRN-12 | Own qualifications (`GET /api/me/qualifications`), read-only. | Visible; no members/settings tabs. |
| P4-TRN-13 | Push subscription (`POST /api/push/subscriptions`) and session reminders. | Subscription stored; a reminder arrives for an upcoming session (P11). |

**(c) Negative — API**

| ID | Request as `A-TRN1` | Expected |
|---|---|---|
| P4-TRN-N1 **[core]** | Push a create/update in store `athletes` | `write_not_permitted` (athlete master data is admin-only, even though the trainer can read it). |
| P4-TRN-N2 | `GET /api/users`, `PATCH /api/users/:id/roles`, `POST /api/invitations`, `GET /api/invitations` | 403. |
| P4-TRN-N3 | `GET /api/audit-log`, `GET /api/admin/jobs` | 403. |
| P4-TRN-N4 | `POST /api/users/:id/qualifications`, `PUT /api/qualification-settings/:type` | 403. |
| P4-TRN-N5 | `/api/referee-assignments/upcoming`, `/api/users/:id/referee-assignments`, `/api/me/referee-assignments` | 403. |
| P4-TRN-N6 | `PATCH /api/clubs/<A>/legal-info`, `/identity`, `/mfa`; `POST /api/users/:id/mfa/reset` | 403. |
| P4-TRN-N7 | `/api/parents/overview`, `/api/parents/:id/links` | 403. |
| P4-TRN-N8 | Push an announcement with `authorId` of `A-ADM1`, or edit someone else's announcement so that authorship changes | `announcement_author_mismatch`. |
| P4-TRN-N9 | Push a comment in the name of another user | Comment-authorship error. |
| P4-TRN-N10 | Push an entity that references a club B entity (e.g. `groupId` of a club B group) | Foreign-key/club check error (`sync.foreignKeys.ts`), nothing stored. |

### 6.4 Athlete (`A-ATH1`) — sees the team, but restricted to own data at row/field level

**(a) Visible:** dashboard, calendar, times, plans (read), sessions (own),
qualifications (own), action items (own), announcements, profile, info.
**Not visible:** athletes, competitions, templates, catalog, section
templates, stats, attendance overview, sync queue, user management, audit
log, kampfrichter.

**(b) Positive**

| ID | Case | Expected |
|---|---|---|
| P4-ATH-01 **[core]** | Accept an invitation for an `invitable` athlete profile. | Account linked: `athleteId = Ath-1`. |
| P4-ATH-02 **[core]** | Initial sync. | Succeeds; the scoping in P4-ATH-N1…N5 holds. |
| P4-ATH-03 | Sessions: see own sessions; record own attendance, RPE and feedback note. | Only sessions where `Ath-1` is in `attendance` are shown. Own feedback syncs; the trainer sees it. |
| P4-ATH-04 | Plans and plan cycles: read. | Visible, read-only in the UI. |
| P4-ATH-05 | Times: add/edit/delete an **own** result. | Allowed. |
| P4-ATH-06 | Own action items: view, mark done, comment in own name. | Works. |
| P4-ATH-07 | Announcements: read; receive push. | Works. |
| P4-ATH-08 | Own qualifications (read). | Works when the qualifications module is enabled. |
| P4-ATH-09 | GDPR export includes own birthdate, gender and joinDate, but not `notes`. | Matches `sync.athleteScope.ts`. |

**(c) Negative — API (S1 if any fail)**

| ID | Request as `A-ATH1` | Expected |
|---|---|---|
| P4-ATH-N1 **[core]** | `GET /api/sync/pull`, inspect `athletes` changes | For **other** athletes, only `id, clubId, firstName, lastName, groupId, active, createdAt, updatedAt`. **No** `birthdate`, `gender`, `joinDate`, `notes`. For the own profile: everything except `notes`. |
| P4-ATH-N2 **[core]** | Pull, inspect `sessions` | Sessions without `Ath-1` are absent. In included sessions, `attendance` holds **only** `Ath-1`'s record, and `trainerNote` is redacted. |
| P4-ATH-N3 **[core]** | Pull, inspect `actionItems` | Only items with `athleteId = Ath-1`. |
| P4-ATH-N4 | Push create/update/delete of a `results` row belonging to `Ath-2` | `results_own_only`. |
| P4-ATH-N5 | Push create/update/delete to `planCycles`, `groups`, `exercises`, `templates`, `sectionTemplates`, `competitions`, `entries`, `actionItems`, `sessions`, `announcements`, `calendarEntries`, `athletes` | `write_not_permitted` for every one of them. `plans` is `shared` in `STORE_PERMISSIONS`, so an athlete's push to it is **accepted** at the API although the UI shows plans read-only. Record the result against §15 question 1. |
| P4-ATH-N6 | `GET /api/users/trainers`, `GET /api/users`, `/api/invitations`, `/api/audit-log` | 403. |
| P4-ATH-N7 | All admin-only REST endpoints from P4-ADM (qualifications for others, referees, parent links, club settings, MFA reset) | 403. |
| P4-ATH-N8 | `/api/me/referee-assignments`, `/api/parents/overview` | 403. |

### 6.5 Referee (`A-REF1`) — pure Kampfrichter:in

**(a) Visible:** kampfrichter (own assignments, own qualifications) as start
page, calendar, profile, info. **Not visible:** dashboard data, sync
queue, every team module.

**(b) Positive**

| ID | Case | Expected |
|---|---|---|
| P4-REF-01 **[core]** | Accept a referee invitation; log in. | Lands on `kampfrichter`. No sync is attempted (no failed sync requests in the network tab). |
| P4-REF-02 **[core]** | See the assignment created in P4-ADM-11 (`GET /api/me/referee-assignments`). | Listed with competition data. |
| P4-REF-03 **[core]** | Respond to an assignment, accept and decline (`POST /api/me/referee-assignments/:id/response`). | Status changes; the admin's overview and the competition's "referees required vs. assigned" update. |
| P4-REF-04 | Self-report an assignment (`POST /api/me/referee-assignments`), edit it (`PATCH …/:id`), delete it (`DELETE …/:id`). | Works for **own** entries only. |
| P4-REF-05 | Own qualifications in the kampfrichter tab (`GET /api/me/qualifications`, `/api/qualification-settings`). | Visible; expiry reminders arrive (P11). |
| P4-REF-06 | Calendar shows club calendar entries. | Works. |

**(c) Negative — API**

| ID | Request as `A-REF1` | Expected |
|---|---|---|
| P4-REF-N1 **[core]** | `GET /api/sync/pull`, `POST /api/sync/push` | 403 (referee is not a sync role). |
| P4-REF-N2 | `PATCH`/`DELETE /api/me/referee-assignments/<id of another referee>` | 404 / 403, no change. |
| P4-REF-N3 | `/api/referee-assignments/upcoming`, `/api/competitions/:id/referee-assignments`, `/api/users/:id/referee-assignments` | 403. |
| P4-REF-N4 | `/api/push/public-key`, `/api/push/subscriptions` | 403 (referee is not in `PUSH_ROLES`). Then confirm that referee notifications still reach a pure referee by the documented channel (e-mail); if they are intended to be push, that is an S2 gap. |
| P4-REF-N5 | `/api/users/trainers`, `/api/users`, `/api/invitations`, `/api/audit-log` | 403. |
| P4-REF-N6 | With the `kampfrichter` module disabled for the club (P9): any `/api/me/referee-assignments` | `403 module_not_enabled`. |

### 6.6 Parent (`A-PAR1`) — read-only view of linked children

**(a) Visible:** parent view (start page), calendar (children's calendar),
profile, info. Nothing else.

**(b) Positive**

| ID | Case | Expected |
|---|---|---|
| P4-PAR-01 **[core]** | Accept a parent invitation; the admin links `Child-1` (P4-ADM-09). | Parent view shows `Child-1`. |
| P4-PAR-02 **[core]** | `GET /api/parents/overview` | Contains only linked children with the fields intended for parents. Compare against `docs/Plans/phase2-plan.md` §4.2 and record the field list. |
| P4-PAR-03 | `GET /api/parents/calendar?from…&to…` | Children's sessions and club calendar entries in range. |
| P4-PAR-04 | Admin removes the link → refresh the parent view. | `Child-1` disappears. |
| P4-PAR-05 | Soft-delete `Child-1`'s athlete profile. | The overview still loads (orphaned link filtered out, no error). |
| P4-PAR-06 | Push subscription and notifications (parent is in `PUSH_ROLES`). | Subscription works. |

**(c) Negative — API**

| ID | Request as `A-PAR1` | Expected |
|---|---|---|
| P4-PAR-N1 **[core]** | `GET /api/sync/pull`, `POST /api/sync/push` | 403. |
| P4-PAR-N2 **[core]** | Try to see a non-linked child: there is no `athleteId` parameter; confirm that query parameters such as `?athleteId=<Ath-2>` or `?userId=` are ignored. | Only own links are returned (the identity comes from the token). |
| P4-PAR-N3 | `/api/parents/<own id>/links` (GET/POST/DELETE) | 403 (admin only), so a parent cannot link themself to other children. |
| P4-PAR-N4 | `/api/me/qualifications`, `/api/qualification-settings` | 403 (parent is not in the qualifications self-guard). |
| P4-PAR-N5 | `/api/users/trainers`, `/api/users`, `/api/invitations`, `/api/audit-log`, `/api/me/referee-assignments` | 403. |
| P4-PAR-N6 | Overview content | No trainer notes, no other athletes' data, no birthdate of other children. |

---

## 7. P5 — API access-control matrix

This is the core regression gate. It should be **scripted** (see §13) and
run with a valid access token for each of the six roles plus "anonymous".
Legend: ✅ allowed (2xx, or a 4xx validation error **from the handler**,
not from the guard). ⛔ 403 from the role guard. 🔒 401. M = additionally
requires the module package (403 `module_not_enabled` when it is off).
Ownership/club checks still apply where ✅.

| Endpoint | anon | SA | ADM | TRN | ATH | REF | PAR |
|---|---|---|---|---|---|---|---|
| `GET /health` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `POST /api/invitations/preview` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `POST /auth/register` `/login` `/login/mfa` `/refresh` `/logout` `/forgot-password` `/reset-password` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `GET/PATCH/DELETE /api/me`, `GET /api/me/export`, `POST /api/me/password`, `POST /api/me/email` | 🔒 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `/api/me/mfa*` (status, setup, confirm, disable, recovery codes) | 🔒 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `GET /api/clubs/:id/legal-info` (own club) | 🔒 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `PATCH /api/clubs/:id/legal-info` | 🔒 | ✅ | ✅ own | ⛔ | ⛔ | ⛔ | ⛔ |
| `POST /api/clubs`, `GET /api/clubs`, `PATCH /api/clubs/:id` | 🔒 | ✅ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ |
| `PATCH /api/clubs/:id/identity` | 🔒 | ✅ | ✅ own | ⛔ | ⛔ | ⛔ | ⛔ |
| `PATCH /api/clubs/:id/mfa` | 🔒 | ✅ | ✅ own | ⛔ | ⛔ | ⛔ | ⛔ |
| `POST/GET /api/invitations`, `DELETE /api/invitations/:id` | 🔒 | ✅ | ✅ own (no `admin` role) | ⛔ | ⛔ | ⛔ | ⛔ |
| `GET /api/users` | 🔒 | ✅ | ✅ own | ⛔ | ⛔ | ⛔ | ⛔ |
| `PATCH /api/users/:userId/roles` | 🔒 | ⛔ | ✅ own | ⛔ | ⛔ | ⛔ | ⛔ |
| `GET /api/users/trainers` | 🔒 | ⛔ | ✅ | ✅ | ⛔ | ⛔ | ⛔ |
| `POST /api/users/:userId/mfa/reset` | 🔒 | ✅ | ✅ own | ⛔ | ⛔ | ⛔ | ⛔ |
| `GET /api/audit-log` | 🔒 | ✅ all | ✅ own | ⛔ | ⛔ | ⛔ | ⛔ |
| `GET /api/admin/jobs` | 🔒 | ✅ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ |
| `GET /api/sync/pull`, `POST /api/sync/push` | 🔒 | ⛔ | ✅ | ✅ | ✅ | ⛔ | ⛔ |
| `GET /api/push/public-key`, `POST/DELETE /api/push/subscriptions` | 🔒 | ⛔ | ✅ | ✅ | ✅ | ⛔ | ✅ |
| `GET /api/me/qualifications`, `GET /api/qualification-settings` | 🔒 | ⛔ | ✅ M | ✅ M | ✅ M | ✅ M | ⛔ |
| `GET/POST /api/users/:userId/qualifications`, `PATCH/DELETE …/:id`, `PUT /api/qualification-settings/:type` | 🔒 | ⛔ | ✅ M own | ⛔ | ⛔ | ⛔ | ⛔ |
| `GET/POST /api/me/referee-assignments`, `PATCH/DELETE …/:id`, `POST …/:id/response` | 🔒 | ⛔ | ⛔ | ⛔ | ⛔ | ✅ M | ⛔ |
| `GET /api/referee-assignments/upcoming`, `GET /api/competitions/:id/referee-assignments`, `GET/POST /api/users/:userId/referee-assignments`, `PATCH/DELETE …/:id` | 🔒 | ⛔ | ✅ M own | ⛔ | ⛔ | ⛔ | ⛔ |
| `GET /api/parents/overview`, `GET /api/parents/calendar` | 🔒 | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ | ✅ |
| `GET/POST /api/parents/:userId/links`, `DELETE …/:athleteId` | 🔒 | ⛔ | ✅ own | ⛔ | ⛔ | ⛔ | ⛔ |

Additional matrix rules:
- Run the matrix also with an **expired** access token (→ 401), a token
  signed with a **different key** (→ 401), a **tampered `roles` claim**
  (→ 401, signature invalid), and a refresh token used as an access token
  (→ 401).
- After `PATCH /api/users/:id/roles` removes a role, the target's **next
  refresh** must fail, so the old roles cannot live on for
  `JWT_REFRESH_TTL_DAYS` (P7-04).

## 8. P6 — Sync store permission matrix

Derived from `STORE_PERMISSIONS` and the athlete scoping. For each store,
for each sync role, perform **pull** (is the store present?) and **push**
(create, update, delete of one record). Pure `referee`, `parent` and
`superadmin` are 403 on the endpoint itself (P5).

| Store | Pull ADM | Pull TRN | Pull ATH | Push ADM | Push TRN | Push ATH | Module package |
|---|---|---|---|---|---|---|---|
| `athletes` | ✅ | ✅ | ✅ field-restricted (P4-ATH-N1) | ✅ | ⛔ | ⛔ | athletes |
| `groups` | ✅ | ✅ | ✅ | ✅ | ✅ | ⛔ | athletes |
| `results` | ✅ | ✅ | ✅ | ✅ | ✅ | own only (`results_own_only`) | times **or** competitions |
| `plans` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ (see §15) | plans |
| `planCycles` | ✅ | ✅ | ✅ | ✅ | ✅ | ⛔ | plans |
| `exercises` | ✅ | ✅ | ✅ | ✅ | ✅ | ⛔ | catalog |
| `templates` | ✅ | ✅ | ✅ | ✅ | ✅ | ⛔ | templates |
| `sectionTemplates` | ✅ | ✅ | ✅ | ✅ | ✅ | ⛔ | sectionTemplates |
| `competitions` | ✅ | ✅ | ✅ | ✅ | ✅ | ⛔ | competitions |
| `entries` | ✅ | ✅ | ✅ | ✅ | ✅ | ⛔ | competitions |
| `actionItems` | ✅ | ✅ | own only | ✅ | ✅ | ⛔ | actionitems |
| `sessions` | ✅ | ✅ | own row in `attendance`, `trainerNote` redacted | ✅ | ✅ | ⛔ (own feedback goes through the session's attendance flow, verify in P4-ATH-03 how it is persisted) | sessions |
| `announcements` | ✅ | ✅ | ✅ | ✅ (own name) | ✅ (own name) | ⛔ | announcements |
| `calendarEntries` | ✅ | ✅ | ✅ | ✅ | ✅ | ⛔ | core (always on) |
| `users` / unknown store name | ⛔ | ⛔ | ⛔ | `unknown_store` | `unknown_store` | `unknown_store` | — |

Additional sync checks (all roles that can sync):
- **P6-01** Idempotency: push the same event id twice → second result is
  identical and nothing is duplicated.
- **P6-02** Invalid payload / invalid event → `invalid_payload` /
  `invalid_event`, while other events in the same batch still succeed.
- **P6-03** `clubId` of club B inside a payload → `club_mismatch`.
- **P6-04** Pull pagination: create > 1 page of changes (staging) and
  check that the cursor loop returns every change exactly once.
- **P6-05** Invalid `since`/`cursor` query (`?cursor=abc`) → 400, not 500.
- **P6-06** Deletes produce tombstones that reach other devices, including
  athlete devices.

## 9. P7 — Multi-role accounts and role changes

| ID | Case | Expected |
|---|---|---|
| P7-01 | `A-TA` (trainer + athlete) | Union of permissions. **Not** athlete-scoped (`isAthleteScoped` = false): sees full sessions and athlete fields. Navigation = union of trainer and athlete modules; the start page is the dashboard. |
| P7-02 | `A-TR` (trainer + referee) | Sync works (trainer), referee self-endpoints work, start page is the dashboard (not kampfrichter). |
| P7-03 | `A-AR` (athlete + referee) | Athlete-scoped sync **and** referee self-endpoints. Kampfrichter tabs show own assignments. |
| P7-04 **[core]** | Admin removes `trainer` from `A-TA` while `A-TA` is logged in. | `A-TA`'s next refresh fails (sessions revoked); after re-login only athlete permissions apply, and pull is now athlete-scoped. Local cached data that is no longer permitted is purged (`state.moduleDeprovisioning`). |
| P7-05 | Role set validation: `[]`, `["trainer","trainer"]`, `["superadmin","admin"]`, an unknown role | 400 validation error each time. |
| P7-06 | Last-admin protection (P4-ADM-N4) | Enforced. |
| P7-07 | Give `A-PAR1` the role `athlete` without an `athleteId` | Sync works, but no own data appears; no crash. Record the behaviour. |
| P7-08 | Admin who is also a referee (`roles:["admin","referee"]`) | Sees both the "referees" overview tab and the own-assignments tabs. |

## 10. P8 — Tenant isolation (club A vs. club B) — any failure is S1

Run with club B tokens against club A ids (and vice versa). Collect the
club A ids (user ids, athlete ids, competition ids, assignment ids,
invitation ids, club id) beforehand.

| ID | Case | Expected |
|---|---|---|
| P8-01 | `B-ADM1`: `GET /api/users?clubId=<A>` | Only club B users. |
| P8-02 | `B-ADM1`: `PATCH /api/users/<A-TRN1>/roles` | Refused (`ForeignClubUserError`); no change. |
| P8-03 | `B-ADM1`: `DELETE /api/invitations/<A invitation>` | Refused. |
| P8-04 | `B-ADM1`: `PATCH /api/clubs/<A>/identity`, `/legal-info`, `/mfa` | 403. |
| P8-05 | `B-ADM1`: `POST /api/users/<A-TRN1>/mfa/reset` | 403. |
| P8-06 | `B-ADM1`: qualifications, referee assignments and parent links for club A users/athletes | 403/404; nothing created. |
| P8-07 | `B-TRN1`: `GET /api/sync/pull` | No club A record in any store. |
| P8-08 | `B-TRN1`: push an update with an `entityId` that exists in club A | Refused (`club_mismatch` or treated as a new club B entity); club A record unchanged. Verify in A's pull. |
| P8-09 | `B-ATH1`: `GET /api/clubs/<A>/legal-info` | 403. |
| P8-10 | `B-ADM1`: `GET /api/audit-log` | No club A entries. |
| P8-11 | `B-ADM1`: `GET /api/competitions/<A competition>/referee-assignments` | 403/404, empty. |
| P8-12 | Same browser, log out as `A-TRN1`, log in as `B-TRN1` | No club A data is shown from IndexedDB. |

## 11. P9 — Module-package gating

As `SA`, disable one package at a time for club B (`PATCH /api/clubs/<B>`),
then test as `B-ADM1`/`B-TRN1`/`B-ATH1`. Re-enable it before moving to
the next one. The module cache in the referee/qualifications routes can
delay the effect: wait for its TTL or restart, and record the observed
delay.

| ID | Package off | Expected UI | Expected API |
|---|---|---|---|
| P9-01 | `athletes` | Athletes route hidden for all | Push/pull of `athletes`, `groups` refused / absent. |
| P9-02 | `competitions` | Competitions hidden | `competitions`, `entries` refused. `results` is still allowed if `times` is on. |
| P9-03 | `times` **and** `competitions` | Times and competitions hidden | `results` refused. |
| P9-04 | `plans` | Plans hidden | `plans`, `planCycles` refused. |
| P9-05 | `templates` / `catalog` / `sectionTemplates` | Each route hidden | The respective store is refused. |
| P9-06 | `sessions` | Sessions **and** attendance overview hidden | `sessions` refused. |
| P9-07 | `actionitems` / `announcements` | Hidden | Store refused. |
| P9-08 | `stats` | Stats hidden | — (no store). |
| P9-09 | `qualifications` | Hidden; the kampfrichter "own qualifications" tab follows the documented behaviour | All `/api/*qualification*` → `403 module_not_enabled`. |
| P9-10 | `kampfrichter` | Hidden; a pure referee has an empty/explanatory start page, not an error loop | All referee endpoints → `403 module_not_enabled`. |
| P9-11 | All packages off | Dashboard, calendar, profile and info still work | `calendarEntries` (core) still syncs. |
| P9-12 | Re-enable everything | Data that existed before is intact and visible again. | — |

## 12. P10 — Offline, PWA and sync behaviour (trainer, admin, athlete)

| ID | Case | Expected |
|---|---|---|
| P10-01 **[core]** | Install the PWA (Android Chrome, iOS Safari, desktop Chrome). | Installs; icons and name correct. |
| P10-02 | Service-worker update: deploy a new build while a client is open. | Update prompt / swap per `swUpdate.js`; no mixed old/new assets. Precache list is complete (no 404 offline). |
| P10-03 **[core]** | Trainer goes offline, records attendance for a session, edits a plan, goes back online. | Sync queue shows pending items, which then flush; data visible on a second device. |
| P10-04 | Conflict: `A-TRN1` and `A-TRN2` edit the same plan offline, both reconnect. | Resolved per `packages/sync-protocol` rules for the store category; no silent loss where the rules say merge; the losing side is informed. |
| P10-05 | Athlete offline: records own feedback; reconnects. | Pushed; any out-of-scope write (e.g. via a stale UI) is shown as rejected in the queue, not retried forever. |
| P10-06 | Session expires while offline for longer than the access TTL. | On reconnect, refresh then sync; if the refresh token was revoked, the user is asked to log in again and the queue is kept for the same user, not uploaded under a different user. |
| P10-07 | Wake lock in plan live mode / stopwatch. | Screen stays on while active. |
| P10-08 | Demo pages `/demo.html`, `/admin/admindemo.html` | Work without backend calls; module guards hold (`demoMode.moduleGuards`). |

## 13. P11 — Background jobs, e-mail and push

| ID | Case | Expected |
|---|---|---|
| P11-01 | `GET /api/admin/jobs` after ≥ 1 scheduler tick (`JOB_SCHEDULER_TICK_SECONDS`, 300 s by default) | Each job has a recent `lastRun` or a sensible `nextRun`; no failures. `/health` → `jobs:"ok"`. |
| P11-02 | Manual run via the scheduler CLI (`apps/api/src/jobs/scheduler/cli.ts`) on staging, for each of the three jobs. | Success summary; the job state is updated. |
| P11-03 | `purge-deleted-data`: on staging, set the deletion date of the P3-ALL-16 account to beyond `DATA_ERASURE_RETENTION_DAYS`, then run the job. | The account is purged; comments are anonymized; audit entries pseudonymized; old sync events, tombstones and audit entries are pruned per their retention settings. |
| P11-04 | `notify-expiring-qualifications`: a qualification of `A-REF1`/`A-TRN1` expiring within a threshold. | Reminder by e-mail (and push for push roles) exactly once per threshold. |
| P11-05 | `notify-upcoming-sessions`: a session within the reminder window for `A-G1`. | `A-ATH1`, `A-ATH2` and the trainers get a push; a parent of a child in the group gets it if designed so (record the behaviour). No duplicates on the next tick. |
| P11-06 | Invitation, password reset and referee assignment e-mails | Delivered (check SPF/DKIM pass in the headers); links point to `FRONTEND_BASE_URL`; correct language. |
| P11-07 | Announcement push to trainer/athlete/parent subscribers | Delivered; not delivered to users of club B. |
| P11-08 | Two API instances or restarts: the job runs only once per slot | No duplicate e-mails (job-state locking). |

## 14. P12 — Audit-log verification

After P3–P9, as `A-ADM1` and as `SA`, verify that **each** of the
following actions produced exactly one entry with the correct actor,
target and club, and that club B entries never appear for `A-ADM1`:

`auth.loginFailed`, `auth.mfaFailed`, `auth.passwordReset`,
`auth.passwordResetRequested`, `auth.recoveryCodeUsed`,
`auth.refreshTokenReuse`, `club.created`, `club.identityChanged`,
`club.legalInfoChanged`, `club.mfaPolicyChanged`, `club.modulesChanged`,
`invitation.created`, `invitation.revoked`, `mfa.disabled`, `mfa.enabled`,
`mfa.recoveryCodesRegenerated`, `mfa.reset`, `parentLink.added`,
`parentLink.removed`, `qualification.created`, `refereeAssignment.created`,
`user.deletionRequested`, `user.emailChanged`, `user.passwordChanged`,
`user.rolesChanged`.

Also check: the audit log pagination ("load more") works; labels are
translated; no secrets (passwords, tokens, TOTP secrets) appear in
`metadata`.

---

## 15. Open questions to settle before the first full run

These came up while deriving the plan from the code. They are not
necessarily defects, but each test record must note the agreed answer:

1. **Athletes can write `plans` at the API** (`plans: shared` in
   `STORE_PERMISSIONS`), while the UI presents plans to athletes as
   read-only and `planCycles` is `coachManaged`. Is this intended?
2. **A pure admin does not see plans, sessions, templates, catalog and
   section templates** in the navigation (the modules' `roles:` arrays
   omit `admin`), although the API allows admins full access to those
   stores. Is admin-without-trainer meant to lack these screens?
3. **Referees are not in `PUSH_ROLES`**, so a pure referee cannot receive
   push notifications, e.g. for new assignments. Is e-mail the intended
   channel?
4. **Parents have no access to `/api/me/qualifications`** (not in the
   self-guard). Presumably intended; confirm.
5. What exactly `/api/parents/overview` may contain. Write down the
   approved field list so P4-PAR-02/N6 can be checked against it.

## 16. P13 — Clean-up, sign-off and rollback

**Clean-up (production):** revoke open invitations, request deletion of
all fixture accounts, delete or deactivate clubs "ZZ-Abnahmetest-A/B" as
`SA`, remove push subscriptions, and confirm through `/api/clubs` and
`/api/users` that nothing visible to real clubs remains. On staging, keep
the fixtures for the next run.

**Rollback triggers:** any S1; any S2 without sign-off; `/health` not
`ok`; failed migration.

**Rollback procedure:** stop the API (`pm2 stop lane1-api`), check out the
previous SHA from P0-02, and rebuild. If the release contained migrations,
restore the P0-03 backup, since Prisma migrations are forward-only.
Restart, re-run P1 and P3-ALL-03/05 for every role, and record the
rollback.

**Sign-off record (one per deployment):**

```
Deployment: <host>  SHA: <new>  previous: <old>  migrations: <list>
Run type: full | reduced          Date / testers: …
Phase results: P0 ✅  P1 ✅  P2 ✅  P3 ✅ (6/6 roles)  P4 SA ✅ ADM ✅ TRN ✅ ATH ✅ REF ✅ PAR ✅
               P5 <n>/<n> cells  P6 <n>/<n> cells  P7 ✅  P8 ✅  P9 ✅  P10 ✅  P11 ✅  P12 ✅
Findings: <ID, severity, ticket>
Open questions §15: <answers / unchanged>
Decision: GO | NO-GO | ROLLED BACK      Signed: <deployer>, <product owner>
```

Evidence per case: request and response (status and relevant body, with
tokens redacted) for API cases; a screenshot for UI cases; the audit-log
entry id where applicable.

---

## Appendix A — Scripting the P5 matrix

A minimal shell harness. Run it from a machine with `curl` and `jq`
against staging first. Tokens come from logging in each fixture once;
accounts with forced MFA need the `/auth/login/mfa` step.

```bash
#!/usr/bin/env bash
# usage: BASE=https://staging.example.org ./role-matrix.sh
set -euo pipefail
: "${BASE:?}"

login() { # email password -> access token
  curl -sf -X POST "$BASE/auth/login" -H 'content-type: application/json' \
    -d "$(jq -n --arg e "$1" --arg p "$2" '{email:$e,password:$p}')" | jq -r '.accessToken // empty'
}

declare -A TOKEN
TOKEN[ANON]=""
TOKEN[ADM]=$(login "$ADM_EMAIL" "$PW")
TOKEN[TRN]=$(login "$TRN_EMAIL" "$PW")
TOKEN[ATH]=$(login "$ATH_EMAIL" "$PW")
TOKEN[REF]=$(login "$REF_EMAIL" "$PW")
TOKEN[PAR]=$(login "$PAR_EMAIL" "$PW")
TOKEN[SA]=${SA_TOKEN:?obtain via MFA login}

# role method path expected-status (one line per matrix cell, see §7)
CASES=$(cat <<'EOF'
ANON GET  /api/me                 401
SA   GET  /api/sync/pull          403
ADM  GET  /api/sync/pull          200
TRN  GET  /api/sync/pull          200
ATH  GET  /api/sync/pull          200
REF  GET  /api/sync/pull          403
PAR  GET  /api/sync/pull          403
SA   GET  /api/admin/jobs         200
ADM  GET  /api/admin/jobs         403
TRN  GET  /api/users/trainers     200
ATH  GET  /api/users/trainers     403
PAR  GET  /api/parents/overview   200
ADM  GET  /api/parents/overview   403
REF  GET  /api/me/referee-assignments 200
ATH  GET  /api/me/referee-assignments 403
PAR  GET  /api/me/qualifications  403
EOF
)

fail=0
while read -r role method path expected; do
  auth=(); [[ -n "${TOKEN[$role]}" ]] && auth=(-H "authorization: Bearer ${TOKEN[$role]}")
  got=$(curl -s -o /dev/null -w '%{http_code}' -X "$method" "${auth[@]}" "$BASE$path")
  if [[ "$got" == "$expected" ]]; then echo "PASS $role $method $path $got"
  else echo "FAIL $role $method $path expected=$expected got=$got"; fail=1; fi
done <<< "$CASES"
exit $fail
```

Extend `CASES` until it covers every cell of §7. Write requests (POST,
PATCH, DELETE) need a minimal valid body so that "allowed" shows up as a
2xx/4xx from the handler rather than a validation error that hides the
guard result. Commit the harness alongside this plan once it is complete,
so every deployment runs the identical matrix.
