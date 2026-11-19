---
id: connection
title: Ever Platform connection
sidebar_label: Ever Platform connection
---

Traduora can connect to your organization on Ever Platform, so that it appears there as your organization's Traduora and
can take part in the integrations an owner or admin of the organization chooses. The connection is **off by default**:
the module is not loaded, has no route and calls nothing unless the operator sets `TR_EVER_CONNECT_ENABLED=true`. Even
then, nothing is sent before the operator connects with a code.

## Connect

1. On the server, set `TR_EVER_CONNECT_ENABLED=true` and your own `TR_SECRET` (the connection key is stored encrypted
   with a key derived from it), then restart.
2. In app.ever.co, an owner or admin of your organization creates a connect code (`EVC-XXXX-XXXX-XXXX`).
3. In Traduora, the operator (a user with a confirmed e-mail listed in `TR_EVER_ADMIN_EMAILS`, default
   `TR_ADMIN_EMAIL`) opens **Ever Platform** in the account menu, pastes the code, optionally changes the name the
   organization will see, and presses **Connect**.

Traduora then makes its own connection key (Ed25519; the private half never leaves the server and is stored encrypted)
and redeems the code once. The redeem carries the product (`traduora`), its version, the install source the operator
declared (`TR_EVER_INSTALL_SOURCE`, default `self-hosted`), the public key and the name; no address, no user and no
project data. The whole installation is linked to the organization (one link for the installation). A code can also be
given in `TR_EVER_CONNECT_CODE`: it is redeemed once at start, and never tried again once it was accepted or refused.

## While connected

- A **heartbeat** within 5 minutes of connecting, then once a day: the version, the module version and the integrations
  the operator denies with `TR_EVER_CONNECT_INTEGRATIONS_DENY`.
- The **entitlement documents** of the installation and its link, every 6 hours. Each is verified with the Ever Platform
  SDK (signature, issuer, audience, this installation, sequence) before it is stored; the page shows the plan and its
  state (valid, then stale within its grace period, then paused). Nothing in Traduora's projects, terms, translations,
  imports or exports depends on it.
- The **event feed** (a long poll, or one read every 15 minutes with `TR_EVER_CONNECT_FEED_MODE=interval`): when an owner
  or admin changes a consent, the plan or the link in app.ever.co, Traduora reads the new state.

Several API processes on one database count as one installation: one of them makes these calls at a time.

## Integrations

