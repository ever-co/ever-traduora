---
id: outbound-calls
title: Outbound calls
sidebar_label: Outbound calls
---

Every call the optional Ever Platform features of Traduora can make, with what it carries and what switches it off. With
`TR_EVER_STATS_ENABLED=false` and `TR_EVER_CONNECT_ENABLED` unset (its default) the API makes none of them. The
anonymous usage statistics (row 17) are on by default; the connection calls are off by default.

| #   | Call                              | Endpoint                                                                                            | When                                                                                                                                                                       | Carries                                                                                                                                                                       | Authentication                                                                          | Switched off by                                                                  |
| --- | --------------------------------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| 17  | Anonymous usage statistics report | `POST <TR_EVER_STATS_API_URL>/v1/stats/reports` (default `https://api.ever.co`)                     | Statistics module loaded (unless `TR_EVER_STATS_ENABLED=false`) and switched on; once a day at a random time; 10 minutes after a start when the last send is older than a day; the previous month once more on days 1-3 | The `ever.stats.v1` document: statistics instance id, product, version, channel, install source, declared country, month, allow-listed counts, two settings and one monthly count | None: the body is signed with the statistics key carried in the signature headers | `TR_EVER_STATS_ENABLED=false`, or _Turn off_ on the Statistics page |

## Connection calls

Only with `TR_EVER_CONNECT_ENABLED=true`. The first call is the redeem, when the operator presses *Connect* (or once at
start for `TR_EVER_CONNECT_CODE`); every other call happens only after a successful redeem. Each goes to
`TR_EVER_PLATFORM_API_URL` (default `https://api.ever.co`) through the Ever Platform SDK client: one origin, no redirect
followed, no cookie. The redeem is authenticated by the connect code, the token request by a client assertion signed with
the connection key, and every other call by the short-lived token it returns. Disconnecting, or Ever Platform revoking the
installation, stops all of them.

| Call | Endpoint | When | Carries |
| --- | --- | --- | --- |
| Redeem a connect code | `POST /v1/connect/redeem` | The operator presses *Connect* (or `TR_EVER_CONNECT_CODE` at start, once) | The code, `traduora`, its version, the declared install source, the public connection key, the name shown to the organization |
| Instance token | `POST /v1/instances/token` | Before the other calls, about once an hour | A client assertion signed by the connection key |
| Key manifest | `GET /.well-known/ever-keys.json` | When the entitlement documents are verified | Nothing |
| Heartbeat | `POST /v1/instances/me/heartbeat` | Within 5 minutes of connecting, then daily | Version, module version, served product, the integrations denied by `TR_EVER_CONNECT_INTEGRATIONS_DENY` |
| Entitlement documents | `GET /v1/instances/me/entitlement`, `GET /v1/instances/me/tenant-links/{link}/entitlement` | Every 6 hours, and after a feed event about them | Nothing (the last sequence number) |
| Event feed | `GET /v1/instances/me/events`, `POST /v1/instances/me/events/ack` | Continuously (long poll) or every 15 minutes | The feed position |
| Installation and link state | `GET /v1/instances/me` | After a feed event about the link | Nothing |
| Integration states | `GET /v1/instances/me/integrations` | After connecting, a consent event, or *Check again* | Nothing |
| Consent link | `GET /v1/instances/me/consent-url` | The operator presses *Enable in app.ever.co* | The integration key |
| Accept or switch off an integration | `POST /v1/instances/me/integrations/{key}/accept`, `PUT /v1/instances/me/integrations/{key}` | The operator presses *Accept*, *Decline* or *Switch off* | The integration key, the consent id, the answer |
| Installation address | `PUT` / `DELETE /v1/instances/me/public-url` | The operator sends or removes it, after the `instance_url` consent | The `https` address |
| Statistics link | `POST /v1/instances/me/stats-link` | Once, when `stats_link` starts (statistics on) | The statistics instance id and public key, a statement signed by the statistics key |
| Person link | `POST /v1/instances/me/person-links`, `DELETE /v1/instances/me/person-links/{user}` | Within 5 minutes of a user linking (or removing) their Ever ID, while an organization consented to `ever_id_login` | The Traduora user id, the Ever ID issuer and subject, `explicit` or `confirmed`, the installation's tenant (`*`), link and name; no e-mail, no name of a person |
| Maintenance operation result | `POST /v1/instances/me/managed-operations/{operation}/result` | After a requested operation ran or was refused | `succeeded` or `failed`, the version, and a backup's opaque reference and size; never a path or a file name |
| Answer to a person's request | `POST /v1/instances/me/ack` | After a deletion or export request from the event feed | The request id, the answer (`anonymised`, `exported` or `no_account`) and a reason code; never the export |
| Disconnect | `POST /v1/instances/me/disconnect` | The operator presses *Disconnect* | Nothing |

The row numbers of the first table are those of the Ever Platform SDK's list of calls (`ever-co/ever-connect-sdk`, contract version
1.0.0-rc.8). There is no other call: Traduora has no other telemetry. Every pull request proves it at run time: the
egress audit (`tools/egress-audit/`) runs the image with every network sealed and fails on any DNS question for an Ever
host or any connection out when the modules are off or switched off, and on any call outside these rows when they are
on. See
[Anonymous usage statistics](anonymous-usage-statistics.md) for the report, the schedule and the answers.

## Inbound routes

The statistics module adds these routes to the API; the list is `api/src/ever-stats/ever-stats.routes.json`. The
connection module adds `/api/v1/ever-connect/*` (`health` public, `me/exports` for each signed-in user's own exports,
`managed` and every other route for the operator only; the list is `api/src/ever-connect/ever-connect.routes.json`), and either module adds `GET /api/v1/ever-platform/status` (operator
only), which the web app reads to show its menu entry. While a module is not loaded none of its routes exists.

| Route                                                                                                                                                                  | Who may call it                                                                                                        |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/ever-stats/health`                                                                                                                                        | Anyone                                                                                                                 |
| `GET /api/v1/ever-stats/status`, `POST /api/v1/ever-stats/preview`, `GET /api/v1/ever-stats/reports`, `POST /api/v1/ever-stats/send`, `PUT /api/v1/ever-stats/enabled`, `POST /api/v1/ever-stats/reset-identity` | The operator of the installation (`TR_EVER_ADMIN_EMAILS`, default `TR_ADMIN_EMAIL`); "not found" for anyone else |

The web app asks `status` once after sign-in to decide whether to show the _Ever Platform_ menu entry, and calls the
other routes only from that page.

## Operator opt-ins

Features older than the Ever Platform settings that can reach an Ever host are off in the default configuration and are
turned on by the operator:

| Feature                                          | Host                                  | Turned on by                                                       |
| ------------------------------------------------ | ------------------------------------- | ------------------------------------------------------------------ |
| Sign in with Ever ID (or another OpenID Connect issuer) | the issuer in `TR_AUTH_EVERID_ISSUER` | `TR_AUTH_EVERID_ENABLED=true` (see [Configuration](../configuration.md)) |

The web app links to `https://traduora.co` (for example from the demo banner); a link is followed only when someone
clicks it.
