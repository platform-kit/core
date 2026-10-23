---
title: Content models internals
description: The model record and its grammar, one derivation for velite and the admin, the rules module over validatorjs, the entry check, the builder's endpoints, the pages, the JSON, the section.
order: 56.7
sources:
  [
    packages/kit/build/model-io.mjs,
    packages/kit/build/models.mjs,
    packages/kit/build/models-check.mjs,
    packages/kit/build/models.test.mjs,
    packages/kit/build/fixtures/models,
    packages/kit/src/lib/models,
    packages/kit/build/admin-schemas.mjs,
    packages/kit/build/velite.mjs,
    packages/kit/vite/index.mjs,
    packages/kit/src/lib/router.js,
    packages/kit/build/routes.mjs,
    packages/kit/theme/src/pages/EntriesPage.vue,
    packages/kit/theme/src/components/landing/LandingEntries.vue,
  ]
reviewed: 2026-10-22
---

The models module is a content type defined as data rather than code: one record, derived once into everything the kit needs. This page is how it is put together; [Content models](/docs/running-a-site/content/content-models) is what it does.

A model and its entries are a **declaration** like every other collection: files in the repository, projected into the database and never authored there. See [Declarations and state](/content/docs/building-a-site/declarations-and-state).

## The record

`content/models/<key>.md` is frontmatter and nothing else, written as block YAML in one key order by `build/model-io.mjs` (`writeModel`) and read by `readModel` — so a rerun of the writer changes nothing, and a file written by hand reads the same way:

| Key                             | Meaning                                                                                                                    |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `key`                           | the file's name; the folder `content/models/<key>/`, the collection `models_<key>`, the address `/c/<key>`                 |
| `name`, `singular`, `published` | what the entries are called; `published: false` takes the model out of the rail, the build and the routes (its files stay) |
| `title`, `slug`                 | the field that names an entry; `title` (the default) or a text field the slug is made from                                 |
| `singleton`, `body`             | one entry, edited inline; `true` or a label — the entry has markdown under its fields                                      |
| `access`, `order`               | the class ladder (`guest` `authenticated` `paid` `subscribed`), a `{ by, dir }`                                            |
| `deliver`                       | `pages`, `json`, `section` as `true`; data is always on and never written                                                  |
| `fields`                        | the list, in order (below)                                                                                                 |

A field: `key`, `kind`, `label`, and only what applies — `help`, `default`, `required`, `unique`, `grid`, `shown: { field, is, value }`, `rules: [{ rule, params }]`, a select's `options: [{ value, label }]`, a reference's `model` and `many`, a list's `of` (a leaf kind, or `group`), a group's or a list-of-groups' `fields` (leaf kinds only). `readModel` names every fault with the file, the field and the reason: an unknown kind or rule, a rule the kind does not take, a bad parameter, two fields with one key, a key an entry carries of its own (`slug`, `path`, `published`, `body`, `raw`…), a title or order or slug field the model lacks, a shown-when naming a field it lacks, a select with no options, a reference with no model, a group holding a list. `readModels(root)` reads the set, by name, and adds the cross-model fault (a reference to a model that is not there); `publishedModels` is the set the build and the admin use.

`renameField(root, key, from, to)` rewrites the one top-level frontmatter line in every entry and nothing else in the file; `renameModel(root, from, to)` moves the file and the folder and rewrites every other model's reference fields that named it.

## One derivation

