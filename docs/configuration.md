---
id: configuration
title: Configuration
sidebar_label: Configuration
---

The API server can be configured via the following environment variables:

| Environment variable | Description | Default value |
|-----------------|-------------|---------|
| NODE_ENV | the node runtime environment | dev |
| TR_PORT | the port on which the server will listen on | 8080 |
| TR_SECRET | the application secret, used i.e. for signing and verifying JWT, it is **strongly** recommended that you do not use the default one | secret |
| TR_VIRTUAL_HOST | the virtual host tells the server under which domain you are hosting the webapp, used i.e. to correctly format URLs and links in emails | http://localhost:8080 |
| TR_DB_HOST | the MySQL DB host | 127.0.0.1 |
| TR_DB_PORT | the MySQL DB port | 3306 |
| TR_DB_DATABASE | the MySQL database name to connect to | tr_dev |
| TR_DB_USER | the MySQL user to connect with | root |
| TR_DB_PASSWORD | the MySQL password to connect with | (empty) |
| TR_PUBLIC_DIR | the path at which the public server files are located | ./public |
| TR_TEMPLATES_DIR | the path at which the server templates are located | ./templates |
| TR_CORS_ENABLED | if enabled, the server will allow CORS requests | false |
| TR_ACCESS_LOGS_ENABLED | if enabled, the server will log all requests to STDOUT | true |
| TR_AUTH_TOKEN_EXPIRES | the duration in seconds that the issued JWT tokens will be valid for | 86400 |
| TR_SIGNUPS_ENABLED | if enabled, users can sign in for | true |
| TR_MAX_PROJECTS_PER_USER | the max number of projects that can be created per user | 100 |
| TR_DEFAULT_PROJECT_PLAN | the default project plan, by default set to *open-source* and is limited to 100,000 strings (you are free to change it) | open-source |
| TR_DB_AUTOMIGRATE | if enabled, on startup the server will ensure that all DB migrations have been applied | true |
| TR_MAIL_DEBUG | if enabled, and default mail settings are untouched it will log the preview email link instead of sending it to the actual recipient | false |
| TR_MAIL_SENDER | the mail sender | no-reply@localhost.com |
| TR_MAIL_HOST | the mail server host | smtp.ethereal.email |
| TR_MAIL_PORT | the mail server port | 587 |
| TR_MAIL_SECURE | if enabled, attempt to send mail securely | false |
| TR_MAIL_USER | the auth user for the mail server | l4kzu3nw7o4x45wz@ethereal.email |
| TR_MAIL_PASSWORD | the auth password for the mail server | 3mJgh1g9dpMf3uZaBM |
