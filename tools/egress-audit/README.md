# Egress audit

A runtime proof of what the optional Ever Platform modules of Traduora may send: **nothing at all** when they are off,
**not a single call** when they are loaded but switched off (statistics switched off by the operator, connection not
connected), and **only their own calls** when they are on. Every call they can make is listed in
[`docs/ever-platform/outbound-calls.md`](../../docs/ever-platform/outbound-calls.md).

## The harness

The harness is the egress audit of the public Ever Platform SDK (`ever-co/ever-connect-sdk`), published as the dev-only
npm package `@ever-co/connect-tools` (`ever-egress-audit`). The workflow downloads exactly the version
[`harness.json`](harness.json) pins and refuses it unless its integrity matches; nothing of it is copied here. It runs the
compose file below with every Docker network sealed (no route out), makes CoreDNS the only resolver, captures every
connection attempt and DNS question of the API process from before it starts, drives the API from inside the sealed
setup, and fails the run when the API looks up an Ever host, tries to reach anything outside the compose services,
answers a module route while the modules are off, or makes a call its mode does not allow. In the positive modes a mock
of Ever Platform receives the calls and checks them.

This directory holds only Traduora's inputs:

| File | What it is |
|---|---|
| `egress-audit.config.json` | The API leg: the API as the audited process, the module routes probed in `off`, the watched window (300 s), `TR_EVER_` as the prefix of the mode variables, and the mock's connect code `EVC-TEST-0000-0001` minted for `traduora` (the mock's own default code is for `gauzy` and is refused with `422 product_mismatch`) |
| `docker-compose.audit.yml` | The image under test (`TR_IMAGE`) on SQLite with a random `TR_SECRET` per run, and a local mail catcher (Mailpit, pinned by digest) |
| `adapter.mjs` | Signs in as the operator the API creates at its first start and confirms their e-mail through the mail catcher (an operator must have a confirmed one), opens the Ever Platform routes and checks that each answers as the mode loads it (200 for a loaded module, 404 otherwise), and switches the statistics off (`loaded_off`) |
| `harness.json` | The harness version and integrity |

The Traduora web app is static files served by the API process itself, so this config is the API leg only
(`web_service: null`); a browser leg that walks the web app's pages is a separate change.

## Modes (every pull request)

| Mode | The API | Passes when |
|---|---|---|
| `off` | `TR_EVER_STATS_ENABLED=false`, connection unset | no Ever host looked up, no connection attempt out, every module route answers 404, and the API log has no `ever_stats.` or `ever_connect.` line |
| `loaded_off` | both modules loaded; the operator confirms their e-mail and switches the statistics off through `PUT /api/v1/ever-stats/enabled`; a local reporting address outside the sealed setup and a 240-second interval (the setup, mail wait included, ends long before it); not connected | no call at all; the watched window (300 s) holds the first slot, and the API must have logged `ever_stats.send outcome=skipped_ui_off` (the scheduler ran after the switch-off), so a run in which it never ran fails |
| `positive_stats` | statistics on, reporting to the mock platform every 5 seconds | signed, schema-valid reports accepted, no other call |
| `positive_connect` | connection on with the mock's connect code (`TR_EVER_CONNECT_CODE`), statistics off | exactly the key manifest, redeem, token, heartbeat, event feed, entitlement and integration states |
| control | `positive_stats` without the mock platform | must **fail** (exit 1): a green run is not a blind one |

The job also runs the harness's `cloud-inference` scan over the Ever Platform code (it never guesses where it runs).

## Running it locally

With Docker, Node 22 or later, and the harness (`npm pack @ever-co/connect-tools@<version>` and install the tarball in a
scratch folder):

```sh
docker build -f Dockerfile -t ever-traduora:egress-audit .
export TR_IMAGE=ever-traduora:egress-audit TR_AUDIT_SECRET=$(openssl rand -hex 32)
node <harness>/dist/egress-audit/run.mjs --config tools/egress-audit/egress-audit.config.json --mode off --legs api
```

The evidence (`report.json`, pcaps, DNS logs, the API log, the mock's record) lands in `egress-audit-artifacts/<mode>/`.
