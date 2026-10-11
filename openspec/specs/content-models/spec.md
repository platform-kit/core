# content-models

## Purpose

Any kind of content a site needs, defined in the admin as a model — its fields, their kinds and rules, its options and how it is delivered — and run as a full CMS over markdown files with frontmatter: a grid and a drawer per model, entries published with a switch, delivered as data for the site's own code, as plain pages, as static JSON, or as a landing section, as each model says. Contentful's offer without its service.

## Requirements

### Requirement: Placement in PlatformKit

**Module switch:** models — the module SHALL be one switch, on unless a site says `models: false`, and everything below SHALL go with it; it needs no database, no function and no email, so the deploy asks nothing for it. **Layers.** core: the model record and its grammar, the derivation of every model into a build collection and an admin form, the rules (validatorjs, the Laravel port, MIT, as the kit's dependency), the uniqueness and shown-when checks, the pages' routes and the prerender of them, the JSON files, the Entries section's schema, the check in `npm test` — and the registry the custom models join: the same record the kit's core models are declared as (`content-pipe`), a custom model being one with no grammar, editor, checks, actions or hook of its own. theme: the models' index and builder, the entry drawer's controls for the kinds the built-in collections lack, the index and detail pages, the Entries section's markup, the `models` strings scope. site: none required; a site MAY draw its own pages or sections over a model's data. **What the kit's module leaves to its comparable, on purpose:** Contentful, Sanity, Strapi: an API with tokens and GraphQL (the entries are static JSON and the build's data instead); entries in several languages (the translation module carries a site's languages); a draft → review → publish workflow (a Published switch); roles or permissions per model (any admin); webhooks on publish; an asset library (an upload lives beside its entry); the built-in kinds — articles, books, wiki, docs, pages, products — SHALL NOT be edited in the builder, and SHALL be listed there as core, their fields shown read-only.

#### Scenario: models off

- **WHEN** a site's config says `models: false`
- **THEN** there is no Models section in the admin and no row per model, no `/c/<key>` route for any model, no `/data/models/<key>.json`, no Entries section in the page builder, and the models' screens are not in the bundle

Verified by: the router, the bundle's chunks and the admin rail on the docs site (models off) and the demo (on)

#### Scenario: a core model in the index

- **WHEN** Models is opened
- **THEN** the core models are listed as core, each opening to its fields read-only with no Save, and the custom models open in the builder as before

Verified by: a screenshot of the index and a core model's view

### Requirement: A model is a record, and the admin never shows its grammar

A model SHALL be one file, `content/models/<key>.md`, holding everything about it: its `key` (kebab-case; the directory `content/models/<key>/` its entries live in, its name under `#content/models/`, its address under `/c/`), its `name` and `singular`, `published`, its fields in order, its options, its delivery. A field SHALL carry a `key`, a `kind`, a `label`, optional `help`, `default`, `required`, `unique`, `shown` (a condition on another field of the same model: the field, a comparison, a value) and `rules` (a list of validatorjs rules with their parameters), and what its kind needs (a select's options; a reference's model and whether one or several; a list's kind or group; a group's sub-fields). The admin SHALL edit a model in a builder — every field a row with a kind picked from a list, dragged to reorder, removed with its ×; an inspector per field for the rest; the condition as a row of controls; every rule as a row (the rule from a list, its parameters as the controls that fit: a number, a date, a list of choices, a pattern only for `regex`); the options and the delivery as switches and selects — and SHALL write it back through the same function the build reads it with, so the file cannot be bent out of shape. A textarea, an input whose placeholder teaches a syntax, a schema shown as code, are each a fault. A hand-written model file SHALL work, and the build SHALL refuse one that is malformed — a kind it does not know, a rule it does not know, a reference to a model that does not exist, two fields with one key, a title field the model does not have — naming the fault. **Everything custom is namespaced**: a model's files, collection, admin address, pages and JSON SHALL all live under `models/` (`content/models/<key>/`, `#content/models/<key>`, `/admin/models/<key>`, `/c/<key>`, `/data/models/<key>.json`), so a key can never collide with a built-in collection or a fixed route — a site MAY have a `books` model, and the stock books, their schema, editors and routes are untouched.

#### Scenario: a model built from nothing

- **WHEN** an admin makes a new model, adds a field of every kind, a rule on one, a shown-when on another, and saves
- **THEN** `content/models/<key>.md` holds every field in that order with what was set, the file parses back to the same model, and a rerun of the writer over it changes nothing

Verified by: `build/models.test.mjs` (the round trip over a fixture with every kind, every option and a rule of every family); screenshots of the builder with each kind's inspector open, a rule row and a condition row, both themes

#### Scenario: a hand-written model with a fault

- **WHEN** a model file names a kind, a rule or a referenced model the kit does not have
- **THEN** the build refuses it with a line naming the file, the field and the fault

Verified by: `build/models.test.mjs` over the refused fixtures

### Requirement: The kinds, in four groups

The builder SHALL offer these kinds and no others, grouped as they are listed. **Text:** text (one line), long text, markdown (edited in the markdown editor), number, boolean, date, datetime, url, email. **Choices:** select (one of the field's own options), multi-select (several), tags (free words), reference (an entry of another model, one or several, chosen from a list of that model's entries by title). **Media:** image, file — uploaded beside the entry, referenced by a relative path as a book's cover is. **Structure:** group (named sub-fields, each of a text, choice or media kind) and list (rows, each one kind or one group; added, reordered, removed as rows). Each kind SHALL be edited by the control that fits it — a select for a choice, a date picker for a date, a switch for a boolean, the markdown editor for markdown, an uploader for media, rows for a list — and validated by kind before any rule runs (a url that is not one, a number that is not one, a reference to an entry that does not exist, a select value not among the options).

#### Scenario: every kind in one entry

- **WHEN** an entry of a model with one field of every kind is filled in the drawer and saved
- **THEN** the file's frontmatter holds each value in its own shape (a number as a number, a boolean as a boolean, a date as a date string, a list as a list, a group as a mapping, a reference as the referenced entry's slug, an upload as a relative path to the file beside it), and the build reads it back into the collection with the same values

