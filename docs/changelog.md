---
id: changelog
title: Changelog
sidebar_label: Changelog
---

To download the source code for each release, check out [GitHub](https://github.com/traduora/traduora/releases). Alternatively docker images are available for each release on [Docker Hub](https://cloud.docker.com/u/traduora/repository/docker/traduora/traduora).

## next
-

## 0.17.1
- Upgrade Docker images to Node 12.18.

## 0.17.0
- [PR-91:](https://github.com/traduora/traduora/pull/91) Add support for PHP import/export format.
- [PR-153:](https://github.com/traduora/traduora/pull/153) Add option to debug emails locally
- [PR-122:](https://github.com/traduora/traduora/pull/122) Upgraded to Angular 9+.
- [PR-154:](https://github.com/traduora/traduora/pull/154) Add option to reject self-signed certs from mail server.
- Upgraded dependencies.
- Minor performance improvements and bug-fixes.

## 0.16.0
- Allow config of max nested levels on import formats (with new default of 100).
- Pretty print JSON based exporters.

## 0.15.1
- Fix parsing of gettext (po) files with message contexts.

## 0.15.0
- [PR-72](https://github.com/traduora/traduora/pull/72) You can now organize your terms and translations with labels.
- [PR-89:](https://github.com/traduora/traduora/pull/89) Added translation progress stats per locale.
- [PR-94](https://github.com/traduora/traduora/pull/94) Fix escaping of special characters on Android Resources.
- Automatically detect file import format.
- Increase max size for file import (1MB).
- Improve error message when importing files which are too large.

## 0.14.0
- Minor bug fixes and UI improvements.
- Changed DB tables collation to support case-sensitive terms.
- [PR-87:](https://github.com/traduora/traduora/pull/87) We now support the Android Resources (XML) format.

## 0.13.0
- [PR-66:](https://github.com/traduora/traduora/pull/66) You can now invite non-traduora users into your project with the new invite system.
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
