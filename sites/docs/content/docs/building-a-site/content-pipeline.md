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
reviewed: 2026-10-10
---

Everything a site publishes is a file under `content/`. **velite** compiles them into `.velite/` — one JSON per collection plus an `index.js` — and the app imports that as `#content`. `packages/kit/build/velite.mjs` is the pipeline: the markdown processing, the kit's collections, the `prepare` step. A site's `velite.config.js` is two lines calling `kitConfig()`.

Every collection here is a **declaration** — what the site is — and the database only ever holds a projection of one. Which tables are which, and the checks that hold it, are on [Declarations and state](/content/docs/building-a-site/declarations-and-state).

## What somebody downloads, and what is fetched

`#content` is a static import, so anything a widely-imported module reads from it lands in the one
chunk every reader of every page loads. `content.js` is the library's read surface and is in almost
every page's import graph, which made that chunk **6.1 MB** on a large site — and 4.3 MB of it was the
library's text. Somebody opening the storefront downloaded every book.

Two of the three causes are fixed:

- **A companion's `raw` is no longer kept.** The body is READ to parse `chapters` out of it and then
  dropped; returning it too put the same words in a second time (764 KB). `entry.js` never emitted it,
  so `entry.test.mjs` caught the half-done version of this change immediately, which is what that
  check is for.
- **The palette's index is fetched.** `search.json` is the whole library as searchable text — 1.5 MB —
  and three modules read it: the palette, Find your book, and the live preview. All three go through
  `lib/search-index.js` now, one dynamic import behind `corpus()`. Every caller was already async, so
  no call site changed shape. They must share one accessor for more than tidiness: the preview
  **rewrites the array in place** so an edit shows in the palette, and that only holds while all three
  hold the same array — a module namespace is cached by the runtime, so they do.

The chunk is **3.9 MB**, with `search-*.js` a 1.5 MB chunk fetched when somebody searches.

**The third cause is still there**: a book's `raw` (1.5 MB) and its companion's `chapters` (1.2 MB)
are in the collection's records, and only the person of that one book needs either. Moving them
behind a per-book fetch changes what a collection's shape IS, which `entry.js` mirrors field for
field and both engines emit — a change rather than a fix.

## A content type is not finished until it can be edited without a checkout

One question decides whether a new kind of content is done: **with no checkout — cloud mode, where
every file is a row of `public.content` — can somebody still change it?** If not, it is half-built
however well the rest works. The rows are there, the compile reads them, a publish would push them,
and nothing on earth can edit them short of writing SQL.

That failure is invisible from the machine you build it on, where there is always a checkout and
always an editor. So it is held mechanically rather than asked for politely:
`build/content-kinds.mjs` lists every directory under `content/` — **and every single file at its
root**, which is where `content/providers.md` once slipped out with a working projection and no way
to edit it — with the admin model that edits it, and `content-kinds.test.mjs` refuses one that
appears in neither list. Adding a content type means answering the question in the same commit.

The same test asks a second question of a declaration that becomes rows: **can it be projected with
no machine?** A projected table (`build/declarations.mjs`) whose source is under `content/` needs its
model to carry `projected(ctx)`, because over rows `ctx.script()` answers "the deploy runs it" and a
deployment with the repository out of the cycle and no deploy hook never has one. **Every projected
table has one**, and the check requires it rather than excusing anything: spaces, the calendar, the
bots, the achievements and the search index were the last five, and they are paid.

In local development, editing a Markdown file also refreshes the outputs that read it. After Velite
rebuilds, the watcher matches the changed path against each build step's declared `inputs` and runs
the matching `prepare`, function-data, and `site` work. A directory input must be recursive
(`content/bots/**`) to match files below it. `content-refresh.mjs` then runs only `after` steps
explicitly marked `localProjection: true`, and only when the configured Supabase URL is local;
remote projection steps and paid deployment work stay out of the watcher. A failed step is reported
and stops subsequent phases for that change.

There used to be a hand-written `PROJECTION_DEBT` beside this naming what could not yet, and it is
gone — not because the debt was cleared but because the list was the wrong instrument. A hand-written
list is a second opinion, and the second opinion is the one that goes stale: print's entry outlived
its finished cloud path by days, was read back off the list, and repeated as fact. The question is
worked out from the code now, in this check and in `build/modes.test.mjs`, and a gap carried on
purpose is declared in [the matrix](/content/docs/building-a-site/deployment-modes) as an exception
naming the change that closes it — where the guard holds it in both directions, including the
expensive one: an exception whose change has been archived with the gap still open fails the run.

