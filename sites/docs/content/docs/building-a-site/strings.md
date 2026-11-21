---
title: Strings
description: The rule that no user-facing word lives in a component, the scopes, the merge, the grammar, the helpers, and the one tooling hazard.
order: 45
sources:
  [
    packages/kit/build/strings-io.mts,
    packages/kit/build/strings.test.mts,
    packages/kit/theme/src/content/ui,
    packages/kit/src/lib/strings.ts,
    packages/kit/build/strings-admin.mts,
  ]
reviewed: 2026-11-21
---

Use the UI strings files for text shown in the app: headings, labels, prompts, button text, empty states, placeholders, and visible accessibility labels. Do not hardcode reader-facing copy in Vue or JavaScript components.

## Where strings live

The theme provides defaults in `packages/kit/theme/src/content/ui/<scope>.md`. A site can override any of those values in `content/app/ui/<scope>.md`. The build merges them by scope, group, key, and field; a site value replaces the theme's value, and omitted values keep the theme default.

Scopes group text by interface area. Common examples include `library`, `store`, `forms`, and `analytics`. The `usage` scope also supplies copy for membership billing, including plan status, renewal, cancellation, and saved-payment readiness, and the site-wide banner for a usage payment that needs the reader (`alert`). The `checkout` scope is an offer's own checkout page at `/checkout/<sku>`. The instrument scopes `glossary`, `topics`, `concepts`, and `patterns` belong to the site and have no theme defaults. Longer site copy belongs in `content/strings/<lang>/` and is read with i18next, not the UI strings helpers.

## File format

Each file has a `scope` in its frontmatter, followed by groups and keys:

```md
---
scope: library
---

## reader

### continue

label: Continue reading
accessible-label: Continue reading this book
```

Put each `field: value` on one line. The parser does not join wrapped field values. Within a key, each field name must be unique; within a group, each key must be unique. If a name is repeated, the last value wins. Use bracket access for hyphenated keys.

## Read strings in code

In a component, use `us(scope).group.key.field` for a value or `ug(scope, group)` for the whole group. These helpers are exported by `platformkit/lib/content.js`.

Build scripts should use `uiScope(scope)` from `strings-io.mjs` rather than reading a content file directly. Edge Functions receive their required copy as generated JSON during assembly.

## Add or change copy

1. Find the existing scope and group for the component.
2. Add or update the field in the site's `content/app/ui/<scope>.md`; add a new group there when the interface needs one. Write only the fields you change or add: a field equal to the theme's default says nothing, and it stops a later change to the default from reaching the site.
3. Bind the component to the field with the UI strings helper. Remove any hardcoded copy.
4. Build and render the affected page to check that the field resolves and fits the interface.

When a term must be worded consistently across multiple surfaces, keep its canonical wording in one content record and have each surface read from that record. For example, the instrument's level labels are records in the site's `glossary` scope and are read by its taxonomy module.

`strings-io.mjs` merges site values over theme defaults, and `strings.test.mts` checks that merge. It also fails a site field equal to the theme's default (naming the file and the key), and a default group that no kit file reads — a group counts as read where a file naming its scope also names the group, so it catches a site's words left in the theme, though not every one. The theme's defaults are the kit's own words: wording only a site's code reads belongs in that site's files. Standard UI-string files under `content/app` are not formatted with Prettier because formatting can change their group/key/field structure.
