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
| P2 Isolation | 🔨 code complete, pushed | (to open) | Branch `feat/saas-p2-isolation`; mutation check 73.2 %; see "P2 Isolation" below |
| P3 Plans and seats | ⏳ | — | |
| P4 Billing (Stripe test mode) | ⏳ | — | |
| P5 Accounts and hardening | ⏳ | — | |
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
  member acts as project admin; no switch in production code). `yarn --cwd api test:isolation:mutation` runs the suite
  under it and prints the failing share; it fails below 60 %.

### Mutation check results

| Date | Commit | Failing tests with the scope removed | Share | Target |
|---|---|---|---|---|
| 2026-11-27 | `6b689cd` | 60 of 82 | 73.2 % | ≥ 60 % ✅ |

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
- P3: plans, seats and strings with locking (`seats_used` is kept; `strings_used` is recomputed there).

## Needs owner

The build goes on with the defaults of `DESIGN.md` §12 (OD-T1 … OD-T14). Nothing blocks yet.

## How to run the checks

- Node 26 first on `PATH` (CI uses 26.12.1).
- `yarn install --frozen-lockfile` at the root.
- API: `yarn --cwd api lint`, `yarn --cwd api test`, then e2e with `yarn --cwd api test:e2e` (it sets `NODE_ENV=e2e`, the 100-string default plan, stats off and its own SQLite file). On Windows, run jest with `--runInBand` if the formatter specs fail with EPERM on cache renames.
- Web app: `yarn --cwd webapp test --watch=false --browsers=ChromeHeadlessCI`, `yarn --cwd webapp build:prod`.
- Isolation: the e2e suite runs `test/organization-isolation.e2e-spec.ts`; `yarn --cwd api test:isolation:mutation` prints
  the share of it that fails with the organization scope removed (must stay at least 60 %).
