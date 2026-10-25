---
id: changelog
title: Changelog
sidebar_label: Changelog
---

To download the source code for each release, check out [GitHub](https://github.com/ever-co/ever-traduora/releases). Alternatively docker images are available for each release on [Docker Hub](https://cloud.docker.com/u/everco/repository/docker/everco/ever-traduora).

## next

- TODO

## 0.22.1

### Security

Please upgrade. The advisories are on
[GitHub](https://github.com/ever-co/ever-traduora/security/advisories).

- [PR-571:](https://github.com/ever-co/ever-traduora/pull/571) Since 0.21.0
  the startup seed created the admin account `local.admin@ever.co` with a
  default password published in the README whenever `TR_ADMIN_PASSWORD` was
  not set, so anyone could sign in to it (GHSA-vjr4-28gx-35p8)
- [PR-572:](https://github.com/ever-co/ever-traduora/pull/572) An account
  registered with an email its owner had not verified was added to every
  project that later invited that email (GHSA-gp83-wv43-h962)

### Upgrade notes

- **The default admin account has no default password anymore.** It is
  created only when `TR_ADMIN_PASSWORD` is set. If an instance created it
  with the former default password, that password no longer signs in: the
  first attempt removes it. Set a new one with "Forgot password", or without
  email: try to sign in once, then restart with `TR_ADMIN_PASSWORD` set.
  Anyone could have used that account before the upgrade: change
  `TR_SECRET` to end all sessions and review the members and API clients of
  its projects.
- **Account emails are now verified.** New accounts get a link in their
  welcome email; existing accounts start unverified and can send a new link
  from their account settings. A password reset or a Google sign-in that
  reports the email as verified also verifies it. Inviting an account whose
  email is not verified sends an invitation link instead of adding it
  directly; verifying the email accepts its pending invitations.
- A Google sign-in to an existing account needs Google to report the email
  as verified. If it verifies an account that had not proved its email, it
  removes that account's password and ends its other sessions; a password
  reset also ends other sessions.
- Database migrations add columns to `user` and make its password column
  nullable on PostgreSQL. They run automatically unless
  `TR_DB_AUTOMIGRATE=false`.

### Also

- Google sign-up works on PostgreSQL: the password column had never been
  made nullable there
- The login page shows "Bad credentials" for a wrong password instead of a
  generic error

## 0.22.0

### Security

Please upgrade. The advisories are on
[GitHub](https://github.com/ever-co/ever-traduora/security/advisories).

- [PR-560:](https://github.com/ever-co/ever-traduora/pull/560) A project
  admin could change or delete invitations of another project, e.g. raise a
  pending invite to admin (GHSA-cx96-m99q-j695, thanks @kats1123,
  @lighthousekeeper1212 and @Tike00)
- [PR-562:](https://github.com/ever-co/ever-traduora/pull/562) Auth tokens
  were signed with the publicly known secret `secret` when `TR_SECRET` was
  not set, which let anyone forge them (GHSA-w5wm-pf8g-hmgc, thanks
  @EQSTLab)
- [PR-563:](https://github.com/ever-co/ever-traduora/pull/563) Signing up
  with an invited email accepted the invitation without proof of owning that
  email (GHSA-pfvf-33wh-gwwr, thanks @Tike00)

### Upgrade notes

- `TR_SECRET` is now **required** when `NODE_ENV=production` (the Docker
  image default), and the example values published in this repository are
  refused everywhere. Generate one with `openssl rand -hex 32` and keep it;
  setting it signs everyone out once. Without it, outside production a
  random secret is used per process.
- Invitations are now accepted through the link in the invitation email.
  Admins also get the link when they invite someone, to share it themselves
  if the server cannot send email, and people who already have an account
  open the same link after signing in. Invitations sent before this release
  have no link: invite those people again to send them one (signing in with
  Google still accepts them).
- A new database migration adds a column to `invite`; it runs automatically
  on start unless `TR_DB_AUTOMIGRATE=false`.

### Also in this release

- Node 26.12.1, NestJS 11, Angular 19, TypeORM 0.3 and many dependency
  updates
- Requests for missing resources return 404 again instead of 500
- A failure to send an email no longer stops the API process
- The Docker entrypoint no longer prints environment values, secrets
  included, to the container logs (set `ENV_SECRETS_DEBUG` to trace it)

## 0.19.4

- Multiple packages updates and tiny fixes
- [PR-339:](https://github.com/ever-co/ever-traduora/pull/339) Add fallback locale on export (thanks @kidoncio)
- [PR-340:](https://github.com/ever-co/ever-traduora/pull/340) Add Context on Term (thanks @kidoncio)
- [PR-310:](https://github.com/ever-co/ever-traduora/pull/310) Make the DB type as variable (thanks @azlux)

## 0.19.3

- We fixed all e2e and Unit tests in this release :rocket:
- [PR-296:](https://github.com/ever-co/ever-traduora/pull/296) Fix e2e testing
- [PR-295:](https://github.com/ever-co/ever-traduora/pull/295) More CSV Injection related tests
- [PR-294:](https://github.com/ever-co/ever-traduora/pull/294) and [PR-293:](https://github.com/ever-co/ever-traduora/pull/293) Fix some Unit Tests

## 0.19.2

- [PR-289:](https://github.com/ever-co/ever-traduora/pull/289) CSV Injection Vulnerability Fixes
- some minor packages updates (mostly for security)
- fix CircleCI builds and split e2e and unit tests running

## 0.19.1

- [PR-216:](https://github.com/ever-co/ever-traduora/pull/253) Update Angular / NestJs and other packages to latest

## 0.19.0

- [Commit](https://github.com/ever-co/ever-traduora/commit/7173276f9c049f4a8db7e7bf47fa27667421ab2c) Docker / Docker Compose improvements
- [PR-222:](https://github.com/ever-co/ever-traduora/pull/222) Support for Resource ResX files added (thanks @rai69)
- [PR-202:](https://github.com/ever-co/ever-traduora/pull/202) Add support for Docker Secrets (thanks @ynuyasha)

## 0.18.0

- [PR-216:](https://github.com/ever-co/ever-traduora/pull/216) Update Angular / NestJs and other packages to latest
- [PR-173:](https://github.com/ever-co/ever-traduora/pull/173) Security Fix for Username Enumeration (thanks @JamieSlome / @huntr-helper)

## 0.17.0

- [PR-91:](https://github.com/ever-co/ever-traduora/pull/91) Add support for PHP import/export format.
- [PR-153:](https://github.com/ever-co/ever-traduora/pull/153) Add option to debug emails locally
- [PR-122:](https://github.com/ever-co/ever-traduora/pull/122) Upgraded to Angular 9+.
- [PR-154:](https://github.com/ever-co/ever-traduora/pull/154) Add option to reject self-signed certs from mail server.
- Upgrade Docker images to Node 12.18.
- Upgraded dependencies.
- Minor performance improvements and bug-fixes.

## 0.16.0

- Allow config of max nested levels on import formats (with new default of 100).
- Pretty print JSON based exporters.

## 0.15.1

- Fix parsing of gettext (po) files with message contexts.

## 0.15.0

- [PR-72](https://github.com/ever-co/ever-traduora/pull/72) You can now organize your terms and translations with labels.
- [PR-89:](https://github.com/ever-co/ever-traduora/pull/89) Added translation progress stats per locale.
- [PR-94](https://github.com/ever-co/ever-traduora/pull/94) Fix escaping of special characters on Android Resources.
- Automatically detect file import format.
- Increase max size for file import (1MB).
- Improve error message when importing files which are too large.

## 0.14.0

- Minor bug fixes and UI improvements.
- Changed DB tables collation to support case-sensitive terms.
- [PR-87:](https://github.com/ever-co/ever-traduora/pull/87) We now support the Android Resources (XML) format.

## 0.13.0

- [PR-66:](https://github.com/ever-co/ever-traduora/pull/66) You can now invite non-traduora users into your project with the new invite system.
- Updated API reference docs.

## 0.12.1

- Ensure swagger version is same as in package.json
- expose version in `/health` endpoint

## 0.12.0

- You can now sign-in with Google.
- Fix search component case sensitivity.
- Various dependency upgrades and security fixes.

## 0.11.0

- Add swagger API docs
- Conform auth token endpoint to oauth2 conventions

## 0.10.0

- Support Apple .strings format
- Set default MySQL charset to utf8mb4. You can now use emojis in terms and translations
- Use lexical order for terms on export and find all endpoint

## 0.9.0

- Added support to import and export Gettext (po) files
- Change default encoding for Java properties format to ISO-8859-1
- Add guard against account deletion when is last project admin of project with team
- Upgrade webapp dependencies
- Minor improvements and bug fixes

## 0.8.7

- Initial open source release
