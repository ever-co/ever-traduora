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
| `ever_id_login` | Sign in with Ever ID through Ever Platform | Not available yet |

**Show scope** on the page lists, for each integration, every field it moves, in which form, how often and why: the same
list app.ever.co shows on its consent screen. An integration starts only after an owner or admin of your organization
consents in app.ever.co (**Enable in app.ever.co** opens it); one that acts for the whole installation then waits for the
operator's **Accept**. The operator can **Switch off** any integration at any time; when Ever Platform cannot be reached,
it is off here at once and Ever Platform is told with the next heartbeat. `TR_EVER_CONNECT_INTEGRATIONS_DENY` (a comma
list of keys) keeps integrations off whatever app.ever.co says.

## Disconnect

**Disconnect** tells Ever Platform the installation leaves your organization, then deletes the connection key, the
entitlement documents and the integration states here. When Ever Platform cannot be reached, the connection ends here
anyway. The anonymous usage statistics are not affected. If Ever Platform revokes the installation, Traduora stops every
call and the page asks for a new code.

## Audit

Every change (connect, consent states, switches, addresses, disconnect) is recorded with the time, what changed and who
did it: a user id, `env`, `platform` or `system`, never an e-mail address. Each row carries the SHA-256 of the previous
one, so a removed or edited row shows. The page lists the latest changes.

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
