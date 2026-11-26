# Traduora SaaS (app.traduora.co): living handover

> **State: 🔨 P0 design written, PR open (2026-11-27 00:xZ).** Branch `feat/saas-multi-tenant`, worktree
> `E:\Coding\Worktrees\ever-traduora-saas` (EVERPOWER). Brief: homelab
> `projects/traduora/knowledge/handoffs/HANDOVER-2026-11-26-traduora-saas-app-traduora-co.md`. Design:
> [`DESIGN.md`](DESIGN.md).

Read this file first when you pick the work up. It says what is done, what is in flight and what comes next. The
design says how it is built.

## Status per phase

| Phase | State | PR | Notes |
|---|---|---|---|
| P0 Design | 🔨 PR open | (this PR) | `docs/saas/DESIGN.md`; owner questions OD-T1..T14 with defaults in §12 |
| P1 Organizations | ⏳ | — | |
| P2 Isolation | ⏳ | — | |
| P3 Plans and seats | ⏳ | — | |
| P4 Billing (Stripe test mode) | ⏳ | — | |
| P5 Accounts and hardening | ⏳ | — | |
| P6 Operator console and data rights | ⏳ | — | |
| P7 Environments (dev, stage, prod) | ⏳ | — | Each step is a claimed live change (homelab `MAINTENANCE.md` §3) |
| P8 Go live | ⏳ | — | Stripe live keys and webhook are a claimed change |
| P9 Open the sale | ⏳ | — | |

## Needs owner

The build goes on with the defaults of `DESIGN.md` §12 (OD-T1 … OD-T14). Nothing blocks yet.

## How to run the checks

- Node 26 first on `PATH` (CI uses 26.12.1).
- `yarn install --frozen-lockfile` at the root.
- API: `yarn --cwd api lint`, `yarn --cwd api test`, then e2e with `yarn --cwd api test:e2e` (it sets `NODE_ENV=e2e`, the 100-string default plan, stats off and its own SQLite file). On Windows, run jest with `--runInBand` if the formatter specs fail with EPERM on cache renames.
- Web app: `yarn --cwd webapp test --watch=false --browsers=ChromeHeadlessCI`, `yarn --cwd webapp build:prod`.
