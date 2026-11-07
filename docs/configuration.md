---
id: configuration
title: Configuration
sidebar_label: Configuration
---

The API server can be configured via the following environment variables:

| Environment variable         | Description                                                                                                                                                                            | Default value         |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| NODE_ENV                     | The node runtime environment                                                                                                                                                           | dev                   |
| TR_PORT                      | The port on which the server will listen on                                                                                                                                            | 8080                  |
| TR_SECRET                    | The application secret, used i.e. for signing and verifying the auth tokens. **Required** when `NODE_ENV=production`; generate it with `openssl rand -hex 32`. When unset outside production, a random secret is used per process, so sign-ins do not survive a restart | (random per process)  |
| TR_VIRTUAL_HOST              | The virtual host tells the server under which domain you are hosting the webapp, used i.e. to correctly format URLs and links in emails                                                | http://localhost:8080 |
| TR_DB_TYPE                   | The type of database to use                                                                                                                                                            | mysql                 |
| TR_DB_HOST                   | The DB host                                                                                                                                                                            | 127.0.0.1             |
| TR_DB_PORT                   | The DB port                                                                                                                                                                            | 3306                  |
| TR_DB_DATABASE               | The database name to connect to                                                                                                                                                        | tr_dev                |
| TR_DB_USER                   | The user to connect with                                                                                                                                                               | root                  |
| TR_DB_PASSWORD               | The password to connect with                                                                                                                                                           | (empty)               |
| TR_PUBLIC_DIR                | The path at which the public server files are located                                                                                                                                  | ./public              |
| TR_TEMPLATES_DIR             | The path at which the server templates are located                                                                                                                                     | ./templates           |
| TR_CORS_ENABLED              | If enabled, the server will allow CORS requests                                                                                                                                        | false                 |
| TR_ACCESS_LOGS_ENABLED       | If enabled, the server will log all requests to STDOUT                                                                                                                                 | true                  |
| TR_AUTH_TOKEN_EXPIRES        | The duration in seconds that the issued JWT tokens will be valid for                                                                                                                   | 86400                 |
| TR_SIGNUPS_ENABLED           | If enabled, users can sign in for                                                                                                                                                      | true                  |
| TR_MAX_PROJECTS_PER_USER     | The max number of projects that can be created per user                                                                                                                                | 100                   |
| TR_DEFAULT_PROJECT_PLAN      | The default project plan, by default set to _open-source_ and is limited to 100,000 strings (you are free to change it)                                                                | open-source           |
| TR_DB_AUTOMIGRATE            | If enabled, on startup the server will ensure that all DB migrations have been applied                                                                                                 | true                  |
| TR_MAIL_DEBUG                | If enabled, it log a preview email link                                                                                                                                                | false                 |
| TR_MAIL_SENDER               | The mail sender                                                                                                                                                                        | not set               |
| TR_MAIL_HOST                 | The mail server host                                                                                                                                                                   | not set               |
| TR_MAIL_PORT                 | The mail server port                                                                                                                                                                   | 587                   |
| TR_MAIL_SECURE               | If enabled, attempt to send mail securely                                                                                                                                              | false                 |
| TR_MAIL_REJECT_SELF_SIGNED   | If enabled, reject self-signed or invalid certificates from the mail server                                                                                                            | true                  |
| TR_MAIL_USER                 | The auth user for the mail server                                                                                                                                                      | not set               |
| TR_MAIL_PASSWORD             | The auth password for the mail server                                                                                                                                                  | not set               |
| TR_IMPORT_MAX_NESTED_LEVELS  | Max number of nested levels in terms allowed for import formats                                                                                                                        | 100                   |
| TR_AUTH_GOOGLE_ENABLED       | Set to 'true' if you'd like to enable sign-in with Google                                                                                                                              | not set               |
| TR_AUTH_GOOGLE_CLIENT_ID     | Your Google OAuth client ID                                                                                                                                                            | not set               |
| TR_AUTH_GOOGLE_CLIENT_SECRET | Your Google OAuth client secret                                                                                                                                                        | not set               |
| TR_AUTH_GOOGLE_REDIRECT_URL  | The redirect url, should be 'https://$YOUR_TRADUORA_HOST/auth/callback' and also be set in the allowed redirect URI's in the Google API console when you created the OAuth integration | not set               |
| TR_AUTH_EVERID_ENABLED       | Set to 'true' to enable sign-in with Ever ID (or any other OpenID Connect issuer). Anything else keeps it off: no button, its routes answer 400 and nothing is requested from the issuer | false                 |
| TR_AUTH_EVERID_ISSUER        | The OpenID Connect issuer URL, exactly as the issuer names itself, e.g. `https://idp.example.com`. It must use https. Its discovery document is read once at startup; if that fails, the provider stays off                   | not set               |
| TR_AUTH_EVERID_CLIENT_ID     | The client ID registered at the issuer                                                                                                                                                 | not set               |
| TR_AUTH_EVERID_CLIENT_SECRET | The client secret registered at the issuer. Used only by the API to exchange sign-in codes; never sent to the browser                                                                  | not set               |
| TR_AUTH_EVERID_REDIRECT_URL  | The redirect URL, should be 'https://$YOUR_TRADUORA_HOST/auth/callback' and be registered at the issuer                                                                                | not set               |
| TR_AUTH_EVERID_ALLOWED_ISSUERS | Optional comma-separated list of up to two more issuers whose tokens sign in to accounts already connected to them                                                                     | not set               |
| TR_AUTH_EVERID_PLATFORM_PROJECT_ID | The Ever Platform project ID: with Ever ID, adds its organization and audience scopes to the sign-in request. Leave empty for other OpenID Connect issuers, which then get the standard scopes only                                                             | not set               |
| TR_AUTH_EVERID_BACKCHANNEL_LOGOUT_ENABLED | Accept OpenID Connect back-channel logout at 'https://$YOUR_TRADUORA_HOST/api/v1/auth/everid/backchannel-logout' (register it at the issuer)                                           | true                  |