And **`build/artefacts.mjs` does the same for what the functions read that is compiled rather than
content** — the catalog, the forms, the funnels, the email designs. Each is `PUBLISHED` (a publish
compiles it into `public.compiled` and the functions read that row over their file), `LIVE` (the
function builds it from the rows itself) or `FIXED` (with the reason it cannot change without a
deploy); `artefacts.test.mjs` refuses a `.json` beside the functions that is none of the three. On a static site the count of function artefacts is not a deployment gate; the shared overlay wiring is still checked against the kit source. The `FIXED`
list is where the theme's own belong — its strings, its skills, its brand (the faces its looks set
and the site's mark): they are code rather than content, they cannot change on a publish, and the
function has no stylesheet to read them from. It
also runs each compile **twice over this checkout** — once as the build runs it, once through a store
that answers nothing outside `content/` — and requires the two to be identical, which is what catches
a compile that quietly loses something when it cannot see a disk.

The same test holds the other half — **nothing in the admin's pipe may open a content path through `fs`**. The pipe is the set of files copied into the `admin` Edge Function, computed by `build/pipe-closure.mjs` and used by the assembler that copies them, so there is one definition of what runs in the function. Inside it there is no filesystem and content is only ever rows. A build script OUTSIDE the pipe may use `fs` freely: in cloud mode the deploy writes every row out to a file before the build, so a build always has a checkout. Guessing at that line from the outside gives false alarms —
the first version of this guard flagged three build scripts that were perfectly correct, and a guard that cries wolf is one people learn to ignore. A file in the pipe that reaches the filesystem on purpose (the store's own two halves) is listed with the reason.
A module the function genuinely never reaches is named in `PIPE_SKIP` instead — the print renderer
and the pusher, both reached by a specifier built at runtime.

**A literal specifier is not such a path.** The edge runtime resolves every literal import it can
see, a guarded `import('./fonts.mjs')` inside a command-line branch included, so a file left out of
the closure while something in it still names one by a literal is a runtime that does not boot — and
it does not say so where you are looking. It surfaces as every call to every function failing name
resolution, which reads exactly like a stack that is down. `closureResolves()` is the guard: a
literal specifier inside the closure must name a file inside the closure. So `build/fonts.mjs` is
copied although nothing in the function calls it, and listed with its reason beside the store's own
two halves; the faces, mark and accent it reads off a stylesheet arrive compiled instead, as
`pipe/theme-brand.json`.

The assembler once kept its own second copy of the closure and the skip list. A module added to the
skip list went on being copied anyway, and the divergence was invisible because the assembler's
own check compares the tree with its own plan. There is one definition now, and no file may declare
a second.

## The markdown

One renderer, `src/lib/markdown.js` — marked with GitHub-flavoured tables and task lists, every heading given its id (github-slugger, as GitHub does — a slugger per document, given as the tokens are walked, so two documents rendered at once never number each other's headings) and wrapped in an anchor to itself, a fenced block handed to a highlighter where one is given — used by velite here with shiki as the highlighter, and by the browser in cloud mode with none, so a document renders the same html either side but for the colours inside a `<pre>`. Velite adds the table of contents (the headings as a tree), reading time and word count, and an excerpt over the plain text; a companion's chapter summaries go through the same renderer. Books keep their raw text too (the person splits it into chapters itself).

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

Every collection carries `published` (default true). The `prepare` step drops every entry with `published: false` before `.velite` is written — so the site, the search index, the prerender, the sitemap and the share images never see it — and drops a companion whose book is gone. The admin reads the files, never the compiled output, so an unpublished record is still there to edit. The runtime flags that read `published` (the tests, the topics, the routes) are then always looking at published data, and stay as belt and braces. Every data module tolerates an empty collection.

## The strings merge

`prepare` also merges the site's UI strings over the theme's defaults, group by group, key by key, field by field, so the `ui` collection the app reads is the merge and a word the site leaves out is the theme's. See [Strings](/content/docs/building-a-site/strings).

## The post-steps

After velite the Vite plugin runs the steps that read the compiled content: the icons the pages name (`icons.mjs`: the Lucide glyphs written into `.velite/icons.json` so the bundle carries only those — every glyph in dev, for the builder's palette), the search embedding (`embed-content.mjs`: every book's teaching, for the finder), the sales report (`sales.mjs`: the best seller from paid purchases), and the funnels' compile (so the support prompts are there for the widget). They run again whenever velite cleans `.velite` in dev.

**A glyph nothing can draw is said out loud.** A page's `icon` is a name, and a name is drawn in one
of three ways: the theme's own few (`glyphs.js`), any of Lucide's, or by a section that owns a small
vocabulary and draws each one inline — `LandingLibrary` does, with `lines`, `highlight`, `note`,
`place` and the rest. A name none of the three knows used to be skipped in silence and drew a
fallback, which only a screenshot would ever have shown. `icons.mjs` now reports it and, with
`--check` (in `npm test`), refuses the build — and it reads all three vocabularies, because a check
that knew only Lucide's called four working icons broken.

## A site's own collections

`collections: './velite.site.js'` in the config names a module exporting `collections` (velite collection definitions, spread before the kit's) and optionally `prepare(collections)`, run after the kit's. A site with an instrument adds its tests and its results copy. A collection a site does not have reads as empty under Node (`content-node.mjs`) and is absent in the browser, so a kit component that reads one it might not find must guard — the kit's do.

## Cloud mode: the rows through one adapter

With `CONTENT_STORE=cloud` the site does not wait for a build to see an edit. Before the app's modules are evaluated, `main.js` awaits `lib/content-live.js` `load()`: one query of `public.content` (anyone the published rows, an administrator the drafts too, by the policies), each row turned into the entry velite would have made by `lib/entry.js` — the one adapter: the frontmatter picked to the collection's fields and given velite's defaults (including `payments: []` for products with no methods configured, a product's optional trial, and the store's separate price-list and promotion records), the id or slug from the path, the body rendered by the shared renderer, the excerpt, the toc and the reading time over it, the strings' groups, a companion's chapters and a form's model parsed by the same pure grammars the build uses — and put into the bundled collections in place, so every importer of `#content`, and every list a module makes of one at import time, sees the live content. What a browser cannot make is carried over from the bundle's entry of the same slug (a book's cover as the build sized it, its recordings; a cover saved in cloud mode is the bucket's url and stands as one); the strings merge by scope over the theme's defaults as built; the palette's rows are made again from what was loaded, a built row keeping its vector while its words are unchanged. A collection the bundle does not carry — a new content model, a site's own velite collections — waits for the deploy; a query that fails or times out leaves the bundle as built. `build/entry.test.mjs` (in `npm test`) pins the adapter against velite: every entry velite built for the site is made again from its file as a row and compared field for field. The admin's live preview in cloud mode is the same adapter over the draft, in the browser.

## Reading content in code

`@platform-kit/kit/lib/content.js` is the one door: `article(id)`, `articleIndex()`, `docTree(collection)`, `loadDoc(collection, id)`, the books and their chapters, the strings helpers (`us(scope)`, `ug(scope, group)`, `t()`), the site record. Components never import `.velite` files directly.

## A declaration that contradicts itself is refused

A collection's schema checks that each field of a record is the right **shape**. What it cannot
check is whether the fields make sense **together**, and that is where the costly mistakes live.
A booking type carrying a cal.com url _and_ settings read only by the native scheduler is valid
field by field and incoherent as a whole: one of the two is a lie, and which one wins is a line of
code nobody reading the file would think to look up.

This happened when a booking record declared `scheduler: native` while carrying a cal.com url.
The competing declarations left the scheduler unclear; the booking was matched under the type's
filename rather than the cal.com event, so its "one a week" limit was counted against a name no
booking carried. The content rule now refuses that contradiction before it can ship.

**The rules live in `packages/kit/build/content-rules.mjs`**, one entry per collection. A rule is
a pure function over a single compiled record that returns `null` when it has nothing to say and
a sentence when it does — a sentence for whoever has to fix the file, naming what is wrong and
what to do about it, never the field's type.

**They throw, and that is the point.** velite refuses a record of the wrong shape, prints it and
exits 0: the record is dropped and the site is built without it. The deploy runs `npm run build`
and no tests at all. So neither a refused record nor an incoherent one would be noticed before
production. These rules run last in velite's `prepare` and throw, which exits 1, which fails the
build, which fails the deploy. An invalid declaration is not deployable, which is the whole claim.

**A site extends them without editing the kit.** Its collections module — the one
`platformkit.config.js` names under `collections` — may export `rules` of the same shape, which
are added to the kit's, and `rulesOff`, a list of kit rule keys it does not want. Switching one
off is the only way to be rid of it, and it shows in a diff.

**One trap worth knowing about.** By the time a record is compiled, a schema's default and an
author's declaration are the same value, so a rule that reads a field cannot tell whether anybody
wrote it. That is why the session rule looks only at fields whose unset state is empty, and why
`notice` is not among them: it defaults to 24, so the rule cannot distinguish the default from a
value the file actually declares; treating it as an authored setting would make valid cal.com
records appear contradictory. `content-rules.test.mjs` holds the list to that condition whenever
compiled content includes a cal.com session; content without cal.com sessions reports the check
as not applicable. Giving one of those fields a default later fails the suite rather than quietly
turning the rule into a liar. Every rule also needs a
fixture it must refuse and one it must accept; a rule with no failing fixture fails the suite by
name, because a rule that never fires reads as cover and gives none.
