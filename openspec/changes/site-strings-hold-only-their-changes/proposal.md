## Why

A site's strings are meant to hold only the words it changes or adds. The merge already works that way, field by field, over the theme's defaults. Two things have broken that design.

- **Sites copy whole files.** Nothing stops a site from carrying a copy of a default scope. DharmaLab's 23 strings files repeat 1,301 of the kit's fields word for word, against 87 it actually changes and 179 it adds. A wording fix in the kit never reaches it, and a bad line exists twice.
- **The kit carries a site's words.** The theme's defaults still hold the DharmaLab diagnostic's wording, left behind when the kit was cut out of that codebase on 2026-10-11: the results page in `pages.md`, the diagnostic runner in `quiz.md`, and the evidence drawer in `sheet.md`. That is 209 fields that no kit component reads. Library, store and gate defaults also speak of "the shelf".

## What Changes

- **The strings check refuses a copied default.** A field in a site's strings file that equals the theme's default for the same scope, group and key fails the check. The failure names the file and the key. Leaving the field out gives the same result.
- **The admin editor saves only differences.** The UI strings editor writes only fields that differ from the default. Resetting a field to its default removes it from the site's file.
- **The theme's defaults hold only the kit's own words.** A default group that no kit source reads fails the check. Groups removed:
  - `pages`: `pairs`, `words`, `areas`, `summary`, `radar`, `grid`
  - `quiz`: `diagnostic`, `teachings`, `host`
  - `sheet`: `drawer`, `conv`, `built`, `shapes`, `patterns`, `areas`, `pairs`, `words`

  `QueueList.vue`, the one kit reader of `pages.grid`, is used by nothing and is deleted with it.

  The check also found three more: `library.card` (read only by DharmaLab's summary card, so it moves to DharmaLab), `sections.faq` (read by nothing) and two `pages.empty.box` fields (read by nothing).
- **The kit's defaults say "the library".** The defaults in `library.md`, `store.md` and `gate.md`, and the email tags' sample subject, say "the library" (or "us") where they said "the shelf".

## Impact

- `packages/kit/build/strings.test.mts`, `packages/kit/theme/src/components/admin/StringsEditor.vue`, `packages/kit/theme/src/content/ui/{pages,quiz,sheet,sections,library,store,gate}.md`, `packages/kit/supabase/functions/_shared/emails/tags.ts`, `packages/kit/theme/src/instrument/ui/results/QueueList.vue` (deleted).
- **Sites:** a site whose code reads a removed group must hold that group itself. DharmaLab already does, as copies, and those copies become its own groups. The DharmaLab change `site-strings-only-overrides` removes its duplicates. Land that change first, or both together, so DharmaLab's check passes.
- **Docs:** `building-a-site/strings` and `running-a-site/settings/site-settings-and-strings` state the rule, the editor's behaviour and the check.
