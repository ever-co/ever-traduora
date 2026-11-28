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
| P4 Billing (Stripe test mode) | ⏳ | — | |
| P5 Accounts and hardening | ⏳ | — | |
| P6 Operator console and data rights | 🔍 in review | [#680](https://github.com/ever-co/ever-traduora/pull/680) | Branch `feat/saas-p6-operator`; review round 1 fixed; P4 registers `BILLING_CANCELLATION`; every move to `deleted` through billing still to check once P4 merged; see "P6 Operator console and data rights" below |
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
| 2026-11-28 | `b59c133` (P6) | 65 of 98 (B's export, deletion and operator routes added to the routes A is refused; an operator's suspension of B, which fails against the double as the members get in) | 66.3 % | ≥ 60 % ✅ |

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
- **A member's e-mail change can add a seat (review of #674, round 3, not fixed in P3).** A pending invitation to a
  member's address takes no seat, since that person holds one already. If the member then changes e-mail (`PATCH /me`,
  a plain update of the account row that takes no organization lock), the invitation belongs to nobody in the
  organization and counts as a seat, so the organization can end one over its limit. Nothing is deleted, and adds are
  refused until it is back under (OD-T13). No lock in the invite transaction closes this, because the change can come
  any time after the invitation commits. The fix belongs to the e-mail change. After the account lock (the global
  order), it locks the account's organizations and either drops their pending invitations to the old address or
  recounts their seats.
- P4: the billing fields on `organization` (`billing_status`, `past_due_since`, `extra_seats`), which `effectivePlan`
  already reads; a link to billing from the 402 notice and the plan card.

## P6 Operator console and data rights (branch `feat/saas-p6-operator`)

