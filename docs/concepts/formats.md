---
id: formats
title: Formats
sidebar_label: Formats
---

Traduora currently supports the following import and export formats:

## JSON (flat)
```json
{
  "term.one": "Hello there, this is a translation string",
  "term.two": "Check out {{ project.name }}"
}
```

## JSON (nested)
```json
{
  "term": {
    "one": "Hello there, this is a translation string",
    "two": "Check out {{ project.name }}"
  }
}
```

## YAML (flat)
```yaml
term.one: Hello there, this is a translation string
term.two: 'Check out {{ project.name }}'
```

## YAML (nested)
```yaml
term:
  one: Hello there, this is a translation string
  two: 'Check out {{ project.name }}'
```

## Java properties
```properties
term.one = Hello there, this is a translation string
term.two = Check out {{ project.name }}
```

## CSV
```text
term.one,Hello there, this is a translation string
term.two,Check out {{ project.name }}
```

## Gettext (po)
```text
msgid ""
msgstr ""
"Content-Type: text/plain; charset=utf-8\n"
"Content-Transfer-Encoding: 8bit\n"
"MIME-Version: 1.0\n"
"Language: en_US\n"

msgid "term.one"
msgstr "Hello there, this is a translation string"

msgid "term.two"
msgstr "Check out {{ project.name }}"
```

## XLIFF (1.2)
```xml
<?xml version="1.0" encoding="UTF-8" ?>
<xliff xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="urn:oasis:names:tc:xliff:document:1.2 http://docs.oasis-open.org/xliff/v1.2/os/xliff-core-1.2-strict.xsd" xmlns="urn:oasis:names:tc:xliff:document:1.2" version="1.2">
  <file original="de_DE" datatype="plaintext" source-language="de_DE" target-language="de_DE">
    <body>
      <trans-unit id="term.one">
        <source>Hello there, this is a translation string</source>
        <target>Hello there, this is a translation string</target>
      </trans-unit>
      <trans-unit id="term.two">
        <source>Check out {{ project.name }}</source>
        <target>Check out {{ project.name }}</target>
      </trans-unit>
    </body>
  </file>
</xliff>
```

## Strings
```text
"term.one" = "Hello there, this is a translation string";
"term.two" = "Check out {{ project.name }}";
```

## Strings
```text
"term.one" = "Hello there, this is a translation string";
"term.two" = "Check out {{ project.name }}";
```

## Android Resources (xml)
```xml
<?xml version="1.0" encoding="utf-8"?>
<resources>
  <string name="term.one">Hello there, this is a translation string</string>
  <string name="term.two">Check out {{ project.name }}</string>
</resources>
```

## PHP Arrays
```php
<?php

return [
    "term" => [
        "one" => "Hello there, this is a translation string",
        "two" => "Check out :project_name"
    ],
];
```

## New formats on the way
The roadmap includes: Microsoft Resources.

