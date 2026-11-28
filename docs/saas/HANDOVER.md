# Traduora SaaS (app.traduora.co): living handover

> **State: P0 and P1 merged; 🔨 P2 isolation code complete on `feat/saas-p2-isolation` (2026-11-27).** P0 branch `feat/saas-multi-tenant`, worktree
> `E:\Coding\Worktrees\ever-traduora-saas` (EVERPOWER). Brief: homelab
> `projects/traduora/knowledge/handoffs/HANDOVER-2026-11-26-traduora-saas-app-traduora-co.md`. Design:
> [`DESIGN.md`](DESIGN.md).

Read this file first when you pick the work up. It says what is done, what is in flight and what comes next. The
design says how it is built.

## Status per phase

| Phase | State | PR | Notes |
|---|---|---|---|
| P0 Design | ✅ merged | [#665](https://github.com/ever-co/ever-traduora/pull/665) | `docs/saas/DESIGN.md`; owner questions OD-T1..T14 with defaults in §12; bot findings fixed (an upgrade never widens access) |
| P1 Organizations | ✅ merged | [#666](https://github.com/ever-co/ever-traduora/pull/666) | Merged as `2a9aa6f`; see "P1 Organizations" below |
| P2 Isolation | 🔍 in review | [#672](https://github.com/ever-co/ever-traduora/pull/672) | Branch `feat/saas-p2-isolation`; review round 1 fixed; mutation check 66.7 %; see "P2 Isolation" below |
| P3 Plans and seats | 🔍 in review | [#674](https://github.com/ever-co/ever-traduora/pull/674) (base `feat/saas-p2-isolation`) | Branch `feat/saas-p3-plans`; review round 1 fixed; see "P3 Plans, seats and strings" below |
| P4 Billing (Stripe test mode) | 🔨 code complete | — (coordinator opens it) | Branch `feat/saas-p4-billing`; see "P4 Billing" below. The real Checkout through a deployed webhook on app-dev is a claimed step left to the coordinator |
| P5 Accounts and hardening | 🔨 code complete | — | Branch `feat/saas-p5-hardening`; PR by the coordinating session; see "P5 Accounts and hardening" below |
| P6 Operator console and data rights | ⏳ | — | |
| P7 Environments (dev, stage, prod) | ✅ live 2026-11-26 23:5xZ | k8s-gitops `54463a2b`, `6378a731`, `7783981f` | `app-dev.traduora.co`, `app-stage.traduora.co` (noindex); prod on nip.io until P8; Postgres `ever_traduora_<env>`; sign-ups off until P1+P2 ship. Runbook: homelab `projects/traduora/knowledge/runbooks/hosted-traduora.md`. Owed: first prod restore drill. Moved to P8: prod Valkey + 2 replicas |
| P8 Go live | ⏳ | — | Stripe live keys and webhook are a claimed change |
| P9 Open the sale | ⏳ | — | |

## P1 Organizations (branch `feat/saas-p1-organizations`)

**State: 🔨 code complete, pushed, PR to be opened by the coordinating session.** Rebased on `origin/develop` `5d65355`
(#662 and #664 merged).

### Done

- **Data** (`api/src/migrations/1795478400000-add-organizations.ts`, re-runnable, with `down`): `organization`,
  `organization_user`, `organization_invite` (TableSpec renderer, extended with uuid and timestamp columns, text
  defaults, uniques, foreign keys and engine naming: snake_case, camelCase on MySQL), `project.organization_id` with its
  index. The default organization is **always** created when none exists, also on an empty database (slug `default`,
  `TR_DEFAULT_ORGANIZATION_NAME`, plan `enterprise`, `admins_see_all_projects` false). Every project moves into it. Every
  user becomes `member`, except exactly one `owner` (the `TR_ADMIN_EMAIL` user, else the earliest project admin, else
  the earliest user): **the migration never widens access**. Postgres and MySQL: NOT NULL and a CASCADE foreign key.
  SQLite: nullable column without REFERENCES (a REFERENCES column could not be dropped by `down`), three triggers stand
  in for the foreign key (insert/update check, delete cascade) and refuse a NULL, plus the boot check
  `OrganizationBootCheck` (refuses to start while a project has none). Counters `seats_used`, `strings_used` computed.
- **`organization.admins_see_all_projects`** (design correction from the #665 review): true for organizations made in
  SaaS mode (sign-up, `POST /organizations`), false for the default one. Implicit project admin for owner/admin
  applies only when it is true, so an upgraded self-hosted owner sees exactly the projects they had.
- **Authorization** (`services/authorization.service.ts`): `authorizeProjectAction` loads `project.organization` and
  checks, in order, organization `active` (`suspended` → 403 `organization_suspended`, `deleted` → 404), caller is a
  member, project role or implicit admin (`effectiveProjectRole`); an API key through its project with the same
  organization check. `authorizeOrganizationAction` + the default-deny table `domain/organization-actions.ts` are what
  P2's `@Access('organization:<Action>')` calls.
- **Routes**: `GET/POST /organizations`, `GET/PATCH /organizations/:id`, `GET/PATCH/DELETE …/members/:userId` (delete
  self = leave; removing a member also removes their project memberships in that organization), `POST
  …/transfer-ownership`, `GET/POST/DELETE …/invites`, `POST /auth/accept-organization-invite`. Single-tenant mode
  answers only `GET /organizations` and `GET /organizations/:id`; the rest is 404 `saas_disabled` (every account of a
  self-hosted install shares the default organization, so member lists there would expose every user).
- **Projects**: `GET /projects` adds `organizationId`, takes `?organizationId=` (404 when not a member), and lists only
  projects of organizations the caller is an active member of. `POST /projects` takes `organizationId`; without it, the
  default organization (single-tenant) or the caller's own (SaaS: owned, else administered, else earliest).
- **Accounts**: single-tenant sign-ups join the default organization (`UserService.create`; the first member of an
  organization without an owner becomes its owner). SaaS sign-up (password, Google, Ever ID) creates the person's own
  organization (owner, Starter, name from `organizationName` or "<Name>'s organization") unless an accepted invite made
  them a member. Project invites join the project's organization first, in the same transaction (direct adds too).
  Organization invites work at sign-up with the token, after a verified provider sign-in, and on email verification.
  Account deletion: the default organization passes to its earliest admin, else earliest member; another organization
  with members answers 422 `owner_required` (transfer first).
- **Ever Connect**: `EverConnectProvisionService.confirm` creates the project in the person's home organization.
- **Web app** (standalone components under `webapp/src/app/organizations/`): `OrganizationsState` (NGXS, current
  organization remembered in localStorage, wrapped), `/orgs/new`, `/orgs/:slug/{projects,members,settings}`, the
  organization switcher in the app bar after the wordmark, SaaS-only (`GET /auth/providers` → `saas`), `/projects`
  redirects to the current organization in SaaS mode, sign-up asks for the organization name in SaaS mode, organization
  invite links (`/signup?invite=…&kind=organization`) and their acceptance.
- **Config**: `TR_SAAS_ENABLED` (false), `TR_DEFAULT_ORGANIZATION_NAME` (My organization), in `docs/configuration.md`.

### Deviations from DESIGN.md

- A project invite to a non-member does **not** create a separate `organization_invite` row (OD-T10 seat): accepting it
  makes the organization membership first, in one transaction, as §4.3 says. The seat of a pending project invite is
  left to P3, which can count pending project invites of the organization's projects by distinct email.
- `GET /organizations/:id/usage` is left to P3 (limits come with the plans); the counters are stored.
- `seats_used` is recounted on every membership and invite change; `strings_used` only by the migration (P3 recomputes
  it in its locked transaction).
- Organization members, invites, rename and transfer routes are SaaS-only (404 `saas_disabled`) for the privacy reason
  above; DESIGN said one code path serves both modes. The isolation checks themselves never branch on the mode.
- **The default organization's members are never listed or changed, in SaaS mode either** (review of #666, item 4): it
  holds every migrated account of an upgraded install, so `ViewMembers` there would list every e-mail. Its member,
  invite and transfer routes answer 404 `saas_disabled`, as on a single-tenant install; `GET /organizations/:id` and
  the rename still work. The web app hides its Members tab and its Ownership section.
- When the last member of an organization goes (account deletion, leaving), the organization becomes `deleted` and its
  pending invites are removed; its data stays (deletion proper is P6). The default organization is never closed: the
  next account joins it as owner. Invites are accepted only into an organization that is `active` and has its owner.
- In an organization other than the default one, a project invite to someone who is not a member yet needs the
  organization's `EditMembers` (owner, admin); otherwise 403 `organization_admin_required`.

### Left

- P2: `@Access` guard, scoped project service, source scan, isolation e2e, mutation check.
- CI on Postgres 15 and MySQL 5.7 proves the migration's SQL there; only SQLite ran locally.

### Test results (this machine, SQLite)

- API unit (`jest`, 54 suites): 427 of 427 tests pass in 41 suites. The 13 `src/formatters/*` suites cannot run **on this PC** (EPERM when
  jest renames its transform cache of `formatters/fixtures`; Windows file locking, unrelated; CI on Linux is the
  authority). New specs: organization action table, slugs, authorization (organization checks, implicit admin,
  API keys), owner rules, table renderer (engine naming, ids, timestamps, uniques, foreign keys).
- API e2e on SQLite, whole suite: 31 suites, 281 passed, 6 skipped (pre-existing skips), 0 failed. New:
  `test/organization-upgrade.e2e-spec.ts` (5: undo and re-run on seeded data with row counts of 12 tables, one owner,
  everyone else member, owner sees only their projects, `TR_ADMIN_EMAIL` owner, idempotent re-run, empty database)
  and `test/organization.e2e-spec.ts` (18, SaaS and single-tenant mode).
- `yarn --cwd api lint`, `tsc --noEmit` and prettier on changed files: clean.
- Web app Karma: 204 of 204 (19 new: switcher, members page, guards, model, new organization). `build:prod` succeeds
  (the organizations chunk is lazy, 36 kB raw).
- Postgres 15 and MySQL 5.7: not run here; CI runs every e2e there.

### P1 unslop notes

Mode: **polish** (light slop). The screens follow the existing Bootstrap 4 look: blue app bar, Varela Round headings,
Ubuntu text, Material icons. Audit of the screens they extend (project list, team page, app bar) before building:

- `projects/project-list`: greeting headline "Welcome!" and "to get started!" (copy). Not changed here (outside P1).
- `projects/team-member`: a full card with shadow per row, roles as `badge-secondary` pills, icons at mixed inline sizes
  (`1.25rem`, `18px`), inline `max-height: 2rem`. The new pages avoid these: one card per list with hairline rows.
- Page containers use `overflow-scroll`, which draws empty scrollbars on Windows. The new pages use `overflow-auto`.

Direction:

- Product: Traduora keeps an app's strings and their translations, now per company organization.
- Character: orderly, plain-spoken, a little friendly.
- World: string catalogues and locale files: rows of keys and languages, like a well-kept index.
- Moment: the one figure Traduora counts, a project's strings (terms × locales), set in tabular figures on each
  project row.
- Signature: the organization's address in mono (`/orgs/acme`), in the page header and the address fields, and the
  switcher reading as a path after the wordmark (`traduora / Acme`).

Fixes after the checklist (rendered in SaaS mode at 1024 px and 390 px):

- Removed headings that repeated the tab names ("Projects", "Members"); their place holds the count line
  ("2 projects", "2 members · 1 pending invite").
- The figure reads "12 strings" with "4 terms × 3 locales" under it, not a bare number.
- Members are listed owner first, then admins, then members, each by name (API); the switcher lists by name.
- Role columns narrow to 88 px on phones so names stay readable; one trailing column for remove, leave and revoke.
- Dropped a placeholder that looked like a typed value on `/orgs/new`.
- Checklist: 4 px steps, one accent (the brand blue, only on the primary action, the current check mark and the focus
  ring), hairlines at 8 %, one icon set at 18 px, no emoji, no exclamation marks, no trailing periods on labels,
  sentence case, tabular figures, nested radii (cards 12, rows square inside, menu 10 with items 6), motion only as
  120 ms colour transitions.

## P2 Isolation (branch `feat/saas-p2-isolation`)

**State: 🔨 code complete, pushed; PR to be opened by the coordinating session.** From `origin/develop` `2a9aa6f`
(P1 merged as #666).

### Done (DESIGN §3.4, §10)

- **Layer 1, default deny** (`api/src/access/`): every controller route, Ever Platform modules included, declares one
  rule with `@Access(...)`: `public`, `user`, `project:<ProjectAction>`, `organization:<OrganizationAction>`, `operator`
  or `webhook`. The global `AccessGuard` (an `APP_GUARD` after the throttler) answers 403 `access_undeclared` to a route
  without one, signs the caller in where the rule needs it (401 otherwise), and checks the rule: `project:` through
  `AuthorizationService.assertProjectAccess` on the route's `:projectId` (memoized per request, so the handler's own
  `authorizeProjectAction` costs no second lookup), `organization:` through `authorizeOrganizationAction` on
  `:organizationId`, `operator` through the Ever instance's operator check (404 otherwise, as the Ever pages answered).
  The core controllers no longer run `AuthGuard('jwt')` themselves (the access guard signs in); the Ever Platform
  guards stay as they were. `src/access/access.spec.ts` walks every route of `AppModule` and the three Ever modules
  (static Nest metadata, `MetadataScanner`) and fails on a route without a rule, a `project:` rule without
  `:projectId`, a `/projects/:projectId` route without a `project:` rule (same for organizations), and any change to the
  reviewed list of `public`/`webhook` routes.
- **Layer 2, one scope** (`services/organization/organization-scope.ts`): membership, `active` status, the effective
  project role and the projects an owner or admin sees are decided there and only there; `AuthorizationService`, the
  project list and `OrganizationService` read it.
- **Layer 3, no raw repositories**: controllers get `OrganizationScopedProjects` (reads name the organization, writes
  stamp it). `services/organization/organization-repositories.spec.ts` scans `api/src` and fails when a file outside
  `services/organization/`, `migrations/`, `seeds/` and the allowlist injects `Repository<Project|Organization>` or calls
  `getRepository(Project|Organization)`. Allowlist: `ever-stats/ever-stats-collector.service.ts` (installation-wide
  counts). An allowance that is no longer needed fails the spec too.
- **Isolation suite** `api/test/organization-isolation.e2e-spec.ts` (SaaS mode): organizations A and B, each with an
  owner, an admin, a member, a project with two locales, terms, a translation, a label on a term, an API key, a pending
  project invite and a pending organization invite, plus one person who is a member of both. Proven:
  - every `/projects/:projectId/*` route (generated from the routes themselves, so a new one is covered the day it is
    added) answers 404 to A's owner, admin, member and API key with B's real ids;
  - B's real project answers exactly as a project that does not exist (every GET route);
  - B's child ids (terms, labels, members, invites, API keys) do nothing through A's own project;
  - the project and organization lists show nothing of B, and refuse B's list; the person in both sees each
    organization's projects only where they are a project member, and a viewer of B changes nothing there;
  - every organization route of B (view, rename, members, invites, transfer) answers 404 to A's people;
  - API keys stay on their own project; imports into and exports of B are refused; B's invitation tokens accept nothing
    for anyone of A;
  - a suspended B locks out its owner, member, the person in both and its API key at once (403
    `organization_suspended`), and lets them back when restored;
  - at the end, everything of B (project, terms, locales, translations, labels, project members and invites, API keys,
    organization members and invites) is exactly as before.
- **Mutation check**: `api/test/organization-isolation.mutation.json` maps the scope module to
  `api/test/mutation/no-organization-scope.ts` (everyone owns every organization, every organization is open, every
  member acts as project admin; no switch in production code). `yarn --cwd api test:isolation:mutation` first runs the
  suite as it is and stops unless all of it passes, then runs it under the double and prints the failing share; it
  fails below 60 %, and counts nothing unless the suite reports that its fixtures were made.
- **Review of #672:** an id that is not a non-empty string is refused before any access lookup (guard,
  `resolveProjectAccess`, `membershipOf`); an import re-checks access inside its transaction after the project lock
  (`recheckProjectAccess`), so access lost during a slow upload writes nothing; the source scan also watches entity
  manager calls naming `Project` or `Organization` (allowed one by one, with a reason); the isolation suite covers
  project creation in B, B's ids in a request body, and each child of a nested route on its own.

### Mutation check results

| Date | Commit | Failing tests with the scope removed | Share | Target |
|---|---|---|---|---|
| 2026-11-27 | `6b689cd` | 60 of 82 | 73.2 % | ≥ 60 % ✅ |
| 2026-11-27 | `452225e` | 64 of 96 (the suite passes all 96 as it is, fixtures confirmed) | 66.7 % | ≥ 60 % ✅ |
| 2026-11-27 | `79fb2ff` (P3) | 64 of 97 (B's `/usage` added; the new check that each usage counts only its own projects passes against the double, as each side asks for its own) | 66.0 % | ≥ 60 % ✅ |
| 2026-11-28 | P5 branch `feat/saas-p5-hardening` (before and after the review of #679) | 64 of 97 (the suite runs with e-mails confirmed and terms accepted, the SaaS defaults of P5) | 66.0 % | ≥ 60 % ✅ |
| 2026-11-28 | `db05654` (P4) | 70 of 103 (B's billing routes for A's people, the person in both and A's key; B's billing fields in the snapshot) | 68.0 % | ≥ 60 % ✅ |

What still passes against the double, by design: the checks that do not rest on the organization scope (B's child ids
through A's own project are scoped by the project id; an API key is tied to its project; invitation tokens are tied to
their e-mail; an API key lists nothing), plus the route-coverage test. Run it again after every change to the scope or
to the suite, and add the result here.

### Access rules worth a second look

- `GET /api/v1/locales`: `user` with `apiKeys: 'allowed'`, so API keys keep reading the locales as before (the reference
  list, no organization data).
- Ever Connect person exports and provisioning confirm: `user` with `apiKeys: 'not-found'` (they always answered 404 to
  API keys); provisioning confirm also declares `enabled`, so a switched-off install answers 404 before sign-in.
- `POST /api/v1/auth/everid/backchannel-logout`: `webhook` (the identity provider calls it; the logout token is
  verified in the handler).
- `DELETE /organizations/:organizationId/members/:userId`: `organization:ViewOrganization`, because leaving needs only
  the membership; the handler still requires `EditMembers` to remove someone else.
- `GET /api/v1/ever-connect/health`, `GET /api/v1/ever-stats/health`: `public`, as before (they show whether the module
  is loaded).

### Test results (this machine, SQLite)

- API unit (`--runInBand`): 463 of 463 tests pass in 45 suites. The 13 `src/formatters/*` suites cannot start on this
  PC (jest EPERM on its transform cache, Windows file locking; CI on Linux is the authority).
- API e2e on SQLite, the whole suite: 34 suites, 375 passed, 10 skipped (SQLite-only skips in `concurrent-writes` and
  `project-admins`), 0 failed. The isolation suite alone: 82 tests.
- Mutation check: 73.2 % (above).
- `yarn --cwd api lint`, `tsc --noEmit` and prettier on the changed files: clean.

### Left

- Postgres 15 and MySQL 5.7 run in CI only.
- P3: plans, seats and strings with locking: done on `feat/saas-p3-plans`.

## P3 Plans, seats and strings (branch `feat/saas-p3-plans`, stacked on `feat/saas-p2-isolation`)

DESIGN §3.6, §4.1, §5 `/usage`, §12 OD-T2, T12, T13, T14.

### Done

- **Plans as a code constant**, `api/src/domain/organization-plans.ts`: Starter (15 seats, 10,000 strings), Small
  Business (25 seats plus `extraSeats`, unlimited strings), Enterprise (unlimited both). A code that is no plan reads as
  Starter.
- **Effective plan** (`effectivePlan(organization, graceDays)`): Starter on `canceled`, `unpaid`, `incomplete_expired`,
  and after `TR_BILLING_PAST_DUE_GRACE_DAYS` (default 14, new in `config.ts` and `docs/configuration.md`) of `past_due`.
  The billing fields come with P4. Until then they are missing, which means no subscription, and the organization's
  `plan_code` applies as it is. A `past_due` without a date keeps the plan; an unreadable date counts as lapsed.
- **Seats** (`services/organization/organization-usage.ts`): members, plus everyone else with a pending organization
  invite or a pending project invite to one of the organization's projects, counted once per person (by normalized
  email). This adds the project invites to non-members that P1 left out. Counted in SQL: COUNT of members plus
  COUNT(DISTINCT email) of pending invitations of non-members (the organization's, then its projects' not among them).
- **Strings**: the sum over the organization's projects of `localesCount × termsCount`, as SUM in SQL.
- **Enforced**, each inside a `readCommittedTransaction` in the global lock order account → project(s) → organization
  (DESIGN §3.6): the project lock, then the organization lock, under which the totals are read:

  | Change | Check |
  |---|---|
  | `POST /organizations/:id/invites`, direct add of a verified account | a new member needs a free seat |
  | `POST /organizations/:id/invites`, invitation | a new pending invitation needs a free seat; a new link for someone who holds one passes |
  | `POST /auth/accept-organization-invite`, `POST /auth/accept-invite` | refused only over the limit (the invitation already holds its seat) |
  | `POST /projects/:id/invites` to someone outside the organization | as an organization invite (direct add or pending) |
  | `POST /projects/:id/terms`, `POST /projects/:id/translations` (a locale), imports | the strings the change adds; a change that adds none passes |

  A refusal answers **402 `plan_limit_reached`** with `resource` (`seats` or `strings`) and `limit`, and the message
  "Your plan allows N members|strings. Upgrade to add more." `used` and `plan` come only for a caller who holds
  `ViewUsage` there (owner, admin); see "Needs owner".
- **Over the limit** (a downgrade, a lapse): adds are refused, nothing is deleted. Reads, edits, exports, removals and an
  import of existing terms keep working. An acceptance that comes with a sign-up or a sign-in leaves the invitation
  pending instead of failing, so the account is still made (with its own organization in SaaS mode).
- **Single-tenant mode and the default organization** take no organization lock for strings (decided on the unlocked
  `isDefault`, which never changes), keep no cached counters, and keep the per-project `Plan.maxStrings` check exactly
  as before (`PaymentRequired`). In an organization of SaaS mode the project plans are ignored.
- `lockOrganization` takes FOR NO KEY UPDATE on Postgres (lockers still wait for each other; foreign-key checks of
  rows that reference the organization do not), FOR UPDATE on MySQL.
- **`GET /organizations/:id/usage`**, `@Access('organization:ViewUsage')`, a new action of owners and admins: the effective
  plan, seats used and included, strings used and limit (`null` is unlimited), counted live. SaaS mode only, and 404
  `saas_disabled` for the default organization, like the members routes.
- **Cached counters** `seats_used` and `strings_used`, kept only for organizations with their own plan, are recounted
  in SQL in the same transaction under the organization lock by every change of seats or strings: invites, revokes,
  project invites and their removal, acceptances, member removals, a direct add that replaces a pending invite, term
  and locale adds and removals, imports and project deletion. e2e checks them against `/usage`, so P4 billing can
  read them.
- **Web app**: the members page shows owners and admins the plan with two meters (seats, strings), read again after an
  invite, revoke, removal or refusal. A `plan_limit_reached` anywhere in the app (`errorToMessage`) reads "Your plan
  allows 15 members. Upgrade to add more." (figures as 10,000). On the members page it shows as a quiet notice, not as a
  red error.
- **Tests**: unit `organization-plans.spec.ts` (plans, limits, effective plan, grace), `organization-usage.spec.ts`
  (counting once per person, seat and strings refusals), the 402 body in `exception.filter.spec.ts`; e2e
  `test/organization-plans.e2e-spec.ts` (23 tests): every limit (invite, accept, project invite and its acceptance,
  term, locale, import), parallel invites, project invites, term adds and imports at the edge of a limit never
  exceeding it, a downgrade over the limit, Small Business and Enterprise without limits, the default organization and
  single-tenant mode unchanged, `/usage` access; the isolation suite asks for B's `/usage` from A's people and checks
  each organization's usage counts only its own projects.

- **Review of #674, round 1**: seats and strings counted in SQL, no counters and no strings lock for the default
  organization or a single-tenant install; FOR NO KEY UPDATE on Postgres; a revoke locks the organization first;
  accounts locked first where a later write references them (a direct add, an import's history, Ever Connect
  deletion), and `lock-order.spec.ts` keeps a lock's window to the end of its transaction and flags an account after a
  project or an organization; the 402 shows `used` and `plan` to owners and admins only; the counters follow removals.

- **Review of #674, round 2** (bots and SonarCloud): a parallel test across three projects of one organization
  (terms, an import and a locale at once) checks the organization lock, which a one-project race cannot; it passes
  on SQLite with or without that lock (one transaction at a time there), so only the Postgres and MySQL legs of CI
  can catch its absence. Invites decide on the account as it is under the lock; an acceptance checks its invitation
  is current (404) before any seat refusal (402); the plan card loads apart from the members, keeps only the latest
  read, and uses native `<progress>` meters whose value stays within the limit (the text and `aria-valuetext` say
  "20 of 15").

### Deviations from DESIGN.md (DESIGN updated)

- `/usage` is owner and admin (`ViewUsage`), as the P3 brief says; §5 had `organization:View`.
- §4.3 said a project invite to a non-member also creates an organization invite. P1 does not create one; the pending
  project invite takes the seat itself, once per person.
- **One lock order: account → project(s) → organization(s)** (DESIGN §3.6, the comment on `lockOrganization`). This is
  develop's *Delete account* order. P3 had first locked the organization before the project for adds, which could
  deadlock with an account deletion; now:
  - term and locale adds and imports lock their project, then the organization;
  - project invites lock their project for share (the row they write references it), then the organization;
  - an invitation's acceptance locks the account, then every project of the invitations for share, then the
    organizations in the order of their ids. Organization invites are accepted in that order too.
  - `deleteAccountsWithOrganizations` sorts by code unit like `lockProjects` (it used `localeCompare`; same order for
    uuids).
  - `utils/lock-order.spec.ts` scans the source for a project lock after an organization lock (the old add order fails
    it). The 503 with `Retry-After` on a deadlock stays as a backstop only.
- Term and locale adds now run in `readCommittedTransaction` (they used the default isolation level); the import kept
  its own, which was READ COMMITTED already on Postgres and MySQL.
- No link to billing in the 402 message yet: the billing page is P4.

### P3 unslop notes (members page)

Mode: **polish**. P1's direction stays (orderly, plain-spoken; string catalogues; figures in mono). Audit before
building, `organization-members`: no slop signs in the page itself (4 px steps, hairlines at 8 %, one accent, mono
roles). Two problems for P3: the seats line counted on the client (members plus organization invites) and missed
pending project invites, and every refusal showed as a red error.

- Moment: the plan card, two thin meters, the one place with the brand blue as fill; a reached limit turns its meter
  the brand's danger tone (meaning, not decoration). Figures in mono, tabular, "6,240 of 10,000" or "40, no limit".
- The 402 notice is a quiet surface with a hairline (`#f5f7f9`, the theme's light), not `alert-danger`.
- Checklist: 4 px grid (card padding 20, meter rows 32 high, gaps 16, 12 on phones), radius 12 for the card like the
  lists, bar radius 2, no emoji or icons added, sentence case, no exclamation marks, the two-sentence note keeps its
  periods, a 200 ms width transition on the meter fill only. Rendered as a static preview at 800 px: plan card, notice
  and list align on one left edge.

### Test results (this machine, SQLite)

- API unit (`--runInBand`, after review round 1): 494 of 494 tests pass in 48 suites, the lock-order scan included. The 13 `src/formatters/*` suites cannot start on this
  PC (jest EPERM, as before).
- API e2e on SQLite, the whole suite: 35 suites, 419 passed, 10 skipped, 0 failed (27 in the plans suite). Parallel requests are serialized on
  SQLite; CI proves them on Postgres and MySQL.
- Mutation check: 64 of 97 (66.0 %), see the table.
- Web app Karma: 243 of 243 (after review round 3). `ng lint`: no finding in the files P3 changed (the 61 `prefer-standalone` errors elsewhere
  predate it). Prettier clean. `tslint` on the API clean.
- `ng build --configuration=production` succeeds.

### Left

- CI (Postgres 15, MySQL 5.7) for the parallel tests at the edge of a limit.
- ✅ Fixed in P5 (see "P5 Accounts and hardening"). **A member's e-mail change can add a seat (review of #674, round 3, not fixed in P3).** A pending invitation to a
  member's address takes no seat, since that person holds one already. If the member then changes e-mail (`PATCH /me`,
  a plain update of the account row that takes no organization lock), the invitation belongs to nobody in the
  organization and counts as a seat, so the organization can end one over its limit. Nothing is deleted, and adds are
  refused until it is back under (OD-T13). No lock in the invite transaction closes this, because the change can come
  any time after the invitation commits. The fix belongs to the e-mail change. After the account lock (the global
  order), it locks the account's organizations and either drops their pending invitations to the old address or
  recounts their seats.
- P4: the billing fields on `organization` (`billing_status`, `past_due_since`, `extra_seats`), which `effectivePlan`
  already reads; a link to billing from the 402 notice and the plan card.

## P5 Accounts and hardening (branch `feat/saas-p5-hardening`)

DESIGN §3.8, §4.5 (P5 columns), §7 (P5 variables), §10; the P3 "Left" follow-up on e-mail changes. From
`origin/develop` `feb237b` (P3 merged as #674).

### Done

- **E-mail verification required in SaaS mode** (`TR_REQUIRE_VERIFIED_EMAIL`, unset = `TR_SAAS_ENABLED`, read on every
  request). Inside the `AccessGuard`, after sign-in and before the rule: a person (never an API key) whose account is
  pending gets 403 `email_not_verified`, then, in SaaS mode, 403 `terms_not_accepted` (`accounts/account-policy.ts`).
  Routes that work while pending declare `@Access('user', { whilePending: true })`; `access.spec.ts` pins the list:
  `GET/PATCH/DELETE /users/me`, `POST /auth/verify-email`, `resend-verification-email`, `change-password`,
  `accept-terms` and the sign-in methods (`/auth/identities*`). Public routes (sign-up, sign-in, providers,
  forgot/reset password) need no caller. `GET /users/me` adds `pending` (`email_not_verified`, `terms_not_accepted` or
  `null`). Single-tenant mode asks for neither, unless `TR_REQUIRE_VERIFIED_EMAIL=true`.
- **Mail**: the existing `TR_MAIL_*` SMTP (Postmark in production); no provider code. The welcome email says the
  projects open once the address is confirmed when that is required; the two invitation emails say a new account then
  confirms its address. `verify-email.txt` was already there.
- **Terms and privacy** (migration `1795565000000-add-terms-acceptance.ts`: `terms_version`, `privacy_version`,
  `terms_accepted_at` on `user`; camelCase on MySQL). The versions come from **`@ever-co/legal`** (product `traduora`,
  English: terms 1.1.0, privacy 1.0.2 in 0.7.1), read as Ever Rec reads them (`require('@ever-co/legal/index.json')`,
  `accounts/legal-documents.ts`). `TR_TERMS_VERSION` / `TR_PRIVACY_VERSION` override them, `TR_TERMS_URL` /
  `TR_PRIVACY_URL` are the links (default traduora.co/tos, /privacy). SaaS mode: `POST /auth/signup` needs the versions
  in force (400 `terms_not_accepted`), they are recorded with the account; `GET /auth/providers` lists them (`legal`);
  `POST /auth/accept-terms` records a new acceptance; a boot check refuses SaaS mode without versions. Ever ID's
  `signup-confirm` takes the versions too (optional); Google and Ever ID sign-ups otherwise accept on the terms page
  right after (the gate).
- **Cloudflare Turnstile** on `POST /auth/signup` and `POST /auth/forgot-password` (`accounts/turnstile.service.ts`):
  on when both `TR_TURNSTILE_SITE_KEY` and `TR_TURNSTILE_SECRET_KEY` are set (a warning when only one is). The site key
  goes to the web app in `GET /auth/providers` (`turnstileSiteKey`). The token is checked with siteverify (secret,
  token, visitor address) before anything else of the request; refused → 400 `turnstile_failed`, Cloudflare
  unreachable → 503 `turnstile_unavailable` (fails closed). Tests mock the call with nock.
- **Throttling**: `TR_TRUST_PROXY` (hop count, `true`/`false` or a list) sets Express `trust proxy`; in SaaS mode the
  global default is 600 requests per minute (`TR_THROTTLE_TTL`/`TR_THROTTLE_LIMIT` still win; `config.globalThrottle`);
  `TR_SIGNUPS_PER_HOUR` (10) per address on `POST /auth/signup` and `POST /auth/everid/signup-confirm`, SaaS only,
  counted once the bot check passed (`AttemptLimiter`; see the review of #679 below).
- **Headers** (`security/http-hardening.ts`, applied in `addPipesAndFilters` before every route and static file):
  `helmet` 8.3.0 (latest) with a CSP for the app itself, Google Fonts, Turnstile when on and the Ever ID issuer when
  on; HSTS (one year, includeSubDomains) and `upgrade-insecure-requests` only when `TR_VIRTUAL_HOST` is https.
- **CORS**: `TR_CORS_ORIGINS` (comma list, normalized to origins) replaces `*`; `TR_CORS_ENABLED=true` alone still
  means `*`.
- **`REDIS_DB`**: the database index of the Redis client (`redis/redis.module.ts`, `redisOptions`).
- **P3 follow-up, a member's e-mail change**: `PATCH /users/me` now runs in one read-committed transaction that locks
  the account row first, updates it, then locks each organization with its own plan the person is a member of (in
  the order of their ids) and, when the former address was confirmed, **drops their pending invitations to it** (organization invitations and
  project invitations to its projects), then recounts the seats (`releaseFormerEmailInvites`, in
  `services/organization/`, listed in `lock-order.spec.ts`). Why dropping, not recounting: a recount keeps the counter
  right but leaves the organization over its limit (the invitation then belongs to nobody in it and takes a seat); and
  refusing the change would hold a person's own address hostage to an organization's plan. Those invitations were
  addressed to someone who is in already; they can be sent again to the new address. The default organization and a
  single-tenant install count no seats, so nothing changes there. e2e: a full Starter organization stays at 15 of 15
  (the test fails with the drop removed: 16), another organization's invitation to that address is kept.
- **Web app**: `/check-inbox` (the address in mono, "Resend the link", "I have confirmed it", "Use another address",
  sign out) and `/accept-terms` (both documents with their versions, one checkbox), standalone; the sign-up form gets
  the terms checkbox (SaaS) and the Turnstile widget (`shared/components/turnstile`, loads Cloudflare's script only when
  a site key is set), forgot-password the widget. `accountReadyGuard` on `projects`, `orgs` and `ever-platform` sends a
  pending account to the right page with `returnTo`; the error interceptor does the same on a 403 of either code (new
  terms during a session). The app bar and the organization switcher wait for a ready account.
- **CSP and the Angular app** (checked by serving `build:prod` from the API in SaaS mode with Turnstile's test keys, in
  headless Chrome, sign-up → check inbox → terms → organization projects, plus Swagger): two web changes were needed,
  both found by that check: critical-CSS inlining is off in the production build (its `onload` handler is an inline
  script), and NGXS runs with `compatibility.strictContentSecurityPolicy` (it compiled state getters with
  `new Function`, which blanked the app). After them: no CSP violation and no console error, fonts loaded.
  Since the strict Turnstile check (`7713a20`), Cloudflare's dummy test keys no longer pass: their siteverify answer
  has the host `example.com` and no `action`. A browser check of the sign-up journey needs real development keys for
  the host, or Turnstile off with the CSP checked on its own. Re-run that way after the bot review (`build:prod` served
  by the API in SaaS mode, Turnstile off, headless Chrome, sign-up → check inbox → terms → organization projects, plus
  Swagger): no CSP violation; the only console error is the 404 of the Ever Platform status probe, whose module is
  off on that install.

### Deviations and choices

- **Terms are enforced by the same gate**, not only "at the next sign-in": any request of an account that has not
  accepted the versions in force answers 403 `terms_not_accepted`, which the web app turns into the terms page. It
  covers Google and Ever ID sign-ups, accounts from before P5 and a new version mid-session the same way.
- `accept-invite` and `accept-organization-invite` are **not** open to a pending account: confirming the e-mail accepts
  its pending invitations anyway (as before), so nothing is lost. The API has no logout route (sign-out is in the web
  app; Ever ID's is the issuer's), so there is nothing to open there.
- The e2e runs set `TR_SIGNUPS_PER_HOUR=0` (`test/e2e-env.ts`, jest `setupFiles`, also in the mutation config): the
  suites sign up hundreds of accounts from 127.0.0.1. The P1–P3 suites now run with the real SaaS defaults: their
  accounts confirm their e-mail and accept the terms (`signupTestUser`, `currentTerms()`), and two flows of an
  unconfirmed account run with `TR_REQUIRE_VERIFIED_EMAIL=false`. The upgrade e2e undoes the later migrations before
  the organizations one.
- `api/yarn.lock` (used by the Docker build) only gets the two new entries: on develop it is far out of sync with
  `api/package.json` (a full regeneration rewrites about 6,800 lines). The root `yarn.lock` is regenerated with yarn.

### Review of #679 (independent review, all fixed)

1. **Someone else's invitations through an e-mail change** (medium). A member could set a victim's address and then her
   own again: the "former" address was the victim's, so its invitations in her organizations were dropped, and while
   she held it they took no seat. Now the invitations of the former address are released only when it was confirmed,
   and `countSeats` frees an invitation only when it goes to a member's **confirmed** e-mail (a new invitation passes
   the seat check on the same rule). One consequence: an invitation to a member who has not confirmed their address
   takes a seat until they do (confirming accepts it). e2e: the address and back keeps the victim's invitations and
   the count; an invitation to a member's unconfirmed address is refused (402) in a full organization.
2. **Confirmation mail without limit** (medium-low). `PATCH /users/me` takes the auth rate limit per address;
   `TR_VERIFICATION_EMAILS_PER_HOUR` (5) caps confirmation emails per account and hour, counted on each e-mail change
   and each resend (`AttemptLimiter`, in the throttler's storage); the confirmation email no longer carries the
   account's name.
3. **Rate-limit buckets** (low-medium). An IPv6 address counts by its /64 (`addressBucket`) for the global throttler,
   the sign-up limit and the Ever ID sign-in limit. With `REDIS_HOST`, every limit is counted in Redis
   (`@nest-lab/throttler-storage-redis` 1.2.0, key prefix `traduora:throttle:`), shared by the replicas; without an
   answer within a second a replica counts in memory for 30 s and logs it (checked against an unreachable Redis:
   requests kept answering). Sign-ups are counted after Turnstile and the terms passed (and after an Ever ID record
   unseals), so refused bots use up nobody's sign-ups. SaaS mode logs an error at boot without `TR_TRUST_PROXY`.
4. **Turnstile** (low). siteverify's answer must carry the form's `action` (`signup`, `forgot-password`) and the host
   name of `TR_VIRTUAL_HOST`. SaaS mode refuses to start with only one of the two keys.
5. **API keys skip the account gates** (by design, documented in DESIGN §3.8). A `client_credentials` token belongs to
   a project, not to a person: it has no e-mail to confirm and accepts no terms. Its project's organization was set
   up by people who passed both, its rights end at that project, and the organization checks (`active`, suspension)
   still apply to it.

### Bot review of #679 (11 threads on `467d890`, 6 on `631fe30`, 4 on `e5e2290`, all answered)

- The two threads on the deleted sign-up guard: the count is now in the handler, on the throttler's storage, which is
  Redis with `REDIS_HOST` and `REDIS_PORT` (`ab19b40`). The in-memory side had the same flaw as the guard, though:
  `@nestjs/throttler` 6.5.0 clears every timer of a throttler name when one blocked key resumes, so other keys kept
  old hits. The storage now gives each key its own timer name (`KeyScopedMemoryStorage`, `219e75e`), for every limit;
  `shared-throttler-storage.spec.ts` reproduces the library's behaviour and the fix.
- SaaS mode refuses to start with a terms or privacy version over 64 characters (`276eef9`).
- Web (`f68bd12`): `SaasModeService.state$` keeps a failed settings request apart from a single-tenant answer, with
  `reload()`; sign-up and forgot-password wait for the settings and offer "Try again"; the terms page shows a load
  failure and keeps Continue off.
- Web (`0d59d5a`): the app bar shows only for a loaded profile that is not pending; pending pages, the guard and the
  interceptor store the fresh profile; a profile answer that arrives after a sign-out is dropped; check your inbox
  says nothing was sent when the address is the same.
- Web (`23718d2`): a stored profile belongs to the session that read it. `SetUserInfo` takes only the profile of the
  account the current token signs in (another tab may have signed in someone else), the check-inbox page drops an
  answer that arrives after the session changed, and the guard stores the profile it read, ready or pending.
- Every spelling of an IPv4-mapped address (`::ffff:cb00:7107`, fully written forms) counts as its IPv4, not one
  shared `::/64` bucket (`c25ddef`).
- **By design, the Redis fallback starts a fresh count.** When Redis does not answer within a second, or errs, a
  replica counts in memory for 30 s and logs it. That memory store has not seen the hits Redis counted, so during an
  outage a key can get up to its limit again on each replica, within the window. The choice is availability: the API
  keeps answering at its usual speed instead of failing every request while Redis is down (DESIGN §3.8). Password
  sign-in is different: its attempt counter (`UserLoginAttemptsStorage`) uses Redis directly, so with Redis down a
  password sign-in fails with an error instead of being counted locally.

### P5 unslop notes (sign-up, forgot-password, check inbox, accept terms)

Mode: **polish**, the brand kept (Bootstrap 4, the blue primary, Varela Round titles, Ubuntu text). Audit before
editing (sign-up, forgot-password): placeholders repeating the labels ("Display Name", "Email"), title-case labels
("Email Address"), trailing periods on validation messages and the invite-only notice, a fixed 380 px card wider than
some phones, a hairline and 48 px gap under the form when no sign-in provider is set (a dead band), a comma splice in
the forgot-password text, and the card cut off at the top when the form is taller than the screen (flex centering).

Direction (P1's): orderly, plain-spoken, a little friendly; string catalogues and locale files. Moment on the new
pages: the address the link went to, in mono on a quiet surface; the two documents as hairline rows with their
versions in mono, tabular. Signature: mono for addresses and versions, as for `/orgs/acme`.

Fixes: sentence-case labels, no placeholders but "At least 8 characters", no trailing periods on short strings, the
card `width: 100%; max-width: 380px` (`.auth-card`), `justify-content: safe center` (`.auth-page`), the providers block
only when there are providers, one primary action per card ("Get started", "Resend the link", "Continue") with quiet
links beside it. Checklist: 4 px steps (8/12/16/20), hairlines at 8 %, no icons or emoji
added, no exclamation marks, two weights; radius 4 inside the card, as its form controls (the card is 4 with 20 padding). Rendered at 1280 px and 390 px in headless Chrome under the CSP.

### Test results (this machine, SQLite)

- API unit (`--runInBand`): 533 of 533 tests pass in 54 suites; the 13 `src/formatters/*` suites cannot start on this PC (jest EPERM, as before). New: account policy, legal documents, Turnstile (nock), sign-up guard,
  helmet/CORS options, `redisOptions`, config parsers, the guard's pending checks and the pinned `whilePending` list,
  the filter's account codes.
- API e2e, the whole suite: 36 suites, 451 passed, 10 skipped (the same SQLite-only skips), 0 failed. New
  `test/accounts-hardening.e2e-spec.ts` (24): the 403 matrix over every route of the app for an unconfirmed person
  (generated from the route table) and the reverse for the `whilePending` routes, API keys, `TR_REQUIRE_VERIFIED_EMAIL`
  both ways, single-tenant unchanged, terms at sign-up and again after a new version, Turnstile off / one key / on /
  refused / unreachable, sign-up and auth buckets per `X-Forwarded-For` with `TR_TRUST_PROXY=1` and shared without it,
  CSP and HSTS headers, the CORS allowlist, `*` and none, the e-mail change at the seat limit.
- Mutation check: 64 of 97 (66.0 %), see the table.
- `yarn --cwd api lint`, `tsc --noEmit`, prettier on the changed files: clean.
- Web app Karma: 267 of 267 (24 new). `ng lint`: no finding in the files P5 added; the 61 `prefer-standalone` errors
  (signup and forgot-password among them) predate it. `build:prod` succeeds.
- Postgres 15 and MySQL 5.7: CI only (the migration and the e-mail change transaction).

After the review of #679 (`5a5f0e7`…`53a7d71`): API unit 545 of 545 in 58 suites (the 13 formatter suites as above);
e2e 36 suites, 457 passed, 10 skipped, 0 failed (`accounts-hardening` now 30); mutation check 64 of 97 (66.0 %);
tslint, `tsc` and prettier clean. The web app did not change (Karma and `build:prod` as above).

### Left

- The web app's Ever ID confirmation screen does not send the terms yet; those accounts accept on the terms page right
  after (one more screen).
- P7/P8 configuration: `TR_TRUST_PROXY` for the real hop count behind Cloudflare tunnel → ingress-nginx (measure it),
  Turnstile keys per environment in OpenBao.
## P4 Billing (branch `feat/saas-p4-billing`, from `develop` `feb237b`)

DESIGN §3.6, §3.7, §4.1, §4.5, §5, §7, §10, §12 (OD-T1, T6, T11, T14). Stripe **test mode only**; nothing live was
touched.

### Done

- **Data** (`api/src/migrations/1795572000000-add-billing.ts`, three engines, re-runnable, with `down`): the P4 columns
  of `organization` (`stripe_customer_id` with a unique index, `stripe_subscription_id`, `billing_status`,
  `billing_interval`, `extra_seats`, `trial_ends_at`, `current_period_end`, `past_due_since`, `checkout_session_id`,
  `checkout_expires_at`, and `checkout_attempt`) and `billing_event` (`id` = Stripe event id, primary key, `type`,
  `organization_id`, `outcome`, `date_processed`; no foreign key, so the log outlives what it names). P3's
  `effectivePlan` reads the new fields as they are (`billingStatus`, `pastDueSince`, `extraSeats`).
- **Roles**: new `organization:ViewBilling` (owner, admin); `ManageBilling` moved from the admins to the **owner only**
  (DESIGN §3.2: Checkout and the portal are the owner's).
- **`api/src/billing/`** (`BillingModule`, always loaded; 404 `billing_disabled` without `TR_STRIPE_SECRET_KEY` or
  outside SaaS mode). The organization reads and writes go through `services/organization/organization-billing.ts`, so
  the source scan needed no new allowance; billing takes only the organization lock (`readCommittedTransaction`).
  - `stripe-client.ts`: the official `stripe` 23.2.0 (API version `2026-11-18.endive`). A live key (`sk_live_`/`rk_live_`)
    is **refused at start** unless `TR_STRIPE_LIVE_MODE=true`; anything that is no secret key is refused too. Webhook
    events of the other mode are ignored.
  - **Checkout** (`POST /organizations/:id/billing/checkout`, owner): prices by lookup key (cached 10 minutes),
    `mode: subscription`, the organization's own customer (made first, idempotency key `traduora-customer-<org>`, so the
    webhook can tie every event to it), `customer_update.address: auto`, `client_reference_id` and
    `metadata.organizationId`, `subscription_data.trial_period_days` = `TR_BILLING_TRIAL_DAYS` once per organization
    (never after a trial or a subscription), `payment_method_collection: always`, `automatic_tax`,
    `billing_address_collection: required`, the seat line item (quantity N, adjustable 0–1000) or, with no seats asked
    for, the seat price as an **optional item** (Stripe refuses a line of quantity 0, proven in test mode).
  - **One Checkout at a time**: the organization row is locked; an open session for the same order is handed out again
    (`checkout_session_id`, `checkout_expires_at`), one for another order is **expired** first; the call carries the
    idempotency key `traduora-checkout-<org>-<plan key>-<seats>-<attempt>` (`checkout_attempt` stored). The session
    parameters hold nothing time-dependent (Stripe's 24 h expiry), so a retry after a failed commit resends the same
    request. Refused with 409 `subscription_exists` while a live subscription exists.
  - **Changes** (`PATCH /organizations/:id/billing/subscription`, owner, new): plan, interval and extra seats of the live
    subscription (plan price swapped, both items moved to the other interval together, seat item set, added or
    removed; Stripe prorates, a trial keeps running). Needed because **the customer portal cannot update a subscription
    of several products** (Stripe documents it: such a subscription can only be canceled there). The answer is
    written at once, as the webhook would.
  - **Portal** (`POST …/billing/portal`, owner): on the organization's customer, back to `/orgs/<slug>/billing`; the
    account's default portal configuration (`bpc_1U7FIX…`, shared with the other products, **not changed**) unless
    `TR_STRIPE_PORTAL_CONFIGURATION`. 409 `billing_account_missing` before the first Checkout.
  - **Webhook** `POST /api/v1/billing/webhook` (`@Access('webhook')`, in the reviewed list of `access.spec.ts`):
    `constructEvent` on the raw body with `TR_STRIPE_WEBHOOK_SECRET` (400 on a missing or wrong signature). Handles
    `checkout.session.completed`, `customer.subscription.created|updated|deleted`, `invoice.paid`,
    `invoice.payment_failed`. The organization is the one whose **customer** it is (`checkout.session.completed`: the
    `client_reference_id`, and the customer must be its own or the one of the session it opened); the subscription is
    **read again from Stripe under the organization lock**, so out-of-order events leave the latest state. Plan and
    seats from the lookup keys only; a subscription without a Traduora plan price changes nothing. The
    `billing_event` row is inserted in the same transaction (an event recorded already is a no-op, before any Stripe
    call; a primary-key clash of two deliveries is a duplicate too). **Customers of no organization** (Gauzy and the
    other products of the shared account) get 200 and are not recorded. A **second live subscription** is canceled
    at once (`prorate: false`, `invoice_now: false`), logged and recorded as `second_subscription_canceled`; its own
    later events change nothing.
  - State written: `planCode` from the key while the status grants it (`trialing`, `active`, `past_due`, `unpaid`),
    Starter otherwise (`canceled`, `incomplete*`, `paused`), extra seats likewise; `trial_ends_at` set once and never
    cleared; `current_period_end` from the items (this API version keeps it per item); `past_due_since` = the time of
    the event that first showed `past_due`, kept while it stays past due, cleared after. The open Checkout is cleared
    once a subscription grants the plan.
  - `GET /organizations/:id/billing` (owner, admin): effective and subscribed plan, status, interval, seats used /
    included / bought / limit, trial end, past due since and the end of the grace, the next invoice (Stripe's preview,
    or its date alone), the plans on sale with Stripe's prices, `canManage` (owner), `subscribed`, `portalAvailable`.
    **No Stripe id is ever sent.**
- **Raw body without `main.ts`**: `mountBillingWebhookBody` (`api/src/billing/billing-webhook-body.ts`) mounts
  `express.raw` on the webhook path only. It is called from `addPipesAndFilters` (one line in `app.module.ts`), which
  runs before Nest registers its JSON parser at `init` in `main.ts` and in every e2e app; the JSON parser then finds the
  body read (body-parser 2 skips a finished request). `main.ts` is untouched.
- **Web app** (`webapp/src/app/organizations/billing/`, standalone): `/orgs/:slug/billing` with a Billing tab for the
  owner and the admins (not on the default organization). Plan card (plan, status line, the seats meter, "25 included ·
  2 bought", next invoice); for the owner the order card (plan rows with Stripe's prices, Monthly / Annually, extra seats
  for Small Business, the trial line, the total "plus tax where it applies") with **Continue to Checkout** or **Save
  changes**, and **Manage billing** (portal). Admins read it only. Back from Checkout it says so, and after a success
  reads again every 2 s (6 times) until the webhook's subscription shows. The members page's 402 notice ends with "See
  the plans" (owner, admin), and the plan card links "Plans and billing". Elsewhere the 402 message stays text.

### Seat prices (OD-T11): found, not created

The brief expected `ever_seat_traduora_cloud_small_business_{monthly,annual}` to be missing. Read-only listing of the
shared account (test mode, "Ever Tech") found the seat prices under the fleet's own scheme instead:

| Lookup key | Price | Amount | Product |
|---|---|---|---|
| `seat_ever_traduora_cloud_small_business_monthly` | `price_1UNGBODdBrwbGEirbDlqUFWW` | $5.00 / month | `prod_VO2FvxDAxOU93X` "Ever Traduora Cloud — Business — Additional Employee" |
| `seat_ever_traduora_cloud_small_business_annual` | `price_1UNGBODdBrwbGEir84OrKmA8` | $60.00 / year | same |

The annual amount is $60 (12 × $5): the pricing spec's add-on rule ("yearly 12× = $60 / $120"), not the plans' 30 %
rule (`floor(5 × 7/10) × 12` = $36), and the same as the existing Ever Works seat prices. Creating a second pair under
another key would have split the catalogue that the ever.co sync scripts own, so **P4 created no price** and uses these
keys (DESIGN §3.7 and OD-T11 updated). Plans: `ever_traduora_cloud_{small_business,enterprise}_{monthly,annual}` exist as
the brief said ($49 / $408, $499 / $4,188). Stripe Tax is active on the account (`tax.settings` status `active`).

### Stripe test-mode smoke run (2026-11-28)

`TR_STRIPE_SECRET_KEY=sk_test_… npx ts-node scripts/billing-stripe-smoke.ts` (in `api/`; refuses any key that is not
test mode, prints ids and statuses only, expires what it opens). The sessions are built by the API's own
`checkoutSessionParams`:

- the six prices found by lookup key, `livemode: false`;
- customer `cus_Vi69yvYoNdZefm` (metadata `smoke_test: true`, left in place);
- Checkout `cs_test_b0zoB0108i…` Small Business monthly + 3 seats: `open`, `automatic_tax: true`, line items
  `ever_traduora_cloud_small_business_monthly x1`, `seat_ever_traduora_cloud_small_business_monthly x3`;
- Checkout `cs_test_a0pvQ7bbN9…` Small Business annual, seat offered: `open`;
- Checkout `cs_test_a0zVMNXYxf…` Enterprise monthly: `open`;
- portal session `bps_1UgfxLDdBrwbGEirqY7Yo01D`: made on the default configuration;
- the three sessions `expired`.

Also seen in a browser against a local API in SaaS mode with the test key: the hosted page (Stripe serves it on
`pay.ever.co`) showed "Ever Traduora Cloud — Business, Qty 1" + "Additional Employee, Qty 2", "90 days free", VAT from
Stripe Tax and "Total due today $0.00"; the annual order showed the seat price under "Add to your order". Nothing was
paid.

### Real Checkout through the webhook on app-dev (claimed step for the coordinator)

Needs a public URL, so it is left to a claimed change on `app-dev.traduora.co` (`ever-traduora-dev`):

1. **Claim** it on the homelab board (Stripe test-mode webhook endpoint, OpenBao `kv/ever-traduora/dev`, a rollout of
   `ever-traduora-dev`).
2. **Webhook endpoint** in Stripe **test mode** (Dashboard → Developers → Webhooks → Add destination, or
   `POST /v1/webhook_endpoints`):
   - URL `https://app-dev.traduora.co/api/v1/billing/webhook`;
   - events `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`,
     `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`;
   - API version: the account default is fine (the handler reads only ids from the payload and fetches the
     subscription itself);
   - the endpoint gets **every** such event of the shared account (the other products too); Traduora answers them 200
     and ignores them.
3. **OpenBao** `kv/ever-traduora/dev` (and the ExternalSecret mapping, if a key is new to it):
   - `TR_STRIPE_SECRET_KEY` = the account's **test** secret key (`.config/ever-demand/stripe.env`,
     `STRIPE_SECRET_TEST_KEY`), or better a restricted test key (write: Checkout Sessions, Customers, Customer portal, Subscriptions;
     read: Prices, Invoices);
   - `TR_STRIPE_WEBHOOK_SECRET` = the endpoint's signing secret (`whsec_…`);
   - optional: `TR_BILLING_TRIAL_DAYS` (90), `TR_BILLING_PAST_DUE_GRACE_DAYS` (14), `TR_STRIPE_PORTAL_CONFIGURATION`.
   - Never set `TR_STRIPE_LIVE_MODE` before P8. `TR_SAAS_ENABLED=true` is set already on dev.
4. Roll the deployment through k8s-gitops (the image must include this branch), then check: sign up on app-dev →
   Billing → Small Business, 2 extra seats → Continue to Checkout → test card `4242 4242 4242 4242`, any future date,
   any CVC, an address → back on the billing page "Trial until …", seats "25 included · 2 bought"; the Stripe event
   log shows 200 for each delivery. Then: change the seats on the page; Manage billing → cancel; resend one delivered
   event from the Dashboard (nothing changes, `billing_event` has it once); a failed payment with `4000 0000 0000 0341`
   (subscribe with it, then "End trial now" on the subscription in the Dashboard: the invoice fails, the page shows
   the grace).
5. Release the claim with what was changed.

### Deviations from DESIGN.md (DESIGN updated)

- Seat lookup key `seat_ever_traduora_cloud_small_business_*` (the existing one), not `ever_seat_…`; nothing created.
- `PATCH …/billing/subscription` added: the portal cannot change a subscription of two products.
- Columns `organization.checkout_attempt` (the attempt counter of §3.7's idempotency key) and `billing_event.outcome`.
- `ManageBilling` is the owner's only; admins get the new `ViewBilling`.
- Events of customers of no organization are not recorded in `billing_event` (they belong to other products).
- `organization-upgrade.e2e-spec.ts` undoes every migration after the organizations one before undoing it, so that
  later phases (this one, P5, P6) can add migrations.

### P4 unslop notes (billing page)

Mode: **polish**. Audit before building: the screens the page joins (the organization shell, P3's plan card on the
members page) show none of the signs (no gradients, glows, emoji or tracked uppercase; 4 px steps; one accent). Gaps
for P4: no Billing tab, and the 402 notice named "Upgrade" with nowhere to go.

Direction, P1's kept: orderly, plain-spoken, a little friendly; string catalogues; figures in mono. Moment: the plan
card, with the one meter in the brand blue and the seat split "25 included · 2 bought" in mono under it. Signature:
the organization's address in mono, as before.

Checklist after rendering at 800 px and 390 px (local API, SaaS mode, test key): 4 px grid (cards 20 and 24, 16 on
phones; rows 60; label column 96, 80 on phones, so "Billed" and "Extra seats" line up with the meter); one accent (meter
fill, selected radio, primary button); the bootstrap custom radio swapped for native radios with `accent-color` so the
plan and interval choices match; prices and totals in one format (`$49.00`, tabular mono); sentence case, no
exclamation marks, single sentences without a trailing period, the two-sentence notes keep theirs; the past-due line in
the danger text tone only (meaning); motion only as 120 ms background and 200 ms meter transitions; no icons added.

### Test results (this machine, SQLite)

- API unit (`--runInBand`): 534 of 534 tests pass in 51 suites (new: `billing-plans.spec.ts`, `stripe-client.spec.ts`,
  `billing.service.spec.ts` with Stripe mocked, the action table). The 13 `src/formatters/*` suites cannot start on this
  PC (EPERM), as before.
- API e2e on SQLite, the whole suite: 36 suites, 461 passed, 10 skipped (the SQLite-only skips, as before), 0 failed. New: `test/billing.e2e-spec.ts` (28: the page for owner, admin and
  member, Checkout and its refusals, one Checkout for parallel clicks, another order expiring the open session, a
  missing price, the portal, and through signed events: subscribe, add seats, change seats, upgrade, downgrade, a
  replay, a failed payment through the grace to Starter and back, an old failure, a foreign customer and a forged
  Checkout, a non-Traduora subscription, the other mode, a second subscription canceled, cancel, a new subscription
  after the old one).
- Isolation suite: 103 tests (B's billing routes for A's owner, admin, member and API key, for the person in both, and
  B's billing fields in the final snapshot). Mutation check: 70 of 103 fail with the scope removed, 68.0 % (table in P2).
- `yarn --cwd api lint`, prettier on the changed files: clean. `ng lint`: no finding in the files P4 changed.
- Web app Karma: 256 of 256 (13 new for the billing page, the members spec now checks the link). `build:prod` succeeds
  (the organizations chunk is 65.5 kB raw).
- Postgres 15 and MySQL 5.7: CI only (the migration's `ALTER TABLE … ADD` per engine, the unique index, `FOR NO KEY
  UPDATE` under the webhook).

### Left

- The real Checkout on app-dev (above), a claimed step.
- A Traduora-only portal configuration (`TR_STRIPE_PORTAL_CONFIGURATION`), if the default one's features (shared with
  the other products) are not what Traduora wants: an owner decision, not made here.
- The 402 message elsewhere (terms, imports, locales) stays text; only the members page links to billing.

## Needs owner

The build goes on with the defaults of `DESIGN.md` §12 (OD-T1 … OD-T14). Nothing blocks yet.

- **OD-T11, live seat prices (P4):** `seat_ever_traduora_cloud_small_business_{monthly,annual}` exist in **test** mode
  ($5 / $60). Live mode was not looked at (no live call allowed); before P8 confirm they exist live with the same keys
  and amounts, or create them there (a claimed change in the ever.co catalogue sync).
- **Customer portal configuration (P4):** Traduora uses the account's default configuration, shared with the other
  products. A configuration of its own (cancellation reasons, which invoices show) is optional.

Decisions taken with a default, to confirm:

- **Legal texts for the hosted service (P5, before P8):** `@ever-co/legal` 0.7.1 is the source of the versions a
  sign-up accepts (Traduora terms 1.1.0, privacy 1.0.2), but its Traduora terms still say "There is no hosted Ever
  Traduora" and leave out accounts, seats and fees. The hosted text needs publishing in `ever-co/legal` (owner's npm
  publish); bumping the package then asks every account to accept again. The package is `UNLICENSED` and 15 MB unpacked,
  inside an AGPL image, as in Ever Rec; a licence for the published texts would settle that.
- **Turnstile keys** per environment (a Cloudflare widget for the app hosts) go into OpenBao with P7/P8; until then the
  bot check is off there.

- **What a 402 `plan_limit_reached` shows (P3 review):** always `resource` and `limit` ("Your plan allows 15 members").
  `used` and the effective `plan` only to a caller who may read `/usage` in that organization (owner, admin). An editor,
  an API key or an invitee does not learn the organization-wide totals, which cover projects they cannot see.

## How to run the checks

- Node 26 first on `PATH` (CI uses 26.12.1).
- `yarn install --frozen-lockfile` at the root.
- API: `yarn --cwd api lint`, `yarn --cwd api test`, then e2e with `yarn --cwd api test:e2e` (it sets `NODE_ENV=e2e`, the 100-string default plan, stats off and its own SQLite file). On Windows, run jest with `--runInBand` if the formatter specs fail with EPERM on cache renames.
- Web app: `yarn --cwd webapp test --watch=false --browsers=ChromeHeadlessCI`, `yarn --cwd webapp build:prod`.
- Isolation: the e2e suite runs `test/organization-isolation.e2e-spec.ts`; `yarn --cwd api test:isolation:mutation` prints
  the share of it that fails with the organization scope removed (must stay at least 60 %).
