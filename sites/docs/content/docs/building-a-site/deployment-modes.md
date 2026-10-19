---
title: The three deployment shapes
description: A site ships in three shapes — static, git and cloud — and which features each one carries is declared in build/modes.mjs and derived from the code rather than remembered.
order: 41
sources:
  [
    packages/kit/build/modes.mjs,
    packages/kit/build/modules/kit.mjs,
    packages/kit/build/modules/manifest.mjs,
    packages/kit/build/modes.test.mjs,
    packages/kit/build/static-site.test.mjs,
    packages/kit/build/cloud-lane.test.mjs,
    packages/kit/build/test.mjs,
    packages/kit/build/site.mjs,
    packages/kit/build/deploy.mjs,
    packages/kit/build/deploy-checks.mjs,
    packages/kit/bin/platformkit.mjs,
    packages/kit/build/admin-cms-mode.test.mjs,
    packages/kit/build/declarations.mjs,
    packages/kit/build/content-kinds.mjs,
    packages/kit/build/artefacts.mjs,
    packages/kit/supabase/functions/admin/index.ts,
    packages/movable-types/src/pages/AdminPage.vue,
    packages/kit/src/lib/router.js,
  ]
reviewed: 2026-10-18
---

A site built on the kit ships in one of three shapes, and the difference between them is not cosmetic: it decides which features exist at all.

| Shape      | What it is                                                                                         | What it carries                                                    |
| ---------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| **static** | a checkout, a build, a static host. No Supabase at all                                             | only what is a file: the library, the pages, the search, the looks |
| **git**    | a repository and a backend. Content may be files or Supabase rows; publishing commits and rebuilds | the complete CMS when content is rows                              |
| **cloud**  | a backend and no repository. Nothing ever builds again                                             | everything that does not need a build                              |

## Four arrangements, three columns

There are four arrangements and three columns, which is not a rounding error. A backend with content in the checkout, and a backend with content in rows while git is still in the publish cycle, are different arrangements and **identical in what they support** — because the question a column asks is _does anything ever rebuild_, and both of them do. So they share the `git` column, and `deployment.content` is what tells them apart.

When `backend` and `repo` are both on and `content` is `rows`, the site is still in the **git** shape: Supabase rows drive the live CMS, while the connected repository remains the source of truth. Publishing writes the change back to that repository and its rebuild produces the static site. With `backend: true`, `content: 'rows'` and `repo: false`, Supabase is the only content store and the same CMS remains available; there is no repository to publish back to. A **static** deployment has no deployed CMS or authentication, though local development still has the editor.

A production deploy from a standalone site accepts either exact published versions of both PlatformKit packages in the site's manifest and lockfile, or a verified source-install receipt created by the GitHub-source CLI. The source route installs both packages from the clean Core package directories in the public repository without changing the site's manifest or lockfile; deploy checks the receipt and the installed package contents before any production command. This is an install and release contract, not another deployment shape; missing, inconsistent, or modified packages are refused.

## A site declares its shape

One block in `platformkit.config.js`, each field defaulting to what a site already did, so an existing site changes nothing by saying nothing:

```js
deployment: {
  backend: true,      // is there a Supabase at all?
  content: 'files',   // 'files' (the repository) or 'rows' (the database)
  repo: true,         // is git in the publish cycle — does publishing commit and rebuild?
}
```

Three fields rather than one `mode` word, because two of them have an owner other than the config file. `content` is overridden per run — `CONTENT_STORE=cloud npm run dev` is how cloud mode is tested at all. And `repo` must be settable by an administrator at runtime: the config is code, changing it needs a deploy, and a cloud-only deployment is defined by never deploying again, so its operator has no checkout to edit. `declaredTarget()` already falls back to the settings for exactly that reason. The block is the declared default and **one function resolves it** against the environment and the settings; nothing else decides the shape for itself.

## What each feature does in each shape is declared, not remembered

Every module and cross-cutting surface has an answer in each shape: **true**, **false**, or an exception — one named operation that does not work, the kind of gap it is, and the live change that closes it.

A module's answer is written in **its own manifest**, beside the module, and `build/modes.mjs` reads them into the matrix the rest of the build has always asked. It used to be a literal of twenty-four entries in that file, which made a module a name in two places agreeing by hand — the entry and the module could disagree, and whichever was read first won. The cross-cutting surfaces are still declared in `modes.mjs`, because they belong to no module.

This file exists because of a specific failure. Five registries each asked one shape's question sideways and none of them named a shape: [declarations.mjs](/content/docs/building-a-site/declarations-and-state) (file or row), [content-kinds.mjs](/content/docs/building-a-site/content-pipeline) (editable with no checkout), artefacts.mjs (reaches the functions with no build), deploy-checks.mjs (what the environment needs), and the admin function's `MACHINE` list (what cloud cannot do). Every one was kept true by somebody remembering. Print's cloud path was finished, its debt entry stayed on the list for days, was removed — and the same wrong belief was then read back and repeated as fact from recollection alone.

