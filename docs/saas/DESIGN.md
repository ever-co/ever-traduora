# Ever Traduora as SaaS with organizations: design

> **Status: P0, 2026-11-26.** Written by Claude Opus 5.5 (EVERPOWER) for the owner's request "add SaaS /
> multi-tenancy to Traduora and deploy it on app.traduora.co". The brief is homelab
> `projects/traduora/knowledge/handoffs/HANDOVER-2026-11-26-traduora-saas-app-traduora-co.md`, and the progress is in
> [`HANDOVER.md`](HANDOVER.md). Code facts are from `develop` `ab3ce5e`. The house pattern is Ever Demand's
> multi-tenant work (`ever-co/ever-demand` branch `feat/multi-tenant`, `docs/multi-tenant/DESIGN.md`, PR #1668). Where
> this design differs from it, §13 says why.

## 1. Goal

`app.traduora.co` is a hosted Traduora:

- A company signs up and gets its own **organization**.
- It invites its people, works in its projects, and pays per plan.
- Data of one organization is never visible to another.
- The open-source, self-hosted product keeps working as it does today. The SaaS switch is **off by default**.

## 2. What the code does today (what this design rests on)

| Area | Fact |
|---|---|
| Top object | `Project` (`api/src/entity/project.entity.ts`). There is no organization, tenant or owner column. `plan` is ManyToOne `Plan`, nullable. |
| Membership | `ProjectUser` (project CASCADE, user CASCADE, unique (project, user), role `admin`/`editor`/`viewer`). API keys are `ProjectClient` (per project, with a role). |
| Children of a project | Term, Label, ProjectLocale, Invite, ProjectClient, ProjectUser hang off `project` (CASCADE). Translation and TranslationHistory hang off term and project locale. |
| Isolation today | Every `/api/v1/projects/:projectId/*` route calls `AuthorizationService.authorizeProjectAction()` (`services/authorization.service.ts:54-81`). It loads the caller's `ProjectUser` (or the `ProjectClient` row for an API key) for that project, then checks the role against `domain/actions.ts`. Child ids are always queried with the project id. |
| Routes outside the service | `GET/POST /projects` (scoped to the caller's own memberships), `AuthController.acceptInvites` (writes `ProjectUser`), `EverConnectProvisionService.confirm` (creates a project), `EverConnectPersonService` (a person's own memberships), `EverStatsCollectorService` (installation counts), `UserService.deleteAccount`. A read of the code found no route that reads another caller's project data without the service. |
| `req.user` | A partial `User`, or a `ProjectClient` with only `id` (`services/jwt.strategy.ts`). The JWT carries `sub`, `type`, `sv`, `sh`, `sid`, `jti`. |
| Plans | `Plan` (`code`, `name`, `maxStrings`), seeded `default` (100) and `open-source` (100,000) by migration `1540062777613`. A project gets `TR_DEFAULT_PROJECT_PLAN` at creation. `(localesCount + new) × (termsCount + new) > maxStrings` → 402 (`authorization.service.ts:72-78`, `import.controller.ts:142`). No route changes a plan. |
| Limits | `TR_MAX_PROJECTS_PER_USER` → 429. Uploads 1 MB. |
| Sign-up | `POST /auth/signup` is open unless `TR_SIGNUPS_ENABLED=false` (invitees still pass). Google and Ever ID (OIDC) sign-in exist; Ever ID is off by default. An unverified e-mail can use almost everything. |
| Operator | Only `EverAdminGuard` (verified e-mail in `TR_EVER_ADMIN_EMAILS`), used by the Ever Platform pages. |
| Hardening | The throttler's default limit `0` answers 429 to everything. It does not trust the proxy, so every user behind ingress shares one bucket. No helmet, CSP or HSTS. CORS is `origin:'*'` when on. Redis (`REDIS_HOST`) is used only for login attempts, with no database index option. |
| Migrations | One file per change covering three engines: `switch (config.db.default.type)` with raw SQL. The newer Ever tables use the `TableSpec` renderer in `utils/ever-platform-tables.ts`. Column names are snake_case on Postgres and SQLite, camelCase on MySQL. CI runs every e2e suite on SQLite, Postgres 15 and MySQL 5.7. |
| Timers | Ever Connect scheduler and Ever stats scheduler (both hold a DB lease), Ever ID session sweep (hourly, idempotent), in-memory login-attempt cleanup (only without Redis). |
| Web app | Angular 19, NGXS. Routes `projects`, `projects/:projectId/{terms,labels,translations,team,api,import,export,settings}`, the auth pages, `ever-platform`. `ProjectsState.currentProject` is set from the route. The app bar has the Ever app switcher (PR #664) and no project or tenant switcher. |

## 3. Decisions

### 3.1 The organization is the tenant

- A new `Organization` owns projects. Every project belongs to **exactly one** organization.
- People are members of an organization with a role: `owner`, `admin` or `member`.
- Project roles (`admin`, `editor`, `viewer`) stay as they are, inside the organization.
- A person can belong to several organizations and switches between them in the web app.

### 3.2 Roles

| Organization role | Can |
|---|---|
| `owner` (exactly one) | Everything an admin can do. Also billing changes (Checkout, portal), deleting the organization, and transferring ownership. |
| `admin` | Rename the organization; invite, change and remove members (but not the owner); create projects; view billing. **Implicit project `admin` on every project of the organization when the organization has `admins_see_all_projects`** (OD-T9), so a company can always reach its own data even when the person who made a project leaves. |
| `member` | Create projects (becoming their project admin). See and work in the projects they are a project member of, with their project role. |

- **Implicit access never comes from an upgrade.** Organizations created in SaaS mode (sign-up, `POST /organizations`) have `admins_see_all_projects = true`. The default organization that the migration creates for an existing install has it **false**. So on an upgraded self-hosted install, nobody, the owner included, sees a project they could not see before. An owner can turn it on later in the organization settings, which says plainly what it grants.
- The project role check (`domain/actions.ts`) is unchanged.
- The organization role check is a second, small table: `domain/organization-actions.ts`. It is default-deny, like `actions.ts`.

### 3.3 Where the organization comes from on each request

Traduora is one app on one host (OD-T3), so there are no sub-domains and no `Tenant-Id` header for storefronts.

| Route family | Organization |
|---|---|
| `/api/v1/projects/:projectId/*` | The project's own `organizationId`, loaded by the authorization service. The URL never names it, so it cannot be forged. |
| `/api/v1/organizations/:organizationId/*` (new) | The path parameter. The caller must be a member. |
| `GET /api/v1/projects` | All projects the caller can see, across their organizations. Each project carries `organizationId`. `?organizationId=` filters (the web app always sends it). |
| `POST /api/v1/projects` | `organizationId` in the body. In single-tenant mode it defaults to the default organization. |
| Auth, user, Ever Platform, health | No organization. |
| API keys (`ProjectClient`) | Through their project only (`client → project → organization`). A client can never list or create projects (already `mustBeUser`). |

The web app keeps the current organization in a new `OrganizationsState`. It comes from the URL on organization pages (`/orgs/:slug/...`) and from the project on project pages. It is remembered per browser (localStorage, wrapped) for the next visit.

### 3.4 Isolation by construction (T2): three layers, fail closed

1. **Default-deny route table.** A global `AccessGuard` reads an `@Access(...)` decorator on every controller method. Each route must declare exactly one of:
   - `public`
   - `user` (signed in, no organization)
   - `project:<Action>` (goes through `authorizeProjectAction`)
   - `organization:<Action>`
   - `operator`
   - `webhook`

   A route without the decorator answers **403**. A unit spec walks every route through Nest's `DiscoveryService` and fails when one is missing, the way Demand's `graphql-access.spec.ts` keeps its table complete.
2. **One place resolves a project.** `authorizeProjectAction` becomes the only way a controller gets a project. It loads the project together with its organization and checks, in order:
   1. The organization exists and is `active`. `suspended` → 403 `organization_suspended`, `deleted` → 404.
   2. A user caller is an active member of that organization.
   3. The caller has the project role, or is organization `owner`/`admin` (implicit project admin, §3.2).
   4. For an API key: the key's project is this project. Its organization is then checked the same way, without the member step.

   The service returns the membership with `project.organization` loaded. Every child query keeps using that project's id, as today.
3. **No raw repository for the tenant roots.** Controllers no longer inject `Repository<Project>` or `Repository<Organization>`. They get an `OrganizationScopedProjects` service whose reads always add `organizationId IN (caller's organizations)` and whose writes stamp it. A spec fails when a file outside `services/organization/` injects those repositories (a source scan in the unit suite).

Why not copy `organizationId` onto terms, translations and the other children (Demand copied its tenant id onto every collection)?

- Demand's queries hit each Mongo collection directly, so the copy was the only filter they could add.
- Traduora reaches every child only through an authorized project id, and that id is now tied to its organization in layer 2.
- A copy on `translation` and `translation_history` means migrating the largest tables on three engines. It would add a second value that could disagree with the project's.

So the copy is left out. The isolation suite (§10) and its mutation check prove the layers hold. If a later feature needs to query children across projects, it adds the column then.

### 3.5 Single-tenant mode stays (T9)

The switch is **`TR_SAAS_ENABLED`**, default `false`.

| | Single-tenant (default, self-hosted, demo) | SaaS (`app*.traduora.co`) |
|---|---|---|
| Organizations | Exactly one: the default organization, made by the migration. | Many. Each sign-up creates one. |
| Sign-up | As today (`TR_SIGNUPS_ENABLED`). New users join the default organization as `member`. | Creates the person and their organization (owner, Starter). Invitees join the inviting organization instead. |
| Organization UI | Hidden: no switcher, no settings, members or billing pages. | Shown. |
| Plans and limits | Per project, as today (`Plan.maxStrings`, `TR_DEFAULT_PROJECT_PLAN`). | Per organization (§3.6). Project plans are ignored. |
| Billing, operator console | Off. | On (operator pages need `TR_EVER_ADMIN_EMAILS`). |
| E-mail verification | As today. | Required before use (P5). |

One code path serves both. Single-tenant mode simply has one organization that everyone is in, so isolation code never branches on the mode.

### 3.6 Plans, seats and strings (T4)

The plans are a code constant (`api/src/domain/organization-plans.ts`), as in Demand, not rows in `plan`. The existing `plan` table stays for single-tenant projects.

| Plan | `code` | Seats included | Extra seats | Strings |
|---|---|---|---|---|
| Starter (free) | `starter` | 15 | none | 10,000 (OD-T2) |
| Small Business | `small_business` | 25 | +1 per extra seat bought | unlimited |
| Enterprise | `enterprise` | unlimited (OD-T5) | — | unlimited |

- **Seats** count the organization's members plus everyone else with a pending invitation: an organization invite, or a
  project invite to one of its projects (OD-T10). A person counts once.
- **Strings** count the sum over the organization's projects of `localesCount × termsCount`, the formula Traduora already uses per project.
- The limits are checked on:
  - invite create and invite accept;
  - adding a member through a project invite;
  - adding a term or a locale, and imports.
- **Parallel requests cannot exceed a limit.** Each check runs in a read-committed transaction that holds the
  organization row lock and reads the counts under it:
  - `SELECT … FOR UPDATE` on Postgres and MySQL;
  - SQLite transactions are already serialized (`app.module.ts:88-91`).
- **One lock order for the whole API: account (user row) → project(s) → organization(s).** This is the order of
  *Delete account* (account → its projects → its organizations) and of an invitation's acceptance.
  - A transaction that holds both a project lock and the organization lock takes the project lock first, then
    `lockOrganization`. This covers term and locale adds, imports, project invites and their acceptance.
  - That includes the implicit lock of a foreign key: a row that references a project (a project membership or
    invitation) is written under an organization lock only after that project was locked, at least for share.
  - Several locks of a kind (projects, organizations) are taken in the order of their ids.
  - A check of the organization's string total locks only its own project, then the organization, and reads the
    totals under the organization lock. It never locks the other projects: every writer of strings takes the
    organization lock, so the totals are serialized.
  - The rule sits next to `lockOrganization`, and `api/src/utils/lock-order.spec.ts` scans the source for a project
    lock after an organization lock. A deadlock would still answer 503 with `Retry-After`, as a backstop only.
- The organization keeps cached counters (`seatsUsed`, `stringsUsed`), recomputed inside the same transaction.
- **Errors:**
  - 402 `plan_limit_reached`, with `limit`, `used` and `plan` in the body;
  - the web app shows "Your plan allows N members. Upgrade to add more." with a link to billing.
- **A downgrade, a lapse or a cancel never deletes data.** Over the limit, adds are refused until the organization is back under it. Reads, edits and exports keep working.
- **The effective plan** falls back to Starter on `canceled`, `unpaid` or `incomplete_expired`, and after `TR_BILLING_PAST_DUE_GRACE_DAYS` (default 14) of `past_due`.

### 3.7 Billing (T5, P4): Stripe Billing on the shared Ever account

OD-T1 default: Traduora bills its own organizations.

- **Prices** by lookup key: `ever_traduora_cloud_{small_business,enterprise}_{monthly,annual}`, which exist on the shared account.
- **Extra seats** are a second line item with lookup key `ever_seat_traduora_cloud_small_business_{monthly,annual}`. If the key is missing in test mode, P4 creates it ($5 per month, as the pricing spec says) and lists the live one under Needs owner (OD-T11).
- **Checkout**:
  - `mode: subscription`;
  - `client_reference_id` and `metadata.organizationId` carry the organization;
  - `subscription_data.trial_period_days` = `TR_BILLING_TRIAL_DAYS` (90), once per organization;
  - `payment_method_collection: 'always'` (OD-T6: a card at the start of a paid trial; Starter needs none);
  - `automatic_tax: { enabled: true }` and `billing_address_collection: 'required'`.

  A new Checkout is refused while a live subscription exists; the customer portal is offered instead.
- **One Checkout at a time.** Two clicks or two tabs must not end in two subscriptions:
  - Creating a session locks the organization row. If the organization already holds an open session that has not expired (`checkout_session_id`, `checkout_expires_at`), its URL is returned again; otherwise the new session's id and expiry are stored in the same transaction.
  - The Stripe call carries an idempotency key built from the organization id, the price and the stored attempt counter.
  - Backstop in the webhook: a second subscription for an organization that already has a live one is cancelled at once (no proration, still in its trial, so nothing is charged) and written to the billing log.
- **Customer portal:** opened on the organization's `stripeCustomerId`, which is server-only, never sent by the client. It covers plan changes, seats, invoices and cancellation.
- **Webhook:** `POST /api/v1/billing/webhook`.
  - Raw body, verified with `stripe.webhooks.constructEvent` and `TR_STRIPE_WEBHOOK_SECRET`.
  - **Idempotent**: the event id is inserted into `billing_event` (primary key = event id) in the same transaction that applies it. A duplicate is a no-op. A failure rolls back both, so Stripe retries.
  - Handled events:
    - `checkout.session.completed`
    - `customer.subscription.created|updated|deleted`
    - `invoice.paid`
    - `invoice.payment_failed`
  - The plan and the seat count are read from the subscription's price lookup keys, never from metadata the client could shape. A subscription whose customer is not the organization's is ignored.
- **Keys:** `TR_STRIPE_SECRET_KEY`, `TR_STRIPE_WEBHOOK_SECRET` and `TR_STRIPE_PUBLISHABLE_KEY` (not needed with hosted Checkout). They come from OpenBao `kv/ever-traduora/<env>`, **test mode** until P8. Live keys and the live webhook endpoint are a claimed change.
- **Billing page:** plan, seats used / included / bought, trial end, next invoice. Admins see it read-only; only the owner gets the Upgrade (Checkout) and Manage billing (portal) buttons, matching the role table of §3.2.

### 3.8 Accounts and hardening (T3, T7, P5)

- **E-mail verification is required in SaaS mode.** An unverified person gets 403 `email_not_verified` on every route except auth, `users/me`, verify and resend. The web app shows a "Check your inbox" page with "Resend".
- **Mail:** Postmark over SMTP (`TR_MAIL_*`), as the other fleet apps do.
- **Ever ID sign-in** is on for the hosted service (`TR_AUTH_EVERID_*`, one Ever ID client per environment), together with password and Google.
- **Terms and privacy** are accepted at sign-up, with the versions recorded on the user (`terms_version`, `privacy_version`, `terms_accepted_at`) from `@ever-co/legal`, as Ever Rec does. A new version asks for acceptance again at the next sign-in.
- **Bot check:** Cloudflare Turnstile on sign-up and on forgot-password (OD-T8), with `TR_TURNSTILE_SITE_KEY` and `TR_TURNSTILE_SECRET_KEY`. Off when unset.
- **Throttling:**
  - `TR_TRUST_PROXY` (hop count) sets Express `trust proxy`, so each visitor gets their own bucket.
  - In SaaS mode the global default becomes 600 requests per minute instead of `0`. An explicit `TR_THROTTLE_LIMIT` still wins.
  - A per-address sign-up limit (`TR_SIGNUPS_PER_HOUR`, default 10).
- **Headers:** `helmet` (latest) with a CSP that allows the app itself, Google Fonts, Turnstile and the Ever ID issuer. HSTS (1 year, includeSubDomains) only when `TR_VIRTUAL_HOST` is https.
- **CORS:** `TR_CORS_ORIGINS` (a list) replaces `origin:'*'`. The old `TR_CORS_ENABLED=true` still means `*`, for existing installs.
- **Uploads and imports:** the 1 MB upload limit stays. Imports count against the string limit of §3.6.

### 3.9 Operator console and data rights (T6, T8, P6)

- **Operators** are the existing `EverAdminGuard` people (`TR_EVER_ADMIN_EMAILS`, verified e-mail). Their routes are `/api/v1/operator/organizations`:
  - list and search;
  - detail with plan, seats and strings used, projects count and created date;
  - suspend and restore.

  The web app gets `/operator` pages, shown only to operators.
- **Suspension** is read on every request (layer 2 of §3.4, no cache), so members are locked out at once.
- **Audit:** every operator action is written to `operator_audit` (who, what, which organization, when, why).
- **Organization export** (owner/admin): a zip with every project's terms and translations (JSON, one file per locale), labels, members and plan. It is built on the fly from the existing export code.
- **Organization deletion** (owner only, confirmed by typing the slug):
  1. Cancel the subscription.
  2. Delete the projects (CASCADE).
  3. Mark the organization `deleted` and keep a tombstone row 30 days for billing records.
- **Account deletion for the last admin** (`DELETE /users/me`, blocked today):
  - a shared project offers to transfer the project admin role to another member;
  - an organization the person owns offers to transfer ownership, or to delete the organization when they are its only member.

## 4. Data model

All ids are uuid strings, like the existing entities.

### 4.1 `organization` (P1)

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | primary key |
| `name` | varchar(255) | 2–80 characters |
| `slug` | varchar(40) | unique. `^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$`, no `--`. Reserved: `app`, `api`, `www`, `admin`, `default`, `operator`, `billing`, `auth`, `login`, `signup`, `settings`, `new`, `orgs`, `projects`, `ever`, `traduora`, `help`, `support`, `status`, `docs` |
| `status` | varchar(16) | `active` / `suspended` / `deleted` |
| `plan_code` | varchar(32) | `starter` / `small_business` / `enterprise`. The default organization of a single-tenant install gets `enterprise` (no limits). |
| `is_default` | boolean | true only for the organization the migration creates |
| `admins_see_all_projects` | boolean | owner/admin are implicit project admins (§3.2). `true` for organizations made in SaaS mode, `false` for the default organization |
| `seats_used`, `strings_used` | int | cached counters (§3.6) |
| `date_created`, `date_modified` | timestamp | |

P4 adds:

| Column | Type | Notes |
|---|---|---|
| `stripe_customer_id`, `stripe_subscription_id` | varchar | server-only |
| `billing_status` | varchar | Stripe subscription status |
| `billing_interval` | varchar | `monthly` / `annual` |
| `extra_seats` | int | |
| `trial_ends_at`, `current_period_end`, `past_due_since` | timestamp | |
| `checkout_session_id`, `checkout_expires_at` | varchar, timestamp | the open Checkout session, reused until it expires (§3.7) |

### 4.2 `organization_user` (P1)

`id`, `organization_id` (FK CASCADE), `user_id` (FK CASCADE), `role` (`owner`/`admin`/`member`), `date_created`. Unique on (`organization_id`, `user_id`). There is exactly one `owner` per organization, enforced in the service and checked by a spec.

### 4.3 `organization_invite` (P1)

`id`, `organization_id` (FK CASCADE), `email`, `role`, `status` (`sent`/`accepted`), `token_hash`, `invited_by_user_id`, `date_created`. Unique on (`organization_id`, `email`).

- A pending project invite to someone who is not yet a member takes a seat of the organization itself (OD-T10); no
  organization invite is made for it.
- On acceptance, the organization membership is created before the project membership, in one transaction.

### 4.4 `project.organization_id` (P1)

A FK to `organization`, CASCADE, with an index.

- **Postgres and MySQL:** `NOT NULL` after the backfill.
- **SQLite:** stays nullable at the DB level. Making it `NOT NULL` means rebuilding `project` with every FK that points at it, which is the same kind of table rebuild that lost the translation foreign keys before (#551).
- **All engines:** the entity marks it required, every insert sets it, and a boot check refuses to start when a project has none.

### 4.5 Later phases

- P4: `billing_event` (`id` = Stripe event id, primary key; `type`; `organization_id`; `date_processed`).
- P5: on `user`, `terms_version`, `privacy_version`, `terms_accepted_at`.
- P6: `operator_audit`.

### 4.6 Migrations (P1)

One migration file per change, covering all three engines, written with the `TableSpec` renderer of `utils/ever-platform-tables.ts` for new tables. It follows each engine's column naming: camelCase on MySQL, snake_case on the others.

**`<ts>-add-organizations.ts`** (idempotent, re-runnable):

1. Create `organization`, `organization_user` and `organization_invite`. Add `project.organization_id` (nullable) with its index.
2. If no default organization exists, create it, **also on an empty database** (a fresh install: single-tenant sign-ups and the boot seed need it):
   - `slug: default`;
   - `name: TR_DEFAULT_ORGANIZATION_NAME`, default "My organization";
   - `plan_code: enterprise`, `is_default: true`, `admins_see_all_projects: false`.
3. `UPDATE project SET organization_id = <default> WHERE organization_id IS NULL`.
4. Insert an `organization_user` for **every** user:
   - The **owner** is the user with `TR_ADMIN_EMAIL` if they exist. Otherwise it is the earliest-created user who is a project admin, and otherwise the earliest user.
   - Everyone else becomes `member`. Nobody becomes organization `admin` because they administer a project: the upgrade never widens what anyone can see (§3.2).
5. Postgres and MySQL: set `project.organization_id NOT NULL` and add the FK.
6. Compute `seats_used` and `strings_used`.

**Data safety:** the migration only adds tables, columns and rows; it changes no existing value. Before it runs on any environment with data, a restorable backup is proven (homelab rule 11). Its `down` drops the new column and tables. Existing installs therefore upgrade with nothing lost, which the e2e upgrade test proves (§10).

## 5. API

New, all under `/api/v1`:

| Route | Access |
|---|---|
| `GET /organizations` | user: my organizations, with my role |
| `POST /organizations` | user, SaaS mode only: name, slug → the caller becomes owner, Starter |
| `GET/PATCH /organizations/:id` | organization:View / organization:Edit |
| `DELETE /organizations/:id` | organization:Delete (owner, P6) |
| `GET /organizations/:id/members`, `PATCH/DELETE …/members/:userId` | organization:ViewMembers / EditMembers |
| `POST /organizations/:id/transfer-ownership` | owner |
| `GET/POST /organizations/:id/invites`, `DELETE …/invites/:inviteId` | organization:EditMembers |
| `POST /auth/accept-organization-invite` | user (token) |
| `GET /organizations/:id/usage` | owner/admin (organization:ViewUsage): plan, seats, strings, limits |
| `GET /organizations/:id/billing` | owner/admin, read-only (P4) |
| `POST /organizations/:id/billing/checkout`, `POST …/billing/portal` | owner only (P4) |
| `POST /billing/webhook` | webhook (P4) |
| `GET /organizations/:id/export` | owner/admin (P6) |
| `GET /operator/organizations`, `GET/POST …/:id`, `POST …/:id/suspend`, `POST …/:id/restore` | operator (P6) |

Changed:

- `GET /projects` adds `organizationId` to each project and accepts `?organizationId=`.
- `POST /projects` takes `organizationId`.
- `GET /auth/providers` also returns `saas: boolean` and the Turnstile site key, so the web app knows what to show.

## 6. Web app

- Routes:

  | Route | Page |
  |---|---|
  | `/orgs/:slug/projects` | the project list, filtered |
  | `/orgs/:slug/settings` | name, slug, danger zone |
  | `/orgs/:slug/members` | members and invites, seats |
  | `/orgs/:slug/billing` | P4 |
  | `/orgs/new` | create another organization |
  | `/operator` | P6 |

  `/projects` redirects to the current organization's list in SaaS mode.
- Project pages keep `/projects/:projectId/...`, so existing links and bookmarks keep working.
- **Organization switcher** in the app bar, right after the "traduora" wordmark: the current organization's name with a chevron, a list of the person's organizations, and "New organization". It is shown only in SaaS mode. It builds on the Ever app switcher component of PR #664 and does not replace it.
- **Sign-up** in SaaS mode asks for the organization name (default "<Name>'s organization"; the slug is derived and editable), plus the terms checkbox and Turnstile.
- Every new screen runs `unslop` (rule 22). The look is Bootstrap 4, like the rest of the app.

## 7. Configuration (new variables)

| Variable | Default | Meaning |
|---|---|---|
| `TR_SAAS_ENABLED` | `false` | The switch of §3.5 |
| `TR_DEFAULT_ORGANIZATION_NAME` | `My organization` | Name of the default organization made by the migration |
| `TR_BILLING_TRIAL_DAYS` | `90` | Trial on paid plans |
| `TR_BILLING_PAST_DUE_GRACE_DAYS` | `14` | Past due → Starter limits after this |
| `TR_STRIPE_SECRET_KEY`, `TR_STRIPE_WEBHOOK_SECRET` | unset | Billing off when unset |
| `TR_TURNSTILE_SITE_KEY`, `TR_TURNSTILE_SECRET_KEY` | unset | Bot check off when unset |
| `TR_TRUST_PROXY` | unset | Express `trust proxy` (hops, or a list) |
| `TR_CORS_ORIGINS` | unset | Allowed origins; replaces `*` |
| `TR_SIGNUPS_PER_HOUR` | `10` | Per address, SaaS mode |
| `TR_REQUIRE_VERIFIED_EMAIL` | `= TR_SAAS_ENABLED` | §3.8 |
| `REDIS_DB` | `0` | Redis database index (needed to share the fleet's Valkey, §8) |

## 8. Environments (P7; every step is a claimed live change)

| | dev | stage | prod |
|---|---|---|---|
| Branch → image | `develop` → `:dev` | `stage` → `:stage` | `main`/`master` → `:prod` |
| k8s-gitops app, namespace | `ever-traduora-dev` | `ever-traduora-stage` | `ever-traduora-prod` |
| Host (OD-T4) | `app-dev.traduora.co` | `app-stage.traduora.co` | `app.traduora.co` |
| Database (CNPG `pg`, via `pg-pooler-session`) | `ever_traduora_dev` | `ever_traduora_stage` | `ever_traduora_prod` |
| Replicas | 1 | 1 | 2 |
| Secrets | OpenBao `kv/ever-traduora/dev` | `…/stage` | `…/prod` |
| Stripe | test | test | test until P8, then live |

- The **demo stays as it is** (`ever-traduora-demo`: SQLite, single-tenant, `TR_DEMO=true`). Nothing moves from it (OD-T7).
- **Files, following `apps/ever-traduora-demo`** (one set per environment):
  - `namespace`, `limitrange`, `quota`, `serviceaccount`;
  - `externalsecret` (store `openbao`, key `ever-traduora/<env>`);
  - `cm-traduora-config` (`TR_DB_TYPE=postgres`, `TR_DB_HOST=pg-pooler-session.databases.svc.cluster.local`, `TR_DB_PORT=5432`, `TR_SAAS_ENABLED=true`, `TR_TRUST_PROXY`, throttle limits);
  - `deploy` (no PVC), `svc`, `ing` (Cloudflare terminates TLS);
  - `networkpolicy` (adds egress to the `databases` namespace on 5432);
  - `kustomization`;
  - plus `argocd/applications/ever-traduora-<env>.json` with Image Updater on the env tag and the digest strategy.
- **Database:**
  - `apps/databases/database-ever-traduora-<env>.yaml` (`Database` CR on cluster `pg`, `databaseReclaimPolicy: retain`), synced by hand through the ArgoCD app `databases` (rule 12).
  - The role is created on the primary with a `CONNECTION LIMIT` sized for replicas × 10 + headroom (node-postgres pool default 10). Its password goes to OpenBao.
  - The PITR (barman-cloud) and nightly `pg_dump` jobs cover a new database without changes.
  - Before the first database is created, the backup-first gate runs: a recent completed backup with a `backupId`, a healthy `pg_stat_archiver`, the restore point recorded.
  - A restore drill of `ever_traduora_prod` is written down before go-live (P7 done-when).
- **Redis:** without Redis, login attempts are counted in memory per pod (`redis/user-login-attempts.storage.ts`). With two replicas, a guesser would get one budget per pod.
  - **Prod** therefore gets a small per-namespace Valkey: no persistence, only a cache. It follows `apps/trigger/statefulset-trigger-cache.json`, with its password from OpenBao, and the app uses `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`.
  - **Dev and stage** run one replica and need none.
  - The fleet's shared Valkey is not used. Traduora cannot pick a database index today, so its keys would land in db0, which is Gauzy production's. `REDIS_DB` (§7) is added in P5 so that can change later.
  - The throttler stays in memory per pod, which is acceptable at two replicas.
- **Timers with two replicas:**
  - The Ever Connect and Ever stats schedulers already hold a DB lease, so one pod runs them.
  - The Ever ID session sweep is idempotent.
  - No new timer is added. Billing is webhook-driven.
- **DNS:** a proxied CNAME per host to the existing Cloudflare tunnel (its catch-all goes to ingress-nginx), then `scripts/cf-dns-export.sh`. Dev and stage also go into the zone's noindex rule.
- **Monitoring:** a `VMProbe` per host, like `vmprobe-ever-platform-*`.

## 9. Ever Platform (T11, later)

Ever Connect is already in the repo and keeps working per installation. Two pieces are a later phase (P10), not a condition for going live:

- mapping an Ever Platform entitlement to an organization's plan;
- a provisioner so "Set up in Ever Cloud" creates a Traduora organization.

`EverConnectProvisionService.confirm`, which creates a project today, will create it in the person's organization once P1 lands. P1 makes that change.

## 10. Tests

- **Unit** (jest):
  - the organization action table;
  - the `@Access` coverage spec (every route declared);
  - the source scan for repository injections;
  - slug rules;
  - plan limits (seat and string math, effective plan);
  - the webhook handler with signed fixtures (P4).
- **Isolation e2e** (`api/test/organization-isolation.e2e-spec.ts`, all three engines in CI). Organizations A and B each get:
  - an owner, an admin, a member, a project with terms, locales, translations, labels, an API key and pending invites;
  - one person who is a member of both.

  The suite asserts that A cannot read, list, count, change, delete or guess anything of B:
  - every `/projects/:projectId/*` route, using B's real ids;
  - project and organization lists;
  - organization members and invites;
  - imports into B and exports of B;
  - A's API key against B's project;
  - invite tokens and acceptance across organizations;
  - usage and billing of B.

  The two-organization person sees each organization's projects only where they are a member. A suspended organization locks its members out at once.
- **Mutation check:** `api/test/organization-isolation.mutation.json`, a jest config that maps the organization scope module to a no-op double (`test/mutation/no-organization-scope.ts`), with no switch in production code. With scoping off, the isolation suite must fail broadly. `yarn --cwd api test:isolation:mutation` prints the failing share; the design target is at least 60 %, and the result is written into `HANDOVER.md` each time it runs.
- **Upgrade e2e:** start from a database migrated to today's latest migration, seed projects and members, run the new migration, and check that:
  - everything is in the default organization;
  - every user is a member with the right role;
  - nothing else changed (row counts per table).
- **Limits under concurrency:** 20 parallel invite or term requests at the edge of a limit never exceed it (Postgres and MySQL; SQLite is serialized).
- **Web app** (Karma): organization switcher, members page, billing page, the sign-up form in SaaS mode.
- **Billing in Stripe test mode** (P4, by script):
  - subscribe;
  - add seats;
  - upgrade, downgrade;
  - cancel;
  - a failed payment (test card `4000 0000 0000 0341`);
  - a replayed webhook changes nothing.
- **Production check** (P8): `scripts/saas-e2e.mjs`, like Ever Rec's `rec-e2e.mjs`:
  1. sign up with Ever ID;
  2. create a project, import a file;
  3. invite, export;
  4. subscribe with a test clock or a test account.

## 11. Phases and PRs

One PR per phase into `develop`, stacked where a phase needs the previous one. Push about every 30 minutes.

| Phase | PR content |
|---|---|
| P0 | This file and `HANDOVER.md` |
| P1 | Entities and migration (§4), organization service and routes (§5), project ↔ organization, invites, web app organization pages and switcher (§6), single-tenant behavior, upgrade e2e |
| P2 | `AccessGuard` + `@Access` on every route, `authorizeProjectAction` organization checks, scoped project service, source scan, isolation e2e, mutation check |
| P3 | Organization plans, seats and strings with locking, errors in API and UI |
| P4 | Stripe Billing (test mode) |
| P5 | Verification required, Postmark, Ever ID on, terms versions, Turnstile, throttler with trust proxy, helmet/CSP/HSTS, CORS origins |
| P6 | Operator console, audit, organization export and deletion, last-admin account deletion |
| P7 | k8s-gitops (homelab claims), no code |
| P8, P9 | Go live and open the sale (homelab and ever.co checkout catalog) |

P4, P5 and P6 run in parallel lanes after P3, each in its own worktree, one writer per file set:

| Lane | Files |
|---|---|
| P4 | `api/src/billing/**`, `webapp/src/app/organizations/billing/**` |
| P5 | `api/src/main.ts`, `app.module.ts` hardening block, `auth.controller.ts` |
| P6 | `api/src/operator/**`, `webapp/src/app/operator/**` |

The shared file `app.module.ts` gets one module import per lane and is merged in the order P5, P4, P6.

## 12. Owner questions (defaults used; the build does not wait)

| # | Question | Default used |
|---|---|---|
| OD-T1 | Billing home | Traduora bills itself; Ever Platform entitlements later (P10) |
| OD-T2 | String limits per plan | Starter 10,000; paid plans unlimited |
| OD-T3 | Sub-domains or custom domains per organization | No: one host, the organization in the session and the URL |
| OD-T4 | Hosts | `app-dev.traduora.co`, `app-stage.traduora.co`, `app.traduora.co`; the API on the same host under `/api` |
| OD-T5 | Enterprise "unlimited companies" | Not in v1: Enterprise = one organization, unlimited seats |
| OD-T6 | Card on Starter | No card on Starter; a card at the start of a paid trial |
| OD-T7 | Demo data | The demo stays a separate single-tenant SQLite install |
| OD-T8 | Bot check | Cloudflare Turnstile |
| OD-T9 | Organization admins see every project of their organization | Yes in organizations made in SaaS mode (`admins_see_all_projects`); no in the default organization of an upgraded install, so an upgrade never widens access |
| OD-T10 | A project invite to a non-member takes a seat | Yes, as an organization `member` invite |
| OD-T11 | Extra-seat price on Stripe (`ever_seat_traduora_cloud_small_business_*`) | Created in test mode at $5/month if missing; the live price needs the owner |
| OD-T12 | Existing per-user project limit (`TR_MAX_PROJECTS_PER_USER`) in SaaS mode | Kept (100); plans limit seats and strings, not projects |
| OD-T13 | Over the limit after a downgrade or lapse | Adds refused, nothing deleted, reads and exports keep working |
| OD-T14 | Past-due grace | 14 days, then Starter limits |

## 13. Where this differs from Ever Demand, and why

| Point | Demand | Traduora |
|---|---|---|
| Tenant resolution | JWT claim, header, sub-domain | The project's own organization, or the `/organizations/:id` path; one host |
| Tenant id on children | On every collection (Mongo plugin) | On `project` only. Children are reached only through an authorized project (§3.4). |
| Data-layer bypass | `runAsSystem(reason)` | The same idea: the few system paths (migration, webhook, stats, provisioning) call the scoped service with an explicit `system` reason, and the source scan lists them |
| Plan limit race | Count-then-insert, open | Organization row lock in the same transaction (§3.6) |
| Mutation check | By hand | A jest config that swaps the scope module, run by a script, result in the handover |
| Single-tenant switch | `MULTI_TENANT` | `TR_SAAS_ENABLED` (the repo's `TR_` prefix) |
