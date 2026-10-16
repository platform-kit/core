---
title: The content pipeline
description: How markdown becomes the site — velite, the collections and their fields, the published rule, the post-steps, and a site's own collections.
order: 44
sources:
  [
    packages/kit/build/velite.mjs,
    packages/kit/build/content-node.mjs,
    packages/kit/src/lib/content.js,
    packages/kit/src/lib/markdown.js,
    packages/kit/src/lib/entry.js,
    packages/kit/src/lib/content-live.js,
    packages/kit/build/entry.test.mjs,
    packages/kit/build/content-file-node.mjs,
    packages/kit/build/write-if-changed.mjs,
    packages/kit/src/lib/search-rows.js,
    packages/kit/src/lib/search-index.js,
    packages/kit/src/lib/strings-groups.js,
    packages/kit/build/content-kinds.mjs,
    packages/kit/build/content-kinds.test.mjs,
    packages/kit/build/pipe-closure.mjs,
    packages/kit/build/artefacts.mjs,
    packages/kit/build/artefacts.test.mjs,
    packages/kit/build/content-rules.mjs,
    packages/kit/build/content-rules.test.mjs,
    packages/kit/build/content-refresh.mjs,
    packages/kit/build/content-refresh.test.mjs,
    packages/kit/build/projection-safety.test.mjs,
    packages/kit/build/events-db.mjs,
    packages/kit/build/search-db.mjs,
    packages/kit/build/teams-io.mjs,
    packages/kit/vite/index.mjs,
    packages/kit/build/steps.mjs,
    packages/kit/build/steps.test.mjs,
  ]
reviewed: 2026-10-13
---

Content authors edit Markdown files under `content/`. During the build, Velite validates those files, renders their Markdown, and writes one JSON file per collection plus an `index.js` under `.velite/`. The app imports the generated collections through `#content`. The kit defines this pipeline in `packages/kit/build/velite.mjs`; a site's `velite.config.js` calls `kitConfig()`.

Collections are content declarations. In deployments that use a database, database tables may contain projections generated from those declarations; people and other runtime activity remain database state. See [Declarations and state](/content/docs/building-a-site/declarations-and-state).

## Bundle and search data

The browser bundle includes the collection fields imported by application code. To avoid loading the searchable library text with the initial page, the search corpus is a separate chunk fetched on demand.

`search-index.js` exposes the corpus through `corpus()`, which dynamically imports the search data. The search palette, book finder, and live preview use this accessor so they share the same array; preview edits update the corpus used by search. Companions expose parsed chapters without retaining a duplicate raw body. Books still include their raw text and companions their parsed chapters in collection records.

## Adding a content type

When you add a content directory or a file directly under `content/`, register it in `build/content-kinds.mjs` and provide the admin model that edits it. `content-kinds.test.mjs` checks that every content path has a matching admin model; without one, the type is not editable through the cloud CMS.

If a content declaration produces database rows, add a `projected(ctx)` action to its admin model. That action lets the content pipeline update projections when content is published in cloud mode, where no site build may run. The declarations checks require a projection source and ensure that clients cannot write projected tables directly. See [Declarations and state](/content/docs/building-a-site/declarations-and-state).

In development, the content watcher runs only the steps affected by a changed file. Each build step declares its `inputs`; use a recursive pattern such as `content/bots/**` to watch files below a directory. After Velite rebuilds, the watcher runs matching `prepare`, function-data, and `site` work. It runs `after` steps only when they set `localProjection: true` and the configured Supabase URL is local. A failed step stops the remaining refresh work for that change.

The deployment-shape checks derive whether each module's declared capabilities work in static, git, and cloud deployments. Any known gap must be listed as an exception in the [deployment matrix](/content/docs/building-a-site/deployment-modes), with the change expected to close it.

`build/artefacts.mjs` classifies JSON files consumed by the functions as `PUBLISHED`, `LIVE`, or `FIXED`. `PUBLISHED` files are compiled into `public.compiled` on publish; `LIVE` data is built by the function from database rows; `FIXED` files change only with a deploy. The artefact checks require every function-side JSON file to have a classification and compare build output with output produced through a content-only store.