| Integration | What it does | What it moves |
| --- | --- | --- |
| `instance_url` | Shows the address of this installation to your organization | The `https` address the operator sends, after the consent |
| `stats_link` | Links the anonymous usage statistics of this installation to your organization | The statistics instance id and public key, with a statement signed by the statistics key (never by the connection key); only when the statistics are on |
| `managed_operations` | Maintenance operations requested from app.ever.co (see [Maintenance operations](#maintenance-operations)) | The status, version and size of each operation; only with the operator's opt-in |
| `ever_id_login` | Sign in with Ever ID through Ever Platform | Not available yet as a sign-in option. Once an organization consents to it, the person links of this installation (see [A person's Ever ID](#a-persons-ever-id)) |

**Show scope** on the page lists, for each integration, every field it moves, in which form, how often and why: the same
list app.ever.co shows on its consent screen. An integration starts only after an owner or admin of your organization
consents in app.ever.co (**Enable in app.ever.co** opens it); one that acts for the whole installation then waits for the
operator's **Accept**. The operator can **Switch off** any integration at any time; when Ever Platform cannot be reached,
it is off here at once and Ever Platform is told with the next heartbeat. `TR_EVER_CONNECT_INTEGRATIONS_DENY` (a comma
list of keys) keeps integrations off whatever app.ever.co says.

## A person's Ever ID

People who sign in to Traduora with their Ever ID can ask app.ever.co to export or delete what Ever and the products they
use hold about them. While the installation is connected, Traduora answers these requests for the accounts their Ever ID
is linked to. A request names the person by a hash of each Ever ID (issuer and subject): Traduora finds the accounts by
that hash only, never by an e-mail address, and never creates or changes an account for a request.

- **Person links.** When a user signed in with their Ever ID (and so linked it to their account themselves, from the
  account settings or by confirming a new account), Traduora tells Ever Platform about the link: the user's id, the
  issuer and subject of the Ever ID, how it was linked, and the installation's link with the organization. No e-mail
  address and no name. Only Ever IDs are reported (an identity that names an Ever person id); identities of another
  OpenID Connect issuer are not. Links are reported only while an owner or admin of the organization consented to
  `ever_id_login` in app.ever.co and `TR_EVER_CONNECT_INTEGRATIONS_DENY` does not name it; within 5 minutes of a new
  link, or of the consent. When a user removes their Ever ID here, the link is removed there too.
- **Export.** Traduora makes one export per matched account: its profile (name, e-mail, when it was made and last
  signed in), its Ever ID, its projects with the user's role, and how many translation changes it made. The export is
  stored encrypted with a key derived from `TR_SECRET`, and only that account can download it, for 7 days:
  `GET /api/v1/ever-connect/me/exports` lists them and `GET /api/v1/ever-connect/me/exports/<id>` returns one, as JSON,
  to the signed-in user. Ever Platform receives the answer `exported` (or `no_account`), never the export.
- **Deletion.** Traduora removes the person's Ever ID from the accounts it is linked to and ends the sessions opened with
  it. The accounts themselves stay, with their projects, passwords and other sign-in methods: the person can still sign
  in with a password (or reset it) and delete the account in Traduora. Ever Platform receives the answer `anonymised`
  (or `no_account`), and the person link is removed.

Each answer is decided once and kept for 90 days with the request id (no e-mail, no name), so a request read again gets
the same answer; the audit trail records each one with the number of accounts it matched.

## Maintenance operations

An owner or admin of the organization can ask this installation, from app.ever.co, for a health report, a backup or a
check of a backup. Nothing runs unless **both** agree: the organization enabled `managed_operations` in app.ever.co,
**and** the operator opted in here, for that kind, with a window it may run in. Otherwise the request is answered
`failed` and nothing else happens. `TR_EVER_CONNECT_INTEGRATIONS_DENY=managed_operations` refuses every request. An
installation declared `TR_EVER_INSTALL_SOURCE=cloud` is operated by Ever and takes none.

| Kind | What runs here | Databases |
| --- | --- | --- |
| `health_report` | Checks that the API answers and its database is reachable | All |
| `backup` | An online backup of the database (a consistent copy while Traduora keeps running) and a manifest with its size and SHA-256, written to the operator's backup directory | SQLite |
| `restore_check` | Checks that a backup in the directory still matches its manifest | SQLite |

PostgreSQL and MySQL backups need their own dump tools, which the Traduora image does not ship: back these databases
up with your usual tools. Such a request is answered `failed` (`unsupported_dialect` in the history). `update` is never
run: the API cannot replace its own container image, so update the container yourself.

The operator sets it all with `PUT /api/v1/ever-connect/managed` and reads it with `GET` (operator only):

```json
{
  "optIn": true,
  "kinds": ["health_report", "backup", "restore_check"],
  "windows": [{ "days": [0, 6], "from": "02:00", "to": "04:00" }],
  "backupDir": "/app/api/backups"
}
```

Windows are in UTC (days 0 = Sunday to 6; a `to` earlier than `from` runs overnight). The backup directory is an
absolute path on the server, for example a mounted volume. It is stored encrypted and never shown again (only whether
one is set). A request with a later start time waits until then. Ever Platform receives the status, the version and the
size of a backup only, never a path or a file name. The history of the last 50 operations and every opt-in change are
kept here and in the audit trail.

## Disconnect

**Disconnect** tells Ever Platform the installation leaves your organization, then deletes the connection key, the
entitlement documents, the integration states and the person links here. When Ever Platform cannot be reached, the connection ends here
anyway. The anonymous usage statistics are not affected. If Ever Platform revokes the installation, Traduora stops every
call and the page asks for a new code.

## Audit

Every change (connect, consent states, switches, addresses, disconnect) is recorded with the time, what changed and who
did it: a user id, `env`, `platform` or `system`, never an e-mail address. The last 500 changes are kept; each row carries
the SHA-256 of the previous one, so a row edited or removed between two kept rows shows. The chain alone cannot show that
the newest rows were removed. The page lists the latest changes.

## All settings

| Variable | Default | Meaning |
| --- | --- | --- |
| `TR_EVER_CONNECT_ENABLED` | off | `true` loads the connection module |
| `TR_EVER_CONNECT_CODE` | unset | A connect code redeemed once at start |
| `TR_EVER_CONNECT_INTEGRATIONS_DENY` | unset | Integration keys kept off on this installation |
| `TR_EVER_CONNECT_FEED_MODE` | `longpoll` | `interval` reads the event feed every 15 minutes instead |
| `TR_EVER_PLATFORM_API_URL` | `https://api.ever.co` | The Ever Platform API |
| `TR_EVER_INSTALL_SOURCE` | `self-hosted` | How this installation was set up, as the operator declares it |
| `TR_EVER_ADMIN_EMAILS` | `TR_ADMIN_EMAIL` | The operators (comma-separated e-mails) |

Every call the connection can make is listed in [Outbound calls](outbound-calls.md).
