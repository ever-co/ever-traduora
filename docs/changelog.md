---
id: changelog
title: Changelog
sidebar_label: Changelog
---

To download the source code for each release, check out [GitHub](https://github.com/ever-co/ever-traduora/releases). Alternatively docker images are available for each release on [Docker Hub](https://cloud.docker.com/u/everco/repository/docker/everco/ever-traduora).

## next

- XLIFF 1.2 import reads the units inside a `<group>` without an `id`, which XLIFF 1.2 allows. Before, a `<group>` with no attributes got the whole file refused as malformed, and of several groups with attributes but no `id` (`<group resname="g1">`, `<group resname="g2">`) only the units of the last one were imported, though the import reported success. Of several `<file>` elements with the same `original`, all units are imported now, not only those of the last one. A space between two placeholders or two `<mrk>` (`<x id="1" equiv-text="{a}"/> <x id="2" equiv-text="{b}"/>`) is kept: before, the stored translation was `{a}{b}`. A `<trans-unit>` without an `id` gets the file refused as malformed instead of being imported as a term named `undefined`

- When an export fails because the format cannot hold some terms (a term that is also the parent of other terms in `jsonnested`, `yamlnested` or `php`, or a term starting with `@` in `arb`), the API answers 400 with a message that names those terms instead of "Your request seems to be invalid or malformed", and the webapp shows that message instead of a general hint, so the term to rename can be found in a large project

- Security: sign-ins sent at the same time no longer get past the lockout after
  failed sign-ins (`TR_LOGIN_ATTEMPTS_MAX`, 3 by default). Each sign-in read the
  count before any failure was stored, so a burst of wrong passwords for one
  account was checked in full: with the default limit of 100 sign-ins per minute
  per IP, about 100 guesses a minute instead of the 3 that lock the account. Now
  each sign-in counts before its password is checked, and those beyond the
  maximum get 429. Without Redis, a refused sign-in no longer adds to the stored
  count, which stops at the maximum. With Redis, the count is no longer extended
  by each attempt: it ends `TR_LOGIN_ATTEMPTS_TTL` (15 minutes by default) after
  it started, at the first sign-in it counted or at the last successful one

- The emails show names, project names and email addresses as typed. They are plain text, but were written with HTML escaping, so a user named `O'Neil` got `Hi O&#x27;Neil,` and an invitation to the project `R&D` named it `R&amp;D`. The links in the emails do not change

- XLIFF 1.2 import no longer refuses the whole file as malformed when a unit has no `<target>` in a file with `target-language` (such units are skipped now, the others are imported), when a value is a single placeholder (`<target><x id="INTERPOLATION" equiv-text="{{ n }}"/></target>`), or when units sit inside `<group>`. It also keeps the text of every placeholder that has an `equiv-text` (`INTERPOLATION_1` and the others, not only `INTERPOLATION`) and the text inside `<g>`, `<mrk>` and `<ph>`. Before, that text was left out and the stored translation was overwritten with words and placeholders missing

- The translations, API keys and team pages show the error when a save fails. Before, a translation the API refused (a value over 8192 characters, or a term a teammate had just deleted) kept the new text on screen with no message and was gone after a reload, and a failed role change or revoke of an API key or an invitation showed nothing. The team page now also clears its errors when you leave it, so they no longer show up later on the API keys page

- Security: CSV export removes all the `=`, `+`, `-`, `@`, tab and carriage return characters at the start of a term or translation, not only the first one, so a doubled trigger such as `==1+1` or `+=cmd|' /C calc'!A0` no longer reaches the file as a formula. Values that start with a digit, `/`, `\`, `,`, `;` or `|` are exported unchanged: before, their first character was cut off (`404.title` became `04.title` and `/help` became `help`), so importing the file again created the wrong terms. A value with a carriage return inside is now quoted: unquoted, a spreadsheet started a new row there, so `hello\r=1+1` still gave a cell with a live formula

- Java properties (`.properties`) import keeps every value as the text in the file. Before, `0`, `false`, `null` and `undefined` were imported as empty translations, and numbers were rewritten: `1.10` became `1.1`, `007` became `7`, `+33` became `33` and `0x1F` became `31`. A term whose value was a number or `true` also got a new history entry each time the same file was imported again

- Export in `php` answers 400 instead of 500 when a term is also the parent of other terms (`app` and `app.title`), as `jsonnested` and `yamlnested` do, and the webapp says so instead of asking to try again

- Without Redis, failed sign-ins count from zero again once 15 minutes have passed since the last one. Before, the stored count kept growing until a successful sign-in, so a single typo days later could reach the maximum (`TR_LOGIN_ATTEMPTS_MAX`, 3 by default) and lock the account for 15 minutes, even with the right password

- RESX export no longer puts a backslash before `'`, `"`, `?` and `@` (that is Android string escaping; .NET shows the backslashes as text). RESX import keeps double quotes instead of dropping them, reads `<value>` even when `<comment>` comes first, and imports an empty `<value />` as an empty translation instead of rejecting the whole file as malformed. A RESX file exported by an earlier version still has those backslashes, and import now keeps them as text: before you import such a file, remove the backslash from `\'`, `\"`, `\?` and `\@`, or export the file again from this version

- The password reset email links to the reset page again: the link kept one slash after `https:` (`https:/host/reset-password`), so mail clients did not open it, and it did not encode the email, so an address with a `+` (`jane+tr@example.com`) reached the reset page with a space instead and could not be reset

- The locale and label pickers (export, import, new locale, reference locale, assign label) work with a keyboard: each result is a button that Tab reaches and Enter or Space chooses, and screen readers announce which one is selected. Their search boxes have a label
- On Export, screen readers tell the two locale pickers apart: each search box is named by its own visible label, each list of locales has its own name, and the two inputs no longer share an id. The decorative search and label icons are no longer read out, so a label option is announced by its name alone
- The locale pickers on Export ("Select the locale to export", "Select the fallback locale (optional)") and Import ("Select the destination locale") link their visible label to their search box: clicking the label focuses the box, and screen readers and voice control name the box by that label. Before, the labels pointed at nothing, the Export boxes had a different hidden name, and the Import box was named only "Search locales"
- Security: rotating an API client's secret now ends the tokens issued with the old secret. Before, they kept working until they expired (24 hours by default, `TR_AUTH_TOKEN_EXPIRES`), so only deleting the client cut off whoever had the leaked secret
- **API client tokens issued before this upgrade stop working once.** Clients get a new one with their id and secret (grant type `client_credentials`), as they do when a token expires
- Export in `jsonnested` or `yamlnested` answers 400 instead of 500 when a term is also the parent of other terms (`app` and `app.title`), which these formats cannot hold, and the webapp says so instead of asking to try again. A term named `hasOwnProperty` no longer breaks these exports
- Export in `jsonnested` or `yamlnested` keeps terms named `__proto__` (`__proto__`, `__proto__.x`, `a.__proto__`). Before, the export left them out without a warning, so importing such a file and exporting it again lost them
- Support for Flutter ARB (`.arb`) files added: import and export with format `arb`. Export writes `@@locale`; import skips `@@…` and `@key` metadata entries (descriptions and placeholders are not kept), and export answers 400 when a term key starts with `@`, which ARB reserves for metadata
- Android XML import keeps the whole value of a string. A CDATA string was imported empty and a string with an inline tag (`<b>`, `<xliff:g>`) was cut at that tag, and either way the stored translation was overwritten. Now CDATA is read as text, `<xliff:g>` is replaced by its content as the Android build does, and other inline tags are kept as markup. `plurals`, `string-array` and other resource types are skipped instead of being added as empty terms

## 0.23.0

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
