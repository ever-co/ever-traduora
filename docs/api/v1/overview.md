---
id: overview
title: API reference
sidebar_label: Overview
---

The Traduora REST API is available under the `/api/v1/` path. All requests should be served over HTTPS in order to not compromise the authentication tokens.

The API endpoint reference is available **[here](/docs/api/v1/swagger)**.

## API resources

- **User:** an entity used to identify for whom the requests are made.
- **Project:** a workspace for the translations.
- **Project Plan:** the feature plan for which a project is signed up for (default to open-source).
- **Project User:** a user which has access to a given project.
- **Project Client:** an API client which has access to a given project.
- **Project Invite:** an invitation to join a project on traduora.
- **Term:** a string key which groups together translations across multiple locales.
- **Translation:** the translation for a term on a particular locale.
- **Import:** a job to convert and import a group of translations.
- **Export:** a job to export a group of translations into a given format.
- **Locale:** an entity used to identify a language and region.
- **Label:** a label can be used to keep your terms and translations organized and tidy.

## API response

All API responses are wrapped in a `data` object. In the future this will be used to group together metadata fields (i.e. pagination). For example:

```json
{
    "data": (...)
}
```