So the rule is one rule: **a module declares its claim, and `modes.test.mjs` derives whether the code backs it.** Where the claim is written down changed; what is checked did not — a manifest saying `cloud` does not make it so. Nothing in the matrix is a list of what is broken.

- A module claiming **static** may own no projected table — a static site has no database to project into.
- A module claiming **cloud** must have `projected()` on every projected table it owns, no artefact of its own frozen in `FIXED`, no action of its own in `MACHINE`, and an admin model for every content directory it owns.

Ownership is derived rather than declared twice: a model carries its `module`, content-kinds maps a directory to its model, declarations maps a table to the content it is projected from, and `FEEDS` maps a model to the artefact it compiles into. A feature may name a table outright for the cross-cutting cases — `content_search` is drawn from six collections and belongs to no one directory. The sessions declaration also classifies `booking_checkout_fulfilments` as state: its Stripe Checkout claim records a paid booking attempt and is never projected from content.

**A table nobody owns fails.** It would otherwise pass every rule by being invisible, which is the quietest way for a guard to be useless — and it happened on the first run, with articles and achievements both carrying real debt and neither being looked at.

## An exception cannot quietly become permanent

Each exception declares its `kind`, and the kind is what decides whether the guard can check it is still owed rather than taking the author's word:

| kind         | derived?                                                 |
| ------------ | -------------------------------------------------------- |
| `projection` | yes — a stale one fails the moment the hook lands        |
| `artefact`   | yes                                                      |
| `editing`    | yes                                                      |
| `machine`    | no — declared by a site's own models                     |
| `browser`    | no — no Edge Function has one; its own change answers it |

So a gap of a derived kind that gets closed while the matrix still says it is open **fails the build**. That is the print failure in reverse and the more expensive direction: a feature people have and do not know about. The claim is raised and the exception deleted in the same commit as the fix.

A `browser` or `machine` exception is on trust, and the register of that is not theoretical: `share-images` went on declaring a cloud gap after the sidecar and the Edge Function had closed it, and the guard had nothing to say. What the two undrivable kinds have in common is that the thing they wait on is a browser or a machine rather than a line of code, so there is no hook whose arrival proves the debt is paid. Reading them is a task, not a check — the list of gaps printed on every run is what makes it possible.

Every gap carried on purpose is printed on every run, so the debt is loud rather than quiet.

## The shapes are run as lanes, not assumed

`npm test` exercised one shape — a checkout with a backend — and passed green the whole time the static shape could not be deployed. A suite that only ever runs the arrangement the developer is sitting in reports on a third of the product, so the shapes are separate **lanes** and a skipped one says so at the end of the run.

The **static lane** (`build/static-site.test.mjs`) is deliberately slow, because every cheap version of it would have passed while the shape was broken: a real build with no Supabase in the environment, a real preview server, and every public route visited in a real browser with the console and the network watched. A console error fails. **A request to a backend fails** — that is the check that catches a component which quietly stopped guarding `configured`, and nothing else in the suite would.

It walks two fixtures, and the second is the one that matters:

- `sites/docs` — every module off. The easy case, and so inert that it makes no backend call even when a Supabase url _is_ configured, which means it cannot prove the network watch works at all.
- `sites/brochure` — the library with every row-backed module off, and no code of its own. The shape most static sites take, and where a lost guard actually shows up: built against a backend it immediately reaches for `comment_subject`, which is how we know the watch bites.

Set `PLATFORMKIT_SKIP_STATIC_LANE=1` to skip it; the run then names the shape it did not cover.

The **cloud lane** (`build/cloud-lane.test.mjs`) holds the other half: a save over rows is a draft and must move no projection, and a publish must move every one — **with no machine anywhere**, no build, no deploy, no script. It runs against a local stack and skips with a note when there is none.

It carries one safety rule that is worth understanding before extending it. **A projection over an unseeded store is a deletion.** A projection is a whole-table sync: it writes what the declaration holds and removes every file-owned row the declaration does not. Over a rows store whose `public.content` was never seeded, the declaration reads as empty — and "empty declaration" and "delete everything the files own" are the same instruction. The first draft of this lane emptied the local `teams` table, which was the second time a test had done that. So the lane compares the rows against the checkout before projecting anything and skips the model loudly rather than running a sync it cannot make safe.

One trap worth knowing if you extend the static lane: routes are computed in a child process per site. `routes.mjs` reads the site through `content-node.mjs` at import time, so walking two sites in one process gives the second a route list contaminated by the first — eight routes came back as four and the lane cheerfully walked the wrong site. A cache-busting query does not help, because what is cached is what it imports.