Verified by: `build/models.test.mjs` (the fixture entry); a Playwright run over the drawer; screenshots of the drawer with every kind, both themes

### Requirement: The rules are validatorjs, and every check runs in two places

A field's rules SHALL be validatorjs's (the Laravel port): `min`, `max`, `between`, `size`, `in`, `not_in`, `regex`, `alpha`, `alpha_num`, `alpha_dash`, `numeric`, `integer`, `digits`, `url`, `email`, `date`, `after`, `before`, `starts_with`, `ends_with`, `confirmed` excluded; each shown in the builder by a plain name and its parameters as controls, and each carried into the model's schema so that the same check runs in the drawer (per field, as the field is left, with the rule's own message from the `models` scope) and in the build (an entry that fails any check is refused with the file, the field and the message; the site never sees it). `required` SHALL refuse an empty value; `default` SHALL fill a field left empty in a new entry; `unique` SHALL refuse a value another entry of the model already holds, in the drawer and in the build; `shown` SHALL hide a field in the drawer while its condition does not hold and SHALL skip every check on it while hidden (its value, if any, is kept in the file).

#### Scenario: a rule refuses in the drawer and in the build

- **WHEN** a text field carries `min:3` and an entry is saved with two characters, in the drawer and then by hand in the file
- **THEN** the drawer refuses the field with the rule's message before the save, and `npm test` refuses the hand-written file with the same message

Verified by: `build/models.test.mjs` (every rule family against a passing and a failing value; unique; shown-when skipping); a Playwright run over the drawer

### Requirement: An entry is a markdown file, and a model is a full CMS over its entries

