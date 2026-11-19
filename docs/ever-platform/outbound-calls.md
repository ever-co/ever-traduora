---
id: outbound-calls
title: Outbound calls
sidebar_label: Outbound calls
---

Every call the optional Ever Platform features of Traduora can make, with what it carries and what switches it off. With
`TR_EVER_STATS_ENABLED` unset (the default) the API makes none of them.

| #   | Call                              | Endpoint                                                                                            | When                                                                                                                                                                       | Carries                                                                                                                                                                       | Authentication                                                                          | Switched off by                                                                  |
| --- | --------------------------------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| 17  | Anonymous usage statistics report | `POST <TR_EVER_STATS_API_URL>/v1/stats/reports` (default `https://api.ever.co`)                     | Statistics module loaded (`TR_EVER_STATS_ENABLED=true`) and switched on; once a day at a random time; 10 minutes after a start when the last send is older than a day; the previous month once more on days 1-3 | The `ever.stats.v1` document: statistics instance id, product, version, channel, install source, declared country, month, allow-listed counts, two settings and one monthly count | None: the body is signed with the statistics key carried in the signature headers | `TR_EVER_STATS_ENABLED` unset or `false`, or _Turn off_ on the Statistics page |

The row number is the one of the Ever Platform SDK's list of calls (`ever-co/ever-connect-sdk`, contract version
1.0.0-rc.8). There is no other call: Traduora has no other telemetry. See
[Anonymous usage statistics](anonymous-usage-statistics.md) for the report, the schedule and the answers.

## Inbound routes

The statistics module adds these routes to the API; the list is `api/src/ever-stats/ever-stats.routes.json`. While the
module is not loaded none of them exists.

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
