---
title: Strings
description: The rule that no user-facing word lives in a component, the scopes, the merge, the grammar, the helpers, and the one tooling hazard.
order: 45
sources: [packages/kit/build/strings-io.mjs, packages/movable-types/src/content/ui, packages/kit/src/lib/strings.js, packages/kit/build/strings-admin.mjs]
reviewed: 2026-10-09
---

## The rule

Every user-facing string — a heading, a subtitle, a button label, a prompt, an empty state, a modal title, a tab name, a placeholder, the visible label of an aria attribute — is authored in markdown and read at runtime, never hardcoded in a `.vue` or `.js` file. A literal English string in a template is a bug. This keeps the whole voice of the product editable, and translatable, in one place.

## The scopes and the merge

Every chrome scope has a **default file in the theme** (`packages/movable-types/src/content/ui/<scope>.md`, the `strings` entry of the manifest) and the site's `content/app/ui/<scope>.md` is merged **over** it — group by group, key by key, field by field — by `strings-io.mjs` in the kit. velite's `ui` collection is the merge. A field the site leaves out is the theme's, so a site may hold only the words it changes and a missing override shows the default, never a blank. `strings.test.mjs` pins the merge. A scope may also carry a word that is not a label but an explanation — the Publishing page says where its push target came from when the repository declares it — and those live in the scope like any other field. A scope is groups all the way down and nothing registers them: a new surface adds its group to the scope file it belongs in (the staff desk's `## desk` group in the spaces scope, including registered provider sources such as Social, the nav's own words — the person's four places, the spaces heading, the way to find one — sit in `## rail` beside the rooms', the admin section that edits the same rooms is `## admin` in the same one, a community's home, directory, discovery and moderation queue four more, the three words somebody says about themselves — here, away, not now — are in `## rail`, and a space role's name is the site's own record rather than a string anywhere — which is why there are no role words to override) and reads it, and a site overrides whichever fields it wants. Watch for a name the group already uses: the parser is last-wins, which is why the desk's two tabs are `tab-waiting` and `tab-done` rather than `waiting`, a name the badge's own line had already taken.

An instrument's own scopes (`glossary`, `topics`, `concepts`, `patterns`) are the site's alone and have no default. The `forms` scope is the forms module's: a form's runner words (`## runner`: the buttons, the messages a field shows, the fields' own words), the end slide's (`## end`), the embed's refusal (`## embed`), the builder's labels (`## admin`) and the Responses view's (`## responses`) — a form's own copy is its document's. The `analytics` scope gained `## forms`, the Forms section of Content analytics.

The `store` scope also carries the product gallery's text-preview label and the content-type labels used by fallback thumbnails. The `library` scope includes the booking page's sign-in and guest-email prompts; the `network` scope includes the join card's optional link to other plans. The theme's `site-directory` scope supplies the local workspace directory's heading, preview accessibility label and unavailable-preview message; it is used only by development tooling.

## The grammar

```
---
scope: library
---

## group
### key
field: value
another-field: A second value on one line
```

Each string is its own `field: value` line on **one** line — a wrapped line silently truncates the value. The parser is last-wins: give every field a name unique within its key and every key a name unique within its group, or a repeated name silently overwrites the earlier one (which is why the hub's lane labels are `lane-articles` and `more-articles`, not `articles` twice). Hyphenated keys are read with bracket access.

## Reading a string

In a component: `us(scope).group.key.field`, or `ug(scope, group)` for a whole group, from `@platform-kit/kit/lib/content.js`. Long-form site copy (the nav, the CTA) is the i18next catalog under `content/strings/<lang>/`, read with `t()` / `useT(ns)`. In a build script: `uiScope(scope)` from `strings-io.mjs`, never a file read. The edge functions carry the words they need as JSON written beside them at build time (`chat-email-strings.mjs`, `emails.mjs`, `funnels.mjs`).

## Adding or changing a string

Put it in the right scope file, bind the component to it, never leave the literal behind. A new component is wired to markdown from the start. Then render it and look: a missing key shows as blank or `undefined`, which pixels catch and a build does not.

## Where words that are worded once live

Some words appear in many places and are said in exactly one record so they cannot drift. A diagnostic's levels are the example: one record per level under `glossary` → `## levels`, with a field for each way the level is ever said, and one module (`LEVELS` in the site's taxonomy) that every other module reads them from. The rule generalises: nine phrasings of one thing in nine files is what it prevents.

## The tooling hazard

Editing a markdown file through an assistant's `Edit` tool in this project triggers a post-edit formatter that rewrites the file and can drop its trailing block — the last frontmatter key, or the last run of body lines. It does not run on the CMS writer, a person's editor, or velite. The reliable path for markdown from a script is a hook-free write (a small `node -e` with `fs`), or a re-read straight after any tool write to restore anything dropped. Prettier runs over `content/{articles,wiki,docs}` on commit as a cosmetic net and is deliberately kept off `content/app` (whose `## / ### / field:` shape it would wreck) and `content/books` (whose marks and verse breaks it would rewrite).
