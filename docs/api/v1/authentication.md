---
id: authentication
title: Authentication
sidebar_label: Authentication
---

Most endpoints require an authenticated user or an API client. Since the bearer token is included in each request on an authentication header, it is important to only serve requests over a secure connection. It is recommended to put the traduora server behind a reverse proxy / load balancer that does the TLS termination.

There are two types of authentication: `client_credentials` (for project clients) and `password` (for users).

A user must already exist for the `password` grant type, and a project client must exist and not be revoked for the `client_credentials` grant type.

## Authentication Token

Once you have obtained your authentication token, you should include it on each subsequent request in the `Authorization` header:

```
Authorization: Bearer <token>
```