Every entry SHALL be `content/models/<key>/<slug>.md` — frontmatter as the model's fields say, `published` (default true) on each, the body below when the model has one — and the kit's `Nothing unpublished reaches the bundle` rule SHALL hold for it as for every collection. In the admin each published model SHALL be its own section under Content, listed by the model's name: the entries as the shared AG Grid (the title field first, then every field the model marks for the grid, `published`, sortable and filterable), a Published switch per row, New, delete; an entry opening in a drawer drawn from the model's fields in the model's order, the body in the markdown editor under them when the model has one; a singleton model landing on its one entry inline with no list. The slug SHALL be made from the title on create (the model's `slug` option: from the title, or from another field) and editable until the entry has been saved once; a renamed slug SHALL rename the file. The model's options SHALL be exactly: the title field; the slug's source; `singleton`; `body` (whether entries have one, and its label); `access` (who may open an entry's page: the class ladder, empty for everyone); `order` (a field and a direction, for the index, the JSON and the section). Nothing more.

#### Scenario: the grid and the drawer

- **WHEN** a model with three entries is opened in the admin
- **THEN** the grid shows the three with their titles and marked fields, the switch flips `published` in the file, New writes a file with the defaults and opens it, and the drawer's save writes the file with every value and nothing lost

Verified by: a Playwright run; screenshots of the grid and the drawer, both themes

### Requirement: The builder carries the entries along

A change to a model that has entries SHALL be carried into them: a field renamed in the builder SHALL be renamed in every entry's frontmatter on save; a field removed SHALL leave its values in the files, ignored (an extra key passes as everywhere in the admin); a field whose kind or rules change SHALL be checked against every entry before the save, and the builder SHALL say how many entries would then fail and name them, so the admin can fix them or step back — never a save that leaves the build refusing files without warning. A model renamed (its key) SHALL move its directory and rewrite every reference to it in other models' entries.

#### Scenario: a field renamed

- **WHEN** a field `speaker` is renamed `teacher` in a model with five entries
- **THEN** every entry's frontmatter says `teacher` with the value it had, and nothing else in the files changed

Verified by: `build/models.test.mjs` (the carry over fixture entries, byte-compared outside the renamed line)

#### Scenario: a kind changed under entries

- **WHEN** a text field with entries holding words is changed to a number
- **THEN** the builder says "{n} entries would no longer pass" and names them before anything is written

Verified by: `build/models.test.mjs` (the count); a screenshot of the warning

### Requirement: Delivery, per model, any combination

A model SHALL say how its entries reach the world, any of the four, and nothing SHALL be delivered a model did not ask for. **Data:** the entries as a collection in the build, reachable by the site's own code and the theme's as every collection is (the published ones, in the model's order, references resolved to the referenced entries' slugs). **Pages:** an index at `/c/<key>` — the model's name, every published entry by its title and, when the model has one, its first long-text or markdown field as a summary, in the model's order — and a detail at `/c/<key>/<slug>` — the title, then every field with a value in the model's order, each with its label (an image shown, a markdown field and the body rendered, a reference linked to its own page when that model has pages, a list as rows, a group as its sub-fields), *Back to {name}* — both in the site's design, plain, prerendered, in the sitemap, with the head set from the title and the summary, and the detail gated by the model's access as the library gates a book. **JSON:** `/data/models/<key>.json` written by the build — the published entries in order, every field, the body as markdown — static, no function. **Section:** an *Entries* section in the page builder — the model, cards or a list, how many, in the model's order, each entry linking to its page when the model has pages — drawn by the theme and styled by the look.

#### Scenario: pages on

- **WHEN** a model with pages on and two published entries is built
- **THEN** `dist/c/<key>/index.html` and `dist/c/<key>/<slug>/index.html` exist for each, the sitemap lists them, an unpublished entry has neither a page nor a row on the index, and a model with pages off has no route at all

Verified by: the build's output on the demo; screenshots of the index and a detail, day and night, 1280 and 390

#### Scenario: JSON on

- **WHEN** a model with JSON on is built
- **THEN** `dist/data/models/<key>.json` holds the published entries in the model's order with every field, and a model with JSON off has no file

Verified by: `build/models.test.mjs` over the writer; the demo's build

#### Scenario: the Entries section

- **WHEN** a landing page carries an Entries section for a model
- **THEN** it shows that model's published entries as cards or a list, as many as it says, in the model's order, each linked to its page when there is one

Verified by: screenshots on the demo, both themes

### Requirement: The model's words and the kit's words are apart

Every word the kit says about a model — the builder's, the kinds' and rules' names, the drawer's messages, the pages' *Nothing here yet.*, *All {name}*, *Back to {name}* — SHALL be the `models` strings scope, the theme's defaults overridable by the site as every scope is; every word the model itself says — its name, its fields' labels and help, a select's options — SHALL come from the model file and never from a string file.

#### Scenario: a site overrides a word

- **WHEN** a site's `content/app/ui/models.md` sets `pages.empty`
- **THEN** the index of an empty model shows the site's line, and every other word stays the theme's

Verified by: `packages/kit/build/strings.test.mjs` (the merge); a screenshot

### Requirement: A tag is chosen from the site's own vocabulary, and typing one is a switch

The tags a piece of content carries SHALL be a **declaration the site keeps** — a list, editable
in the admin like anything else — and the field that sets them SHALL offer that list rather than an
empty box. Two spellings of one tag SHALL NOT be possible by default, because the second
spelling is not offered.

**Free tagging SHALL be a switch**, off unless a site turns it on. Where it is on, a writer may type
a tag the list does not hold, and that tag **SHALL join the vocabulary** rather than living
outside it — so the list stays the whole truth about what tags exist, and a typo is something an
administrator can find and correct rather than a value nobody can see.

Turning the switch off SHALL NOT remove tags already in use: what is in the vocabulary stays,
and only the typing of new ones stops.

#### Scenario: the field with free tagging off

- **WHEN** a writer sets the tags on a piece and the site has not turned free tagging on
- **THEN** they choose from the site's list and cannot enter one that is not on it

#### Scenario: a typed tag joins the list

- **WHEN** free tagging is on and a writer types a tag the list does not hold
- **THEN** the piece carries it and the vocabulary holds it too, offered to the next writer

#### Scenario: the switch is turned off afterwards

- **WHEN** free tagging is turned off on a site that has used it
- **THEN** every tag already in the vocabulary is still offered, and only typing a new one stops

#### Scenario: one tag, not two spellings

- **WHEN** two pieces are given the same tag by two writers
- **THEN** it is one entry in the vocabulary and one tag on both pieces

### Requirement: A site chooses its typefaces

`content/site.md` SHALL carry the site's typefaces — a heading face, a body face and a monospace
face — each named as a Google Fonts family. A face left unset SHALL fall back to the theme's own
default, so a site that names none is never left without type.

The build SHALL emit the stylesheet link for exactly the families named, with the weights the theme
uses and no others, and SHALL define them as the three tokens every `font-family` in the theme
already reads. No site SHALL need to edit its `index.html` to change a typeface.

#### Scenario: a site names its faces

- **WHEN** `content/site.md` names a heading, body or mono family
- **THEN** the built page loads exactly those families and the theme's type is set in them throughout — headings, prose, the reader, the admin, the landing

Verified by: `build/fonts.test.mjs`; pixels of the demo's `/sections` with a face changed

#### Scenario: a site names none

- **WHEN** `content/site.md` names no typeface
- **THEN** the theme's own defaults are used and the page is never left with an unstyled fallback

Verified by: `build/fonts.test.mjs`; `sites/brochure`, which names none

#### Scenario: a family that is not a real one

- **WHEN** a site names a family Google Fonts does not serve
- **THEN** the build says so, naming the family, rather than shipping a page whose link 404s and whose type silently falls back

Verified by: `build/fonts.test.mjs`