DESIGN §3.9, §4.5, §5, §6, §10. From `origin/develop` `feb237b` (P3 merged as #674). Lane worktree
`E:\Coding\Worktrees\ever-traduora-p6`. Runs beside P4 (billing) and P5 (hardening); merge order P5, P4, P6.

### Done

- **Operators** are the `EverAdminGuard` people (a verified e-mail in `TR_EVER_ADMIN_EMAILS`, else `TR_ADMIN_EMAIL`).
  The rule is now one function, `isOperatorAccount` (`access/operator-check.ts`), used by `EverInstanceService` and by
  the new `OperatorCheckService` (`api/src/operator/`). The console needs the operator check without the Ever Platform
  modules, so the operator module provides `OPERATOR_CHECK` too; where another module provides it (the Ever Platform
  instance module, whose settings the e2e suites set apart) its answer is used, found by its token
  (`moduleRef.get(OPERATOR_CHECK, { strict: false, each: true })`). Core code still imports no Ever Platform module
  (`ever-stats-static.spec.ts`).
- **Routes** (`api/src/operator/operator.controller.ts`), all `@Access('operator', { enabled: assertSaasEnabled })`:
  a single-tenant install has none (404 `saas_disabled` before sign-in); everyone but an operator, API keys included,
  gets 404; signed out 401. On top, `OperatorConsoleGuard` takes only operators the environment names
  (`TR_EVER_ADMIN_EMAILS`, else `TR_ADMIN_EMAIL`): with neither set there is no operator, not even the built-in
  fallback address `local.admin@ever.co` that `config.everPlatform.adminEmails` falls back to (review of #680).

  | Route | |
  |---|---|
  | `GET /operator/status` | `{ operator: true }`; the web app's probe for the menu entry and the `/operator` guard |
  | `GET /operator/organizations?q=&status=&page=&limit=` | newest first, 25 a page (at most 100); `q` matches name or slug (case-insensitive), the owner's e-mail, or the exact id; each row has owner, members and projects counts, cached seats and strings |
  | `GET /operator/organizations/:id` | the row plus the effective plan, seats and strings counted now (P3's `organizationUsage`) and the latest 20 audit rows |
  | `POST /operator/organizations/:id/suspend`, `…/restore` | a reason of 3 to 500 characters (trimmed); `active` → `suspended` → `active` only, else 409 `organization_status`; the default organization is never suspended (400 `default_organization`) |
  | `POST /operator/organizations/:id/release-slug` | a deleted organization's slug becomes `deleted-<32 hex of its id>` (a prefix no organization can take, `isAllowedSlug`; a derived slug gets `org-` in front), so the address can be taken again; 409 `organization_status` / `slug_released`; audited `release_slug` |
  | `POST /operator/organizations/:id/billing-cancellation` | tries a pending or failed subscription cancellation again; 409 `billing_cancellation_none`; audited `retry_billing_cancellation` |
  | `GET /operator/audit?organizationId=&page=&limit=` | newest first; `organizationId` must be a uuid (400) |

  The list also shows each organization's `billingCancellation` (`pending`, `failed`, `done` or none) and filters
  `billing=unsettled`; the detail has the whole cancellation row (attempts, last error). The search escapes LIKE
  wildcards (`ESCAPE '!'`) instead of dropping them.

  The parameter is `:id`, not `:organizationId`: these are not a member's organization routes (`access.spec.ts`).
- **`operator_audit`** (`migrations/1795867200000-add-operator-audit.ts`, TableSpec, three engines, indexes on
  `organization_id` and `date_created`; entity `OperatorAudit`): operator id and e-mail as it was, action, organization,
  reason, `date_created` (set by the service with milliseconds, so rows of one second keep their order). Written with
  the status change in one `readCommittedTransaction` under `lockOrganization`. No foreign keys: rows outlive the
  operator's account (e2e).
- **Suspension takes effect at once**: P2's checks read the status on every request. e2e (`test/operator.e2e-spec.ts`,
  and the isolation suite through the operator routes): the owner's, a member's and the API key's next request answers
  403 `organization_suspended`, the project list drops the organization's projects, and after the restore everything
  works again.
- **Organization export** `GET /organizations/:organizationId/export` (`organization:ExportOrganization`: owner,
  admin; SaaS mode only; 404 `saas_disabled` for the default organization, whose members list would be every account).
  A ZIP archive streamed entry by entry (`utils/zip-writer.ts`): `organization.json` (organization, effective plan,
  usage, who exported, when, format `ever-traduora-organization-export/1`), `members.json`, and per project
  `projects/<name>-<id>/project.json` (locales, project members), `terms.json` (context, labels), `labels.json`,
  `translations/<locale>.json`. `terms.json` is read in pages of 1,000 and streamed as an entry with a data descriptor;
  `labels.json` also lists the translations each label is on (term, locale). One export of an organization runs at a
  time (409 `export_running`, per process); the organization's status is read again before each project, and a
  suspension or deletion meanwhile breaks the download off. The translations come from the project export's own query, now
  `utils/locale-translations.ts` (the project export uses it too), and its `jsonFlatExporter`, so a locale file is
  byte for byte the project export's `jsonflat` (e2e). The projects are those the exporting person sees: all of them
  for an owner or admin where admins see all projects. A failure after the first bytes breaks the download off instead
  of sending a truncated archive.
- **Organization deletion** `DELETE /organizations/:organizationId` with `{ slug }` (`organization:DeleteOrganization`,
  owner; SaaS mode only), `services/organization/organization-deletion.service.ts`:
  1. the slug must be typed (spaces and case aside; 400 `slug_mismatch`); never the default organization (400
     `default_organization`);
  2. one transaction in the global order: the owner's account (`lockAccountRow`) → every project of the organization
     (`lockProjects`) → `lockOrganization`; the status, the slug and the ownership are checked again under the locks;
  3. `deleteOrganizationData` (`organization-membership.ts`): the projects (CASCADE: terms, locales, translations and
     their history, labels, project members, invitations, API keys), the organization's invitations and memberships;
     the row stays as a `deleted` tombstone with its counters at 0, and the subscription's cancellation is queued in
     the same transaction (`organization_billing_cancellation`, an outbox row). The owner's project count goes down by
     the projects deleted, as a project deletion does;
  4. **after the commit only**, the cancellation is tried (`settleBillingCancellations`, three attempts at 0, 250 and
     1,000 ms); `done`, or `failed` with the last error for the operators, who retry it from the console. The owner gets
     204 either way: the deletion happened. (Review of #680: billing ran before the transaction, so a refusal under the
     locks could follow a cancelled subscription.)

  Project creation now takes the account lock and then the organization's (not the default organization's) and checks
  under it that the organization is open: a project is never created into an organization being deleted (review of
  #680). Creation and deletion are rate limited per client address (`TR_ORGANIZATION_CHANGES_LIMIT` per
  `TR_ORGANIZATION_CHANGES_TTL`, 10 per hour): a tombstone keeps its slug, so a loop would hoard addresses.

  e2e: the other organization's every table is exactly as before, its people and key keep working; the deleted one's
  former people and key get 404/401; every account stays.
- **`BillingCancellation`** (`services/organization/billing-cancellation.ts`) is the seam for P4: an interface
  `cancelForDeletion(organization): Promise<void>`, looked up by the token `BILLING_CANCELLATION`
  (`moduleRef.get(…, { strict: false })`, the way the access guard finds the operator check), with a no-op default.
  **P4 registers `{ provide: BILLING_CANCELLATION, useExisting: <its billing service> }` in its module**; nothing else
  changes here. It is called only after the deletion committed, with the `deleted` tombstone (which still holds P4's
  billing columns); it must be idempotent (it runs again on a retry), do nothing for an organization without a
  subscription, and throw to say it failed (its message is kept, shortened, for the operators: no key or token in it).
- **Account deletion for the last admin** (`UserService.deleteAccount(user, choices)`, `services/organization/account-deletion.ts`):
  - `GET /users/me/deletion`: projects where the person is the last admin while others use them (with those members as
    candidates), and every non-default organization they own (`onlyMember`, the other members, `projectsCount`).
  - `DELETE /users/me` takes an optional body: `projectAdmins` (a project member becomes admin), `organizationOwners` (a
    member becomes owner, the leaver admin then gone), `deleteOrganizations` (an organization they are alone in, its
    slug typed). Without a body it is exactly as before. Errors: 400 `transfer_invalid` (not the person's to hand over,
    not a member there), 400 `slug_mismatch`, 403 `organization_suspended` (a suspended organization is not deleted
    with the account: it stays for the operators), 422 as before.
  - develop's #668 locking is kept: the account first, then **one** `lockProjectsOf` call over the account's projects
    and those of the organizations deleted with it (one sorted order), then the hand-overs of project admins, then the
    admin count (projects deleted with their organization skip it), then P1's `deleteAccountsWithOrganizations`, which
    now takes `{ newOwners, deleteOrganizations }` and applies them under each organization's lock (checked again
    there). Every refusal rolls the one transaction back, and the subscriptions of the organizations deleted with the
    account are cancelled only after the commit (e2e: a hand-over to a stranger, a new owner for an organization not the
    person's, the last admin of a project elsewhere, each with a deletion chosen, cancel nothing).
  - Ids in the body must be uuids, and a `null` list is refused (400): both reached the database before.
  - **A suspended organization keeps the operator's decision** (my call on review item 7): its owner or last member
    cannot delete their account while it is suspended (403 `organization_suspended`, "<name> is suspended: contact
    support before deleting your account"), since that would hand it to someone else or close it as `deleted`. Its
    other members leave as usual; its status stays `suspended`. `GET /users/me/deletion` lists it with
    `status: 'suspended'`, and the web app explains and offers no submit. This applies to Ever Connect's person
    deletion too, which goes through the same `deleteAccountsWithOrganizations`.
- **Isolation suite**: B's export and deletion and the operator routes from A's owner, admin and member (404), the
  person in both organizations (a member of B) gets neither B's export nor its deletion, and an operator's suspension of
  B locks B's people and key out while A keeps working, audited.
- **Web app** (standalone, under `webapp/src/app/operator/**`, `auth/components/account-deletion/`, organization
  settings): `/operator` list and search, detail with suspend and restore (reason, confirmation), audit log; an
  "Operator" entry in the app bar menu for operators in SaaS mode (`GET /operator/status`, a 404 means no, never an
  error toast); the organization settings danger zone (Download export for owner and admin; Delete organization for
  the owner, never the default organization, slug typed, export offered first); the account-deletion flow built on
  `GET /users/me/deletion` (a new admin per project, a new owner per organization, the deletion of an organization the
  person is alone in with its slug typed, then the e-mail confirmation). Error messages for the new codes. Review round
  1: the billing cancellation notice and its retry, the address release, the billing filter, the list's search kept on
  the way back, a suspended organization blocking the account deletion, and stale answers dropped after a route change.

- **TODO before P6 merges (review of #680, item 2), once P4 (#678) is in:** rebase and make sure every move of an
  organization to `deleted` either is refused by P4's guard (422 `subscription_active`) or goes through the billing
  seam after its commit (`queueBillingCancellation` in the transaction, `settleBillingCancellations` after it). The
  paths: `closeIfEmpty` (an account deletion without a body, a member removing themselves or being removed, Ever
  Connect's person deletion) and `deleteOrganizationData` (already queued). `closeIfEmpty`'s billing logic is P4's
  to change first, so it is untouched here.

### Deviations from DESIGN.md (DESIGN updated where it names them)

- The tombstone is kept, but **nothing purges it after 30 days** yet: §8 adds no timer, and a purge is a data deletion
  of its own. See "Needs owner".
- The deleted organization keeps no members or invitations (DESIGN said only "tombstone"): its people stop seeing it
  at once and its seats are 0.
- Export and deletion are SaaS mode only, and the default organization is neither exported (404 `saas_disabled`, as
  its member routes) nor deleted (400 `default_organization`). An operator never suspends the default organization.
- Added `GET /operator/status`, `GET /users/me/deletion`, `POST /operator/organizations/:id/release-slug` and
  `POST /operator/organizations/:id/billing-cancellation`; `GET /operator/organizations/:id` (DESIGN §5 said
  `GET/POST …/:id`) has no POST: suspend and restore are their own routes.
- An organization the leaver is alone in and does not choose to delete is closed with its data kept, as P1 did.
- The ZIP is written by a small writer in `utils/zip-writer.ts` (Node's zlib, no new dependency, so no lockfile change
  beside P4's). Plain ZIP: an archive that would pass 65,534 entries (0xFFFF reads as "ZIP64" to some tools) or 4 GiB
  is broken off. CRC-32 by `zlib.crc32` (a JavaScript fallback for Node before 22.2). Checked with Python's `zipfile`
  and .NET's `ZipFile` on this PC, data descriptors included, and by a reader in `test/zip.ts` that computes CRC-32
  itself.
- The export reads project after project without one snapshot transaction (on SQLite a long transaction would hold the
  only writer): a change during an export may show in part of it.
- One export per organization at a time is kept in the process: with two replicas, two exports of one organization
  could run at once (one per pod).
- Rate limits of organization changes count per client address, as the throttler runs before sign-in; with P5's
  `TR_TRUST_PROXY` each visitor has their own.

### Mutation check

`yarn --cwd api test:isolation:mutation`, 2026-11-28, P6: **65 of 98 fail with the scope removed (66.3 %)**, target 60 %.
The suite passes all 98 as it is. Again after review round 1 (`64aac2d`): 65 of 98, 66.3 %.

### Test results (this machine, SQLite)

- API unit (`--runInBand`): 518 of 518 tests pass in 50 suites; after review round 1, 530 of 530. The 13
  `src/formatters/*` suites cannot start on this PC (EPERM, as before).
  New: `utils/zip-writer.spec.ts` (7), `operator/operator.spec.ts` (operator check, billing seam, slug confirmation,
  export names, search pattern, pages).
- API e2e on SQLite, the whole suite: 38 suites, 460 passed, 10 skipped (the SQLite-only skips), 0 failed; after review
  round 1, 469 passed, 10 skipped, 0 failed. New: `test/operator.e2e-spec.ts` (14), `test/organization-data.e2e-spec.ts`
  (11), `test/account-deletion.e2e-spec.ts` (7); the isolation suite 98 (was 97).
- `test/organization-upgrade.e2e-spec.ts` assumed the organizations migration was the last one; it now undoes the
  later phases' migrations first and runs them again (P4's and P5's migrations need nothing more there).
- `yarn --cwd api lint`, `tsc --noEmit` and prettier on the changed files: clean.
- Web app Karma: 280 of 280 (243 before P6; 37 new: operator service, guard, list, detail, audit, danger zone, account
  deletion); after review round 1, 298 of 298. `build:prod` succeeds (the operator pages are their own lazy chunk, 49.6
  kB).
- Postgres 15 and MySQL 5.7: not run here (CI runs every e2e there). Worth a look in CI: the operator list's
  `LOWER(…) LIKE` search and `organization.id IN (subquery)` on Postgres uuids, the migration's MySQL index creation.

### P6 unslop notes

Mode: **polish**; P1/P3's direction stays (orderly, plain-spoken; string catalogues; figures and slugs in mono).

- Audit before editing: organization settings had no slop signs. User settings: native `confirm()`/`prompt()` for the
  account deletion, Title Case headings, spacing by `<br><hr>`, empty scrollbars from `overflow-scroll`. App bar menu:
  Title Case labels ("Account Settings", "Logout").
- Moment: the live seats and strings meters on the operator detail page. Signature: `/orgs/<slug>` in mono on every
  operator row and header.
- Fixes after the checklist (rendered against a mock API at 1024 px and 390 px): the operator table overflowed at 1024
  px (Plan shows from 1200 px, the owner column is capped); Bootstrap's `.card` stretched the action button; mono on the
  header's inner spans (the global `* { font-family }` rule won); a stray space before a comma; `overflow-scroll` →
  `overflow-auto` on user settings; the account deletion is an in-page flow instead of `confirm()`/`prompt()`.
- Checklist: 4 px steps, hairlines at 8 %, brand blue only on Save and Restore, the danger tone only on suspend and
  delete (and the "suspended" status text), figures in mono with tabular digits, sentence case, no emoji, no
  exclamation marks.
- Review round 1: a billing cancellation still to settle and a suspended organization in the account deletion are
  quiet notices (light surface, one hairline, the facts in mono rows), not red alerts. The danger tone marks only
  meaning ("billing failed", "suspended") and the Suspend and Release address buttons; Retry and Restore take the brand
  blue as their panel's primary action. Audit actions read as mono lowercase words ("release address", "retry
  billing"). Contrast raised to 4.5:1 or better on the light notice (SonarCloud).
- Left as they are (outside P6): the Title Case labels of user settings and the app bar; P1's organization header
  renders `/orgs/acme` in Ubuntu, not mono, for the same `*` rule.

### Files other lanes also touch

`api/src/app.module.ts` (one import, one line), `api/src/config.ts` (one block, `organizationChanges`),
`docs/configuration.md` (the `TR_EVER_ADMIN_EMAILS` row now names the console; two rows `TR_ORGANIZATION_CHANGES_*`),
`api/src/controllers/organization.controller.ts` (one `@Throttle` on create), `api/src/controllers/project.controller.ts`
(the organization lock at creation), `api/src/services/organization/organization-membership.ts`
(`deleteAccountsWithOrganizations` and `deleteOrganizationData`, where P4 also edits `closeIfEmpty`), `api/src/services/user.service.ts` (`deleteAccount`, a third constructor parameter
`ModuleRef`; P5's e-mail change is in `updateUserData`), `api/src/controllers/user.controller.ts` (`GET me/deletion`,
`DELETE me` body), `api/test/organization-isolation.e2e-spec.ts` (P4 will add billing routes to the same list),
`webapp/src/app/app.module.ts`, `shared/components/app-bar/*`, `organizations/components/organization-settings/*`,
`organizations/services/organizations.service.ts`, `organizations/models/organization-errors.ts`,
`shared/util/api-error.ts`, `auth/services/auth.service.ts`, `auth/stores/auth.state.ts`,
`auth/components/user-settings/*`, `auth/auth.module.ts`.

### Left

- CI on Postgres 15 and MySQL 5.7.
- P4: register its `BillingCancellation` (above).
- After P4 merges: the TODO above (every move to `deleted` refused by P4's guard or through the billing seam).
- The tombstone purge (Needs owner).

## Needs owner

The build goes on with the defaults of `DESIGN.md` §12 (OD-T1 … OD-T14). Nothing blocks yet.

Decisions taken with a default, to confirm:

- **Deleted organizations are kept as tombstones with no purge (P6):** DESIGN §3.9 says 30 days for billing records.
  Nothing deletes the row after that yet; it holds the name, the slug (so nobody takes the address meanwhile), the plan
  and P4's billing columns, no members and no data. A purge is a data deletion of its own (a job and its claim), so it
  waits for the owner's word on the period and on what billing needs to keep.
- **What an operator may do (P6):** list, search, see, suspend and restore, always with a reason that the audit log
  keeps. Operators cannot export or delete an organization, and cannot suspend the default organization; ask if
  support needs more.

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