## Sign in with Ever ID (optional)

Traduora can offer "Continue with Ever ID" next to email and password and Google. It works with Ever ID and with any other OpenID Connect issuer, and is off by default. To turn it on:

1. Register a web application at the issuer, with the authorization code flow and PKCE, the redirect URL `https://$YOUR_TRADUORA_HOST/auth/callback` and, for back-channel logout, `https://$YOUR_TRADUORA_HOST/api/v1/auth/everid/backchannel-logout`. Traduora authenticates to the token endpoint with HTTP Basic (`client_secret_basic`), or with `client_secret_post` when the issuer supports only that.
2. Set `TR_AUTH_EVERID_ENABLED=true`, `TR_AUTH_EVERID_ISSUER`, `TR_AUTH_EVERID_CLIENT_ID`, `TR_AUTH_EVERID_CLIENT_SECRET` and `TR_AUTH_EVERID_REDIRECT_URL`, then restart.

How accounts are matched:

- Traduora keeps issuing its own access tokens; the issuer only proves who signs in. ID tokens are verified with the issuer's published keys, and the request uses `state`, `nonce` and PKCE.
- A person is recognized by the issuer and subject of their ID token, never by email. When an account already has the same email, the sign-in stops with "An account with this email already exists. Sign in the usual way, then connect Ever ID in your account settings." The owner of that account connects Ever ID from **Account Settings > Connected sign-in methods**, after signing in to Ever ID again.
- A new person gets the "Create your Traduora account" screen first: nothing is created before they confirm. `TR_SIGNUPS_ENABLED` applies as for any sign-up: when it is `false`, only a person with a pending invitation can create an account, and each invitation is accepted only if they tick it.
- Access tokens of an Ever ID sign-in end when the issuer ends that session (back-channel logout). Other access tokens are not affected.
- An issuer on an Ever host (`ever.co`) is used only by the Ever-operated Traduora cloud (`TR_EVER_INSTALL_SOURCE=cloud`). Other installs can use any other OpenID Connect issuer.

Outbound requests: the configured issuer is the only new destination, and only while `TR_AUTH_EVERID_ENABLED=true`: its discovery document at startup, its key set, and the code exchange when someone signs in. No Ever ID token is stored.
