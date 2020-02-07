---
id: configuration
title: Configuration
sidebar_label: Configuration
---

The API server can be configured via the following environment variables:

| Environment variable | Description | Default value |
|-----------------|-------------|---------|
| NODE_ENV | The node runtime environment | dev |
| TR_PORT | The port on which the server will listen on | 8080 |
| TR_SECRET | The application secret, used i.e. for signing and verifying the auth tokens, it is **strongly** recommended that you do not use the default one | secret |
| TR_VIRTUAL_HOST | The virtual host tells the server under which domain you are hosting the webapp, used i.e. to correctly format URLs and links in emails | http://localhost:8080 |
| TR_DB_HOST | The MySQL DB host | 127.0.0.1 |
| TR_DB_PORT | The MySQL DB port | 3306 |
| TR_DB_DATABASE | The MySQL database name to connect to | tr_dev |
| TR_DB_USER | The MySQL user to connect with | root |
| TR_DB_PASSWORD | The MySQL password to connect with | (empty) |
| TR_PUBLIC_DIR | The path at which the public server files are located | ./public |
| TR_TEMPLATES_DIR | The path at which the server templates are located | ./templates |
| TR_CORS_ENABLED | If enabled, the server will allow CORS requests | false |
| TR_ACCESS_LOGS_ENABLED | If enabled, the server will log all requests to STDOUT | true |
| TR_AUTH_TOKEN_EXPIRES | The duration in seconds that the issued JWT tokens will be valid for | 86400 |
| TR_SIGNUPS_ENABLED | If enabled, users can sign in for | true |
| TR_MAX_PROJECTS_PER_USER | The max number of projects that can be created per user | 100 |
| TR_DEFAULT_PROJECT_PLAN | The default project plan, by default set to *open-source* and is limited to 100,000 strings (you are free to change it) | open-source |
| TR_DB_AUTOMIGRATE | If enabled, on startup the server will ensure that all DB migrations have been applied | true |
| TR_MAIL_DEBUG | If enabled, it log a preview email link | false |
| TR_MAIL_SENDER | The mail sender | not set |
| TR_MAIL_HOST | The mail server host | not set |
| TR_MAIL_PORT | The mail server port | 587 |
| TR_MAIL_SECURE | If enabled, attempt to send mail securely | false |
| TR_MAIL_USER | The auth user for the mail server | not set |
| TR_MAIL_PASSWORD | The auth password for the mail server | not set |
| TR_IMPORT_MAX_NESTED_LEVELS | Max number of nested levels in terms allowed for import formats | 100 |
| TR_AUTH_GOOGLE_ENABLED | Set to 'true' if you'd like to enable sign-in with Google | not set |
| TR_AUTH_GOOGLE_CLIENT_ID | Your Google OAuth client ID | not set |
| TR_AUTH_GOOGLE_CLIENT_SECRET | Your Google OAuth client secret | not set |
| TR_AUTH_GOOGLE_REDIRECT_URL | The redirect url, should be 'https://$YOUR_TRADUORA_HOST/auth/callback' and also be set in the allowed redirect URI's in the Google API console when you created the OAuth integration | not set |
