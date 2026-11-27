---
id: changelog
title: Changelog
sidebar_label: Changelog
---

To download the source code for each release, check out [GitHub](https://github.com/ever-co/ever-traduora/releases). Alternatively docker images are available for each release on [Docker Hub](https://cloud.docker.com/u/everco/repository/docker/everco/ever-traduora).

## next

- On the terms and labels pages, screen readers name the delete button of each card after what it deletes:
  "Delete term greeting", "Delete label todo". Before, each of these buttons was read out as "close", the text of its
  icon, so a page of ten terms had ten identical "close" buttons, nothing said that they delete, and a screen reader
  user could delete the wrong term or label. The icon is no longer read out

- Android XML and RESX export: a term with `&`, `<` or `>` in it (`Terms & Conditions`, `a<b`) is written with
  `&amp;`, `&lt;` and `&gt;` in the `name` attribute of its `<string>` or `<data>`. Before, these characters were
  written as they are, which is not well-formed XML: Android, .NET and other XML readers refused the whole file, and
  importing it back into Traduora failed. Translations were already written correctly

- Password reset API: `POST /api/v1/auth/forgot-password` and `POST /api/v1/auth/reset-password` take the rate limit
  of the other auth routes (sign-in, the verification email): `TR_AUTH_THROTTLE_LIMIT` requests per
  `TR_AUTH_THROTTLE_TTL` from one address (10 per minute, 100 in production), then 429 Too Many Requests. Before, they
  had no limit: anyone could send a person reset emails in a loop, and each one voided the link sent before, so the
  person could not reset their password; an email could be checked for an account at full speed; and reset tokens
  could be tried without end

- A person's export and deletion requests from app.ever.co (Ever Platform connection) get answers Ever Platform takes.
  Before, an export was answered `exported` without the address Ever Platform requires (so it was refused), and a
  deletion was answered `anonymised`, a final answer, though only the Ever ID was removed and the account stayed. Now
  each part has its own switch, off by default: `TR_EVER_CONNECT_PERSON_EXPORT_ENABLED=true` makes the export and
  answers `exported` with the address of **My data exports** at the installation's reported https address
  (**Installation address**);
  `TR_EVER_CONNECT_PERSON_DELETION_ENABLED=true` deletes the matched accounts as **Delete account** does, unless the
  account operates this installation or is the last admin of a project, and answers `deleted`. Off, or kept, the answer
  is `failed` (`export_not_available`, `account_deletion_pending`), which keeps the request open on Ever Platform. See
  [Ever Platform connection](ever-platform/connection.md)

- Project activity API: a `locale` given more than once (`?locale=fr&locale=de_DE`) or in brackets (`?locale[]=fr`,
  `?locale[x]=fr`) is refused with 400 Bad Request. Before, the filter was dropped and the changes of every locale were
  listed, with no error. A missing or empty `locale` still lists every locale

- Term label filter API: a `labelId` given more than once (`?labelId=a&labelId=b`) or in brackets (`?labelId[]=a`,
  `?labelId[x]=a`) on `GET /api/v1/projects/:projectId/terms/filter-by-label` is refused with 400 Bad Request. Before,
  most of these forms failed with a server error (500), and `?labelId[]=<id>` filtered by that label. A missing or
  empty `labelId` still answers an empty list, and one label id filters as before

- Project activity on SQLite (the default database) lists the changes made within one second in the order they were
  made. Before, a change was recorded there with a time in whole seconds, so changes to different translations made in
  the same second were ordered by their change numbers, which count per translation: an older change could be listed
  above a newer one, and `limit` could leave out the newest (e.g. three edits of one translation, then one of another).
  The time is now recorded in milliseconds, and the changes recorded before keep their place. Postgres and MySQL are
  unchanged

- Project activity API: `GET /api/v1/projects/:projectId/activity` lists the latest changes made to the translations
  of a project, newest first, with the term, the locale code, the previous and the new value and the user who made the
  change (none for API clients). `locale=<code>` narrows it to one locale and `limit` (1 to 100, 50 by default) sets how
  many to return. It needs the same permission as viewing translations. Before, the history could only be read one
  translation at a time

- Two label changes on the same term or translation at once both stay. Before, adding a label to a term, or removing
  one from a term or a translation, wrote back the whole set of labels it had read, so a label that another request
  added meanwhile was removed, with nothing recorded (e.g. two labels added to one term at once kept only one). Now each
  of these requests adds or removes its own label only. A label added to a term while an import or a new locale adds
  translations of the term now goes to those translations too: before, on Postgres and MySQL, they could miss it. It
  also goes to a translation that is created at that moment in another way, by the first save of its value or by a
  label added to it: before, such a translation got the labels its term had when the request started, so it could miss
  the label, on every database. With several API instances, a first save of a translation's value at the same time as
  a label that adds that translation on another instance keeps the label too: before, on Postgres, the save could
  remove it, with nothing recorded

- A label added to or removed from a translation while an import into its locale runs (also a label added to its term,
  which goes to all its translations) stays so. Before, on Postgres and MySQL, the import wrote back the labels each
  translation had when it started, so it removed a label added meanwhile and brought back one removed meanwhile, with
  nothing recorded. An import now never removes a label: it only adds to each translation the labels of its term it
  lacks

- An import keeps the labels set on a single translation. Before, every translation it wrote got the labels of its term
  only, so a label added to one translation (and not to its term) was removed, with nothing recorded, also when
  `overwrite=false` filled an empty translation. Now a translation that is already stored keeps its labels and gets
  those of its term it does not have yet; a new one still gets the labels of its term

- Import API: `overwrite=false` on `POST /projects/:projectId/imports` keeps the translations that already have a
  value in the locale and fills only the empty or missing ones (new terms are still added); without it an import
  replaces values as before. See [Formats](concepts/formats.md#importing-without-overwriting)

- A label can be added to the translation of a term that has no translation in
  that locale yet, as a term that an import added in another locale. Before, the
  API answered 404, so on the translations page of the other locale no label was
  added and no error was shown. Now the API adds the translation, empty and with
  the labels of the term, and the label. A label that the translation already
  has is not added twice. The translations page also shows the error of a label
  that could not be added or removed: before, it went only to the label dialog,
  which was already closed. The page then loads the locale again, so such a
  label no longer looks added (or removed) and can be picked again

- The label filter of the terms page shows each term with all of its labels. Before, a term with the labels A and B showed only A when the list was filtered by A, and the label picker of that term offered B again. The filtered list now follows what is done on the page: a term leaves it when the picked label is removed from it or when it is deleted, and joins it when it gets that label. Before, the card stayed as it was, and deleting it again failed with "not found". The label filter still applies after something is typed in the search box. The API `GET /api/v1/projects/:projectId/terms/filter-by-label` also returns each term with all of its labels, not only the one filtered by

- The term, context and translation fields show Save and Revert when you reach them with Tab, not only when you click
  them. Before, a keyboard user who typed in a field saw no button, and only the undocumented Ctrl+Enter saved, so text
  typed before tabbing away was never saved. After a save or a revert (Ctrl+Enter, Escape or a click on Save or Revert),
  the focus stays in the field instead of going back to the top of the page, so keyboard and screen reader users keep
  their place in a long list; typing in it again shows Save and Revert again. A field you only tabbed through or
  clicked, without typing, shows the new text when the page changes it, e.g. after a switch to another locale, so its
  Save no longer writes the text of the previous locale. A text you typed and did not save is dropped when you pick
  another locale or reference locale, instead of being saved to the newly picked one. Clicking the context of a term
  created without one no longer throws an error in the browser console, and the length shows 0

- Export with "not translated keys" and a fallback locale holds only the terms that have no translation in the exported locale, each with the value of the fallback locale. Before, it held every term of the project, the translated ones with the fallback locale's value, so translating the file and importing it back overwrote the existing translations with the fallback text. An export with a fallback locale that is not a locale of the project (possible through the API) keeps the terms without a translation, with an empty value: before, it left them out, and with "not translated keys" the file was empty

- Ever ID sign-in that finds an account with the same email (sign in the usual way, then connect): the usual sign-in
  now returns where the Ever ID sign-in was started, e.g. the confirmation of a project from app.ever.co
- A database migration adds two indexes to `ever_connect_provision` (the answers to provisioning intents), for the
  background round's lookups of unfinished answers; no data changes. It runs automatically at start unless
  `TR_DB_AUTOMIGRATE=false`

## 0.24.2

Released 2026-11-22.

- Projects can be created from app.ever.co (hand-off provisioning), behind `TR_EVER_CONNECT_PROVISION_ENABLED=true`
  (off by default; needs the Ever Platform connection): the person lands on `/ever-connect/provision`, signs in with
  the same Ever ID and confirms, and one project is created with them as its admin; declining creates nothing. See
  [Ever Platform connection](ever-platform/connection.md#provisioning-from-appeverco)
- Every pull request runs an egress audit of the Ever Platform modules (`tools/egress-audit/`): with the modules off,
  or loaded but switched off, the API looks up no Ever host and opens no connection out; with them on, it makes only
  the calls listed in [Outbound calls](ever-platform/outbound-calls.md)
- A path under `/api` that no route answers is now a 404 (JSON), never the web app's page: a client asking for a route
  that does not exist, or of a module that is not loaded, gets a clear answer
- Ever Platform connection with several API processes: a running background round also renews its lease on a timer, so
  one long step (a backup or a restore check longer than the 2-minute lease) never lets another process start its own
  maintenance work alongside it
- docs.traduora.co never caches a "not found" answer (`Cache-Control: no-store` on every 404), so a docs deploy can no
  longer leave pages without their scripts for hours
- One database migration: a new, empty table `ever_connect_provision` (provisioning from app.ever.co); no existing
  table changes. It runs automatically at start unless `TR_DB_AUTOMIGRATE=false`

## 0.24.1

- The _Ever Platform_ page has a **Maintenance operations** section for the operator: opt in or out, choose the kinds
  allowed and the weekly windows (UTC), set, replace or remove the backup directory (SQLite), and see the recent
  operations and why one did not run. See
  [Ever Platform connection](ever-platform/connection.md#maintenance-operations)
- The account settings have a **My data exports** section while the Ever Platform connection is on: each user sees the
  exports made of their own account for a request they sent from app.ever.co, and downloads one as a JSON file within
  7 days. See [Ever Platform connection](ever-platform/connection.md#a-persons-ever-id)
- Ever ID sign-in: a person deletion from Ever Platform now locks the account as a sign-in does, so a sign-in that
  read the identity just before cannot open a session after it is removed; a logout that names only the subject also
  ends a sign-up that is still waiting for its confirmation
- Ever Platform connection: a refresh of the integrations never undoes an integration the operator switched off
  while the refresh was reading Ever Platform; with several API processes, a long background round renews its lease
  and stops once another process holds it
- Ever ID sign-in to an existing account: a logout that names only the subject and lands while the sign-in is under
  way now ends it too (before, only a sign-up waiting for its confirmation was ended); a sign-in started after the
  logout works as before
- Ever Platform connection: saved maintenance-operation results that are sent again also renew the lease before each
  send, and the person-link round stops once the connection is no longer the active one
- No database migrations in this release

## 0.24.0

### Upgrade notes

- **Anonymous usage statistics are on by default.** Once a day the API sends Ever Platform one small signed report
  about the installation as a whole (counts only; no name, e-mail address, project, term, translation or key). Set
  `TR_EVER_STATS_ENABLED=false` (or use the switch on the _Ever Platform_ page) to turn them off; the API needs a
  restart for the variable to apply.
- **The Ever Platform connection is off by default** and needs `TR_EVER_CONNECT_ENABLED=true`; no connection data
  is sent before the operator connects (the anonymous statistics above are separate).
- **API client tokens issued before this upgrade stop working once.** Clients get a new one with their id and secret
  (grant type `client_credentials`), as they do when a token expires.
- Database migrations add Ever ID sign-in, the translation change history, the instance identity and the Ever Platform
  connection. They run automatically unless `TR_DB_AUTOMIGRATE=false`.

### Changes

- With the Ever Platform connection on, an owner or admin of the organization can ask from app.ever.co for a health
  report, a backup (SQLite) or a backup check. Each runs only with the organization's consent **and** the operator's
  opt-in for that kind, inside the operator's windows; Ever Platform receives the status, the version and, for a
  backup, an opaque reference and its size only (never a path or a file name). Updates are
  never run from inside the container. See
  [Ever Platform connection](ever-platform/connection.md#maintenance-operations)

- With the Ever Platform connection on, Traduora answers a person's export and deletion requests sent from app.ever.co
  for the accounts their Ever ID is linked to: an export (profile, Ever ID, projects and roles) that only that account
  can download for 7 days, or the removal of the Ever ID from the account (the account, its password and its projects
  stay). While an organization consented to `ever_id_login`, the Ever IDs users signed in with are reported as person
  links (ids only), so these requests reach the installation. See
  [Ever Platform connection](ever-platform/connection.md#a-persons-ever-id)

- Optional Ever Platform connection, off by default. With `TR_EVER_CONNECT_ENABLED=true` the operator can connect the
  installation to an organization with a code from app.ever.co (*Ever Platform* in the account menu). While connected,
  Traduora sends a daily heartbeat, reads its verified plan and the integrations an owner or admin consented to in
  app.ever.co (the installation address, linking the anonymous statistics), lets the operator switch each one off, and
  keeps an audit trail of every change. No connection data is sent before the operator connects, and *Disconnect* ends it. See
  [Ever Platform connection](ever-platform/connection.md)

- Anonymous usage statistics, on by default and turned off with `TR_EVER_STATS_ENABLED=false` (or the switch on the
  _Ever Platform_ page). The API sends Ever Platform one small signed report a day about the installation as a whole: how many users, projects, terms, translations, project
  locales and API clients it has, how many translations changed this month, and whether Google sign-in and sign-ups are
  on. No name, e-mail address, project, term, translation or key is ever sent. The operator (`TR_EVER_ADMIN_EMAILS`,
  default `TR_ADMIN_EMAIL`) finds an _Ever Platform_ page in the account menu that shows what is sent, the last report,
  _Send now_, a switch and _Reset instance identity_. With `TR_EVER_STATS_ENABLED=false` nothing is loaded and nothing is
  sent. See
  [Anonymous usage statistics](ever-platform/anonymous-usage-statistics.md)

- XLIFF 1.2 import reads the units inside a `<group>` without an `id`, which XLIFF 1.2 allows. Before, a `<group>` with no attributes got the whole file refused as malformed, and of several groups with attributes but no `id` (`<group resname="g1">`, `<group resname="g2">`) only the units of the last one were imported, though the import reported success. Of several `<file>` elements with the same `original`, all units are imported now, not only those of the last one. A space between two placeholders or two `<mrk>` (`<x id="1" equiv-text="{a}"/> <x id="2" equiv-text="{b}"/>`) is kept: before, the stored translation was `{a}{b}`. A `<trans-unit>` without an `id` gets the file refused as malformed instead of being imported as a term named `undefined`

- The translations page no longer keeps the error of a failed save when you
  pick another locale. Before, the red message of the previous locale stayed
  above the list of the new one, so it looked as if that locale had failed to
  load or to save. An error that comes up while loading or saving in the new
  locale still shows, and so does an error of the terms, which belong to
  every locale

- Screen readers announce error messages when they appear. Before, nothing was read out: on the translations page the error of a failed save shows above the list, out of view when the edited row is further down, so a screen reader user believed the value was saved. The same held for the errors of the other pages (terms, labels, locales, team, API keys, project settings) and of a failed import or export. The warning icon of these messages is no longer read out as "warning". A translation save or an import that is tried again and fails with the same error is announced again, since the old error is removed while the retry runs

- Security: CSV export also removes the `=`, `+`, `-`, `@`, tab and carriage
  return characters right after each `;` in a term or translation. A
  spreadsheet whose list separator is `;` (the default in many European
  locales) starts a new cell there, so a value such as `x;=1+1` or
  `x;=cmd|' /C calc'!A0` gave a cell with a live formula. Now `x;=1+1` is
  exported as `x;1+1`. The `;` itself and every other character stay, so
  `a; =b` (with a space after the `;`) is exported unchanged. The same
  characters also go right after a line break in a value, and after quotes
  right after a `;` or a line break (`x;"=1+1` is exported as `x;"1+1`):
  such a spreadsheet does not see the quotes around a translation, so it
  started a new row at a line break inside it, and read `""=1+1` as `=1+1`.
  A line of a multi-line value that starts with one of these characters
  loses it in the CSV export

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
