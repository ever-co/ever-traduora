---
id: automatic-translations
title: Automatic translations
sidebar_label: Automatic translations
---

@TODO: This documentation is a quick draft.

Using automatic translations with Google you can automatically translate
untranslated strings.

### Before you begin

1.  [Select or create a Cloud Platform project][projects].
2.  [Enable billing for your project][billing].
3.  [Enable the Cloud Translation API][enable_api].
4.  [Set up authentication with a service account][auth] so you can access the
    API from your local workstation.

(See: [https://github.com/googleapis/nodejs-translate](https://github.com/googleapis/nodejs-translate))

### Setup the project id

Make sure you have set the environment variable `TR_TRANSLATOR_GOOGLE_PROJECT_ID`
this is required by the api in addition to the json key environment variable in
"Before you begin".

### Requesting translations

From a project, navigate to a translation language, from the cogwheel on the
top right click "Run automatic translation"