`build/models.mjs` `schemaFor(model, s, { admin })` turns the fields into one zod shape for two consumers: velite's `s` (a build), or the admin's `z` with `.meta()` for `describeSchema` — the label, help, widget, whether in the grid, the kind, a group's or list's sub-fields, the shown-when, unique and the rules, which the drawer reads back. Kinds map to types (`text` and the other strings, `number`, `boolean`, a select to an enum of its options, a multi-select to an array of that enum, tags to an array of strings, a reference to a string or an array, an image or a file to velite's `s.image()` / `s.file()` in the build and a string in the admin, a group to an object, a list to an array of its row). Every field is optional to the parse, with its default — the parse is the types alone.

The rest is `src/lib/models/entry.js`, pure and shared by the build and the drawer: `checkEntry(model, data, { siblings, refs, words })` runs required, the rules, unique (against the other entries' values), a reference that exists (against the referenced model's slugs) — and `shownHolds` first, so a field hidden by its condition skips every one of them, which is why none of this is zod. `validateEntry` in `models.mjs` is the parse and the check together. Every failure is worded from the `models` scope's `rules` group (`{field}`, `{n}`, `{min}`, `{max}`, `{list}`, `{value}` filled), so the drawer and the build say the same line.

## The rules

`src/lib/models/rules.js` is the one list of kinds (`KINDS`: group and base type) and rules (`RULES`: the parameter shape — `n`, `range`, `list`, `pattern`, `date`, `text`, `none` — and the kinds each applies to). A rule is kept as a row and turned into [validatorjs](https://github.com/mikeerickson/validatorjs)'s string only by `ruleString`, the moment it runs (`min:3`, `between:1,10`, `in:a,b`, `regex:/^a/`); a date rule names a second input, since validatorjs compares fields, not literals. `checkRules(value, rows, words, ctx)` runs each row on its own so the failing rule is known; an empty value passes every rule (required is its own check). `starts_with` and `ends_with` are Laravel's and not in validatorjs 3.22 — registered here, once. validatorjs's own messages are set outright (its language loader is a dynamic require the browser cannot follow) and never shown.

## The collections

`velite.mjs` reads the models at config time: a malformed record refuses the build with its faults; every published model becomes a collection `models_<key>` over `models/<key>/*.md` (`single` for a singleton), its schema `published`, `path`, the fields, and for a model with a body `body` (rendered as an article's; an entry without one is simply without) and `raw`; a `slug` from the path. The `models` collection itself (the records, always declared — an empty list with the module off) is settled in `prepare`, where each model's entries are also checked (`checkEntry` with the other entries and every model's slugs) and sorted in the model's order; a failing entry refuses the build with its file and the line. `content-node.mjs` gives the Node side `models` and `entriesOf(key)`.

Because the collections are declared at config time, the dev server's plugin (`vite/index.mjs`) watches `content/models/*.md` and, on a change, touches `velite.config.js`: velite watches its own config and starts over with the new collections, and `#content` follows (the build steps of the `prepare` phase run again after it, as after any rebuild). A model saved in the builder, added or removed, is live a moment later with no restart by hand.

## The admin

A custom model's entries are a model of the admin's one registry (`build/models/custom.mjs`, joining the kit's core records — see [The admin as a host](/content/docs/running-a-site/the-admin)): key `models/<key>`, its directory, body, title, `assets` beside the entries, `single` for a singleton, its fields the derived zod, its one check the entry check, a rename allowed — read fresh on every request, so the rail's rows follow the files. `admin-schemas.mjs` keeps `describeSchema` and `collectionsFor(root)` (the core collections and the custom ones, for the scripts and tests). `describeSchema` passes a model field's extra meta through (`kind`, `fields`, `of`, `shown`, `unique`, `rules`, `choices`). The admin page parses `/admin/models/<key>[/<slug>]` as the view `models/<key>` and `/admin/model[/<key>]` as the builder; the generic grid and drawer draw the entries, with `ModelLeaf` (one control per leaf kind, uploads through the collection's store), `GroupField` and `RowsField` for the kinds the built-ins lack, `shownHolds` hiding a field, and `checkEntry` under each field once it has been left.

The models themselves are the `models` model of the registry (`build/models/core/models.mjs`): `list` the records with their entry counts and faults, `file` one (its data the model as the builder holds it; a save written through `writeModel` and refused with its faults, `check: true` first running every entry against the draft and answering `{ failing }` instead of writing — the model's preflight), a delete refused with `entries` while any exist, and the actions `check`, `rename-field`, `rename-model`. An entry's rename goes through the pipe's `rename` (the file moves); `options?key=model:<key>` lists a model's entries by slug and title for the reference selects.

## The pages, the JSON, the section

`router.js` has `ROUTES.entries = '/c'` and `ENTRY_KEYS`, the models with pages on (from `#content`'s `models`); `/c/<key>` and `/c/<key>/<slug>` resolve only for those, and `App.vue` mounts `EntriesPage.vue` (the index and the entry, one page) as its own chunk only when there is one. `routes.mjs` adds every such index and every published entry to the prerender and the sitemap; the head is set from the title, the summary field and the image field.

`models.mjs --json` writes `dist/data/models/<key>.json` for every model with JSON on, from `.velite` (`jsonFor`: the model's key, name and fields, the entries with the body as markdown); `platformkit build` runs it after the bundle, and the dev server answers the same address from the same function. The `Entries` section is `LandingEntries.vue` in the landing registry, its schema in `landing/schemas.js` (the model from those with the section on, `layout`, `limit`), offered only when a model has the section on.

## The test

`build/models.test.mjs` (in `npm test` with the module on) pins it over `build/fixtures/models`: a model of every kind, every option and a rule of every family — parsed, written, byte-stable; every refused fixture with its line; every rule against a passing and a failing value, worded from the theme's scope; required, unique, a reference that is not there, shown-when skipping; the fixture entry of every kind into the collection with its values in their shapes; the carry (a field renamed in five entries, the rest byte for byte; a kind changed under entries counted); a `books` model beside the stock books; the JSON writer. `models-check.mjs --check` lists every model and its entries and refuses a failing one; it supplies Velite’s schema from the Node-only CLI so the shared `models.mjs` module has no build-only package import.