The admin Edge Function runs without a Node filesystem. Its content requests must use the content store, not read or write content files directly. `build/pipe-closure.mjs` defines the files copied into that function, and the assembler uses the same definition. The closure check also verifies that every literal relative import resolves to a file included in the closure. Some files the function does not execute are still included when a literal import references them; the runtime resolves those imports when it starts.

## The markdown

The shared renderer, `src/lib/markdown.js`, supports GitHub-flavoured tables and task lists, adds linked heading IDs, and highlights code blocks when a highlighter is provided. Velite uses Shiki for code highlighting; cloud-mode rendering uses the same renderer without syntax colours. Velite also generates a table of contents, reading time, word count, and plain-text excerpt. Companion chapter summaries use this renderer too. Book records retain their raw Markdown, which the reader splits into chapters.

## The collections

| Collection                      | Pattern                            | Fields (beyond title, published, body)                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **articles**                    | `articles/**/*.md`                 | description, date, author, image (hero), share, media, canAccess, tags                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **wiki**                        | `wiki/**/*.md`                     | description, order, tags, cover, author, date, updated, related, media, canAccess                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **docs**                        | `docs/**/*.md`                     | the same as wiki                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **books**                       | `books/*.md`                       | author, cover (an address — `/uploads/…`, `/…` or a url — resolved to its file by `build/assets.mjs`), share, description, introduction, date, difficulty, the four `*Chapters` allowances, tags, topics, concepts, `print` (the block — see [Print production](/content/docs/building-a-site/print-production)); the build adds `chapters` (a count) and `audio` (the spoken book's manifest, when there is one)                                                                                                |
| **forms**                       | `forms/*.md`                       | a forms.md document, read by the kit's parser into its model (`slug`, `title`, `published`, `model`); one the parser refuses fails the build naming its line; empty with the module off                                                                                                                                                                                                                                                                                                                          |
| **models**, **models\_\<key\>** | `models/*.md`, `models/<key>/*.md` | the content models — the records, parsed (`key`, `name`, `fields`, `deliver`…; a malformed one refuses the build) — and one collection per published model, its entries with the model's fields in their shapes, `slug`, `published`, a body when the model has one; every entry checked against its model (required, the rules, unique, references) and sorted in its order; `models` an empty list with the module off. See [Content models internals](/content/docs/building-a-site/content-models-internals) |
| **bots**                        | `bots/*.md`                        | name, avatar, model, surfaces, for (who may summon it), spaces, hears (mention · a schedule · one of the platform’s events), tools, limits, memory, extends; the body is the prompt                                                                                                                                                                                                                                                                                                                              |
| **events**                      | `events/*.md`                      | sub, cover, order, space, channel, for (who it is for), host (a role), where (a room · a url · a place), capacity, rsvp, and when it is — starts/ends for a one-off, or repeats (every · on · at · zone · lasts · interval · until/count · except) for one that happens again; its occurrences are expanded into the calendar tables by `build/events-push.mjs` and never edited by hand                                                                                                                         |
| **companions**                  | `companions/*.md`                  | book, insight, statement · statementArea · statementLevel (a premise, optional), generated (provenance); the body in the chapter grammar                                                                                                                                                                                                                                                                                                                                                                         |
| **ads**                         | `ads/*.md`                         | button (required), href, headline, image, media, placement (modal · inline · both · footer), priority, audience, topics, concepts, match, minTopicViews, cooldownHours                                                                                                                                                                                                                                                                                                                                           |
| **products**                    | `store/products/*.md`              | subtitle, sku, key, kind, billing, period, price, currency, chat-hours, book, tier, rank, image, gallery, collections, sizes, badge, featured, order, tags                                                                                                                                                                                                                                                                                                                                                       |
| **collections**                 | `store/collections/*.md`           | subtitle, image, order, featured, products                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **storefront**                  | `store/storefront.md` (one)        | the hero fields, the switches, the lists, `shipping`                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **pages**                       | `pages/*.md`                       | route, seoTitle, description, image, sections (a body is optional)                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **sessions**                    | `sessions/*.md`                    | sub, price, url, requires, below, sku, weekly, monthly, order, hours (when it is bookable by default)                                                                                                                                                                                                                                                                                                                                                                                                            |
| **spaces**                      | `spaces/*.md`                      | name, kind, fill (who is a member — a set of conditions that must all hold, or a list of such sets, which is 'this or that'), discoverable, welcome, groups, roles (each with what holding it grants), grants; the body is what the place is. See [Spaces and channels](/content/docs/building-a-site/social-network)                                                                                                                                                                                            |
| **channels**                    | `spaces/*/*.md`                    | name, topic, mode, visibility, order, group (a heading its space declares), hears (the platform's own events written into the room), grants; its space is its folder                                                                                                                                                                                                                                                                                                                                             |
| **experiments**                 | `experiments/*.md`                 | kind, variants, goal, ends, winner, active                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **site**                        | `site.md` (one)                    | name, tagline, description, url, image, twitter, look                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **ui**                          | `app/ui/**/*.md`                   | the strings, one file per scope                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

Funnels, blasts, the email designs and the emails policy are **not** velite collections: they are compiled by their own scripts (`funnels.mjs`, `emails.mjs`) into the functions tree, since the functions send them. Their grammars are in [Emails and funnels internals](/content/docs/building-a-site/emails-and-funnels-internals).

Every field above is edited as a form in the admin; the full field-by-field reference is [Frontmatter](/content/docs/reference/frontmatter).

## Nothing unpublished reaches the bundle

Every collection has `published`, which defaults to `true`. During `prepare`, Velite removes records marked `published: false` before writing `.velite/`; unpublished records therefore do not enter the site bundle, search index, prerender, sitemap, or share-image build. A companion is also omitted if its book is missing. The admin reads source content rather than `.velite/`, so editors can still open and change unpublished records. Runtime checks also filter published tests, topics, and routes.

## The strings merge

During `prepare`, the site's UI strings are merged over the theme defaults by scope, group, key, and field. A site can override only the fields it needs; omitted fields keep the theme's text. See [Strings](/content/docs/building-a-site/strings).

## The post-steps

After Velite, the Vite plugin runs additional build steps that consume compiled content. These include generating the icon list used by the bundle, the book-search embeddings, the sales report, and the compiled funnels used by support prompts. Catalog synchronization runs only when the selected payment provider declares that capability; Stripe remains the default provider. During development, the steps rerun when Velite clears and regenerates `.velite/`. The icon check also rejects names that are not provided by the theme, Lucide, or a section's own icon set.

## A site's own collections

Set `collections` in `platformkit.config.js` to a module that exports Velite `collections` and, optionally, `prepare(collections)`. The kit adds the site's collections before its own; the site's `prepare` function runs after the kit's. For example, a site with its own instrument can define its tests and results copy there. In Node, a missing collection reads as an empty collection; in the browser it is absent, so components must account for either case.

## Cloud mode: the rows through one adapter

With `CONTENT_STORE=cloud`, `main.js` loads rows from `public.content` before evaluating app modules. `lib/entry.js` converts each row into the same collection shape Velite produces: it applies collection defaults, renders the body, derives excerpts and tables of contents, and parses structured content such as companion chapters and form models. The adapter also restores build-generated fields, such as processed covers and book audio, from the bundled entry with the same slug. The app then reads these updated collections through its normal `#content` imports.

This live replacement applies only to collections included in the bundle. Site-defined collections and new content models require a deploy. If the database query fails or times out, the app keeps the bundled content. `build/entry.test.mjs` compares the adapter's output with Velite's output field by field. Cloud-mode admin previews use the same adapter to display drafts.

## Reading content in code

Read content through `@platform-kit/kit/lib/content.js` rather than importing generated `.velite` files. Its helpers include `article(id)`, `articleIndex()`, `docTree(collection)`, `loadDoc(collection, id)`, book and chapter accessors, UI-string helpers (`us(scope)`, `ug(scope, group)`, `t()`), and the site record.

## A declaration that contradicts itself is refused

A collection schema checks individual field types. Cross-field rules in `packages/kit/build/content-rules.mjs` check combinations that would otherwise be valid in isolation but inconsistent together. For example, a session record cannot specify both a cal.com URL and `scheduler: native`.

These rules run during Velite's `prepare` phase and fail the build when a record violates one. A site's collection module can add rules by exporting `rules`, or disable named kit rules with `rulesOff`. Each rule needs tests for both a record it rejects and one it accepts. Rules that depend on whether a field was explicitly set must account for schema defaults: after compilation, a default value is indistinguishable from the same value written in the file.
