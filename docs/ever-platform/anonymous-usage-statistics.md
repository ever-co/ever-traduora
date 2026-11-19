---
id: anonymous-usage-statistics
title: Anonymous usage statistics
sidebar_label: Anonymous usage statistics
---

Traduora can send one small, anonymous report a day about the installation as a whole to Ever Platform: how many users,
projects, terms, translations, project locales and API clients it has, how many translations were changed this month, and
whether two settings are on. It never sends anything about the people, projects, terms or translations it holds. The
report follows the published schema `ever.stats.v1`, and the code that builds and sends it is in this repository
(`api/src/ever-stats`, with the installation identity in `api/src/ever-instance`).

The statistics are **off by default**. Nothing is loaded and nothing is sent unless the operator sets
`TR_EVER_STATS_ENABLED=true` (see [How to turn it on or off](#how-to-turn-it-on-or-off)). Every existing feature works
the same either way.

## What is sent

One document per installation per calendar month (UTC), sent once a day. A complete report:

```json
{
  "schema": "ever.stats.v1",
  "report_id": "c87a798d-24b4-47d2-9071-2ce737b31beb",
  "instance_id": "0572c446-d926-40de-b433-b331dac9a11a",
  "sent_at": "2026-11-02",
  "module_version": "1.0.0",
  "product": "traduora",
  "instance_kind": "backend",
  "serves": ["traduora"],
  "version": "0.23.0",
  "channel": "stable",
  "install_source": "self-hosted",
  "country": "ZZ",
  "period": "2026-11",
  "final": false,
  "counts": { "users": 15, "projects": 8, "terms": 2240, "translations": 9310, "locales": 21, "project_clients": 3 },
  "features": { "google_login": false, "signups_enabled": true },
  "aggregates": { "translations_changed": 376 }
}
```

### The envelope

| Field                              | Meaning                                                                                                                  | Where the value comes from                                                                                                  |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `schema`                           | Always `ever.stats.v1`                                                                                                   | constant                                                                                                                    |
| `report_id`                        | A random UUID for this report                                                                                            | minted per report                                                                                                           |
| `instance_id`                      | A random UUID that identifies this installation, not a person or a company                                              | created the first time it is needed and stored in the `ever_instance` table; _Reset instance identity_ makes a new one      |
| `sent_at`                          | The UTC day the report was built (no time of day)                                                                        | clock                                                                                                                       |
| `module_version`                   | Version of the statistics module                                                                                         | constant                                                                                                                    |
| `product`, `instance_kind`, `serves` | `traduora`, `backend`, `["traduora"]`                                                                                  | constants                                                                                                                   |
| `version`                          | The Traduora API release, `major.minor.patch` only                                                                       | `api/package.json`; a pre-release or build suffix is never sent                                                             |
| `channel`                          | `stable`, `rc`, `beta`, `dev` or `custom`, from the version's suffix                                                     | `api/package.json`                                                                                                          |
| `install_source`                   | How the installation was set up: `self-hosted` (default), `cloud`, `ever.sh`, `works_app`, `desktop` or `partner:<name>` | `TR_EVER_INSTALL_SOURCE` only; never guessed from a host name or any other signal                                          |
| `country`                          | Two capital letters declared by the operator, or `ZZ`                                                                    | `TR_EVER_STATS_COUNTRY` only; never derived from data or addresses                                                         |
| `period`                           | The calendar month (UTC) the numbers describe                                                                            | clock                                                                                                                       |
| `final`                            | `true` for the closed previous month, sent once more on days 1-3 of the next month                                       | scheduler                                                                                                                   |

### The Traduora lists

| Section      | Key                    | Meaning                                                               |
| ------------ | ---------------------- | --------------------------------------------------------------------- |
| `counts`     | `users`                | User accounts                                                         |
| `counts`     | `projects`             | Projects                                                              |
| `counts`     | `terms`                | Terms, all projects together                                          |
| `counts`     | `translations`         | Translations, all projects and locales together                       |
| `counts`     | `locales`              | Project locales (a locale added to two projects counts twice)         |
| `counts`     | `project_clients`      | API clients                                                           |
| `features`   | `google_login`         | Whether `TR_AUTH_GOOGLE_ENABLED` is `true`                            |
| `features`   | `signups_enabled`      | Whether `TR_SIGNUPS_ENABLED` is on                                    |
| `aggregates` | `translations_changed` | Translations whose last change falls in the month of the report (UTC) |

These are the only keys a Traduora report can carry. Counts are whole numbers, features are `true`/`false`, and every
string has a fixed format. There is no name, e-mail address, user or project id, project name, term, translation, API
key, URL, host name or free text anywhere, and there cannot be: the schema is closed at every level, and the module
refuses to sign a report that does not pass it. The numbers are row counts of the database; nothing else is read.

## Before anything is sent

The report is serialised once. Those exact bytes are checked the way Ever Platform checks them (size at most 16 KiB,
strict JSON, the published schema, every string bound to its format, a real calendar day). A report that fails is stored
as `rejected` and never signed or sent.

## When and where

- The first report goes out a day after the first start; after that, once a day at a second drawn at random for each day
  (UTC). When the last report is more than a day old at a restart, the next one goes out 10 minutes after the start. On
  days 1-3 of a month the closed previous month is sent once more with `final: true`.
- Several API processes on one database count as one installation: they share the identity and a lease in the
  database, so one of them sends.
- The report goes to `POST <TR_EVER_STATS_API_URL>/v1/stats/reports` (`TR_EVER_STATS_API_URL` defaults to
  `TR_EVER_PLATFORM_API_URL`, then `https://api.ever.co`): exactly the checked bytes, with the headers `Ever-Stats-Key`
  (the installation's statistics public key), `Ever-Stats-Signature` (`ed25519=<signature of the exact bytes>`),
  `Ever-Stats-Key-Id` and `User-Agent: ever-connect-sdk/<contract version> (traduora/<version>)`. No cookie, no
  credential, no redirect followed, a 10-second limit. The address must be `https`; plain `http` is accepted only for a
  local address (this machine, a private address range or a container name).
- Answers: `202` is recorded as `sent`. `422` is recorded as `rejected` and nothing is sent again until the module is
  upgraded, _Send now_ included. `409` (Ever Platform knows this instance id with another key) is recorded as `rejected`
  with the hint _Reset instance identity_. `429`, `5xx` and connection errors are recorded as `failed` and tried again
  after 1 hour, 4 hours and 12 hours, then at the next day's slot. Any other answer is tried again at the next day's slot.

### The statistics key

The installation makes its own Ed25519 key pair the first time it needs one. The private key is stored in the
`ever_instance` table encrypted with AES-256-GCM, under a key derived from `TR_SECRET`; it never appears in a log or an
API answer, and it signs these reports and nothing else. Without a configured `TR_SECRET` nothing is created and nothing
is sent. If `TR_SECRET` changes, the stored key can no longer be read: the installation then makes a new identity (a new
`instance_id` and key) on its own.

## How to turn it on or off

| Switch                                                            | Effect                                                                                                                                                                                                                                                                 |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TR_EVER_STATS_ENABLED` unset (the default), or anything but `true` | The statistics are not loaded at all: no route (`/api/v1/ever-stats/*` does not exist), no timer, no request, no table row. The value is compared exactly: anything other than `true` or `false` keeps the default (off) and is logged at start. |
| `TR_EVER_STATS_ENABLED=true`, then a restart                      | The statistics are loaded and send once a day.                                                                                                                                                                                                                        |
| _Ever Platform → Statistics → Turn off_                           | The module stays loaded so the page works, but no report is built or sent and _Send now_ is refused. The switch is read again before every report.                                                                                                                    |

The page is shown to the operator of the installation only: a user whose e-mail is listed in `TR_EVER_ADMIN_EMAILS`
(comma separated), or, when that is unset, the `TR_ADMIN_EMAIL` user. Everyone else, project admins included, and every
API client gets no menu entry and a "not found" answer from the routes. An installation declared with
`TR_EVER_INSTALL_SOURCE=cloud` shows the switch read-only: its deployment decides.

## How to view the last payload

_Ever Platform → Statistics_ (in the account menu) shows the operator:

- the state and the reason, the next and the last send, the instance id and the key id;
- **What is sent**: the report built now, with the same code, without sending it;
- **Last payload**: the exact bytes of the last report, its date, its status and the HTTP answer (the last 12 attempts
  are kept in the `ever_stats_report` table);
- **Send now** (at most once every 10 minutes) and **Reset instance identity** (a new `instance_id` and a new statistics
  key; the list of past reports is cleared).

The same is available to the operator from the API:

| Route (`/api/v1/ever-stats/...`)             | What it does                                                                     |
| -------------------------------------------- | -------------------------------------------------------------------------------- |
| `GET health`                                 | Anyone: whether the module is loaded                                             |
| `GET status`                                 | State, reason, next and last send, instance id, key id, country, install source |
| `POST preview`                               | What is sent                                                                     |
| `GET reports?limit=12`                       | The last reports                                                                 |
| `POST send`                                  | Send now                                                                         |
| `PUT enabled` `{"enabled": true \| false}`    | The switch                                                                       |
| `POST reset-identity`                        | Reset instance identity                                                          |

Turning the switch on or off records when and by whom (the user id, no e-mail); a reset increases a counter and is
logged with the user id.

## All settings

| Variable                        | Default                                              | Meaning                                                                         |
| ------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------- |
| `TR_EVER_STATS_ENABLED`         | off                                                  | `true` loads the statistics                                                     |
| `TR_EVER_STATS_API_URL`         | `TR_EVER_PLATFORM_API_URL`, then `https://api.ever.co` | Where reports go                                                              |
| `TR_EVER_PLATFORM_API_URL`      | `https://api.ever.co`                                | The Ever Platform API                                                           |
| `TR_EVER_STATS_COUNTRY`         | `ZZ`                                                 | Two letters, as the operator declares                                           |
| `TR_EVER_INSTALL_SOURCE`        | `self-hosted`                                        | `cloud`, `self-hosted`, `ever.sh`, `works_app`, `desktop` or `partner:<name>`   |
| `TR_EVER_ADMIN_EMAILS`          | `TR_ADMIN_EMAIL`                                     | The operators (comma-separated e-mails)                                         |
| `TR_EVER_STATS_SEND_INTERVAL_S` | unset (a day)                                        | Tests only; below 3600 only for a local `TR_EVER_STATS_API_URL`                 |

## Verify it yourself

- Leave `TR_EVER_STATS_ENABLED` unset and watch the API's outgoing connections: it makes no DNS query for any Ever host
  and opens no connection to one. Every call the statistics can make is listed in
  [Outbound calls](outbound-calls.md).
- The tests in `api` check that every object of the schema is closed and every string bound, that the vendored schema
  has not drifted from the published one (`api/src/ever-stats/schema/VENDOR.json`), that a report built from an instance
  full of realistic names, e-mail addresses, project names, terms and translations contains none of them, and that the
  signature verifies over the exact bytes sent.
