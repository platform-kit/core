---
title: Cloud mode
description: Editing the live site without a checkout — the content as rows in the database, the admin on an Edge Function, a save a draft, a publish one commit to the repository, and what still waits for the deploy.
order: 43
sources:
  [
    packages/kit/src/lib/content-live.js,
    packages/kit/src/lib/print-index.js,
    packages/kit/src/lib/bucket-host.js,
    packages/kit/src/lib/entry.js,
    packages/kit/build/content-export.mjs,
    packages/kit/supabase/functions/admin/index.ts,
    packages/kit/supabase/functions/_shared/github.js,
    packages/movable-types/src/components/PublishingPage.vue,
    packages/movable-types/src/content/ui/publishing.md,
    packages/kit/build/models/index.mjs,
    packages/kit/supabase/functions/_shared/compiled.ts,
    packages/kit/supabase/schemas/12-compiled.sql,
    packages/kit/build/catalog.mjs,
    packages/kit/build/funnels.mjs,
    packages/kit/build/forms.mjs,
    packages/kit/supabase/functions/_shared/mjml.ts,
    packages/kit/build/emails-compile.mjs,
  ]
reviewed: 2026-10-06
---

**There is a shape before either of these**, and it is worth naming because it needs no database at
all. A site whose modules are all off — no accounts, no store, no community, nothing that needs
somebody to be signed in — is a **static site and nothing else**: the build reads the markdown, writes
the pages, and the result is a folder a host serves. No Supabase project, no environment variables,
no Edge Functions. The documentation you are reading is one (`sites/docs`), and the theme knows to
drop the sign-in and put the docs at the root when it sees that shape (`DOCS_ONLY`). It is the right
answer for a pure documentation site, a blog, a brochure — anything nobody signs in to. Turn on a
module that needs an account and the site needs a backend, which is where the two modes below begin.

A site has two places its content can live. In **git mode**, the default, every page is a markdown file in the repository, the admin runs on the dev server, and a change reaches the live site when it is committed and deployed. In **cloud mode** (`CONTENT_STORE=cloud` in the deploy's environment) the same files are rows of the database, the admin runs on the live site behind an Edge Function, a save is a draft people do not see, and publishing puts the drafts on the site at once and pushes them to the repository as one commit — which is what makes the site rebuild. The editors, the forms, the checks and the words are the same in both; only where the files are kept changes.

**Cloud mode comes in two shapes**, and a deployment says which in its configuration.

With `cloud: { repo, branch }` the repository is **in the cycle**: a publish pushes a commit, the commit
rebuilds the site, and the deploy reconciles the rows against the checkout each time — a file changed
by a commit wins over a row nobody has edited, a file the rows have never seen becomes one, and a
file that has gone takes its row with it. Git is the record and the database is the working copy.

With `cloud: { repo: false }` it is **out of the cycle**: a database and a host and nothing else. Nothing
is pushed, the export only ever writes rows out to files, and none of those three reconciling rules
runs — a checkout with no content in it is not evidence that anything was deleted. Publishing shows
no repository and reports nothing as waiting, because nothing is owed to anybody.

Two things follow, and the page says both. **Something has to ask the host to build**, since there is
no commit to do it: set a **deploy hook** — the URL your host gives you — and a publish asks it, so
the prerendered pages and the share images catch up. And **the rows are the only copy**: there is no
history, no diff, and nothing to redeploy from, so Publishing offers the whole content tree as a
download. A deployment that wants history attaches a repository, which is one line of configuration.

Declaring it is deliberate rather than inferred from whether a token happens to be set, because the
case that has to be safe is a token that _was_ set and is now gone.

Where the pushes go is **configuration**, not a setting: `cloud: { repo, branch }` in
`platformkit.config.js`, so a fresh deployment already knows where it publishes and nobody re-types
it after a deploy. The Publishing page shows it rather than asking for it, and says where it came
from. The **token** is a secret and is the one thing that page still asks for — see
[Declarations and state](/content/docs/building-a-site/declarations-and-state).

## What an editor sees

The admin is at `/admin` on the live site, for an administrator. Every section works as it does on the dev server — the grid, the drawer, the page builder, the live preview (the draft rendered in the browser through the same adapter the site reads rows with) — the adapter also mirrors Velite defaults, including `payments: []` when a product declares no methods and its optional trial, and carries the store's separate price-list and promotion records — with one difference in the drawer: **Save draft** and **Publish** in place of Save. Save draft keeps the edit on the record beside its live version — people go on seeing the live version, the grid marks the row _Draft_, the drawer opens on the draft, the preview renders it. Publish (after _Publish "{title}"?_) saves and puts that one record live, and sends it to the repository. A record saved for the first time is a draft with no live version and is not on the site until published; a deletion is a draft removal — the record leaves the editor's list, the site keeps the page — until published, and can be called off with _Keep_ on the Publishing page. One draft per record: the last save wins.

One thing needs a machine and is not offered live: the **spoken books**. Its button says so — _this runs from a checkout or the deploy_ — and the deploy does it. Two things that used to be on that list are not any more. **The print editions**: `print-render` typesets and sets a book here, and the listing's pictures are drawn by the browser of whoever pressed the button. **The enrichment**: Enrich posts an agent run with a job, which walks the stages where there is no machine — one book at a time, and only once the deployment has said yes to spending (see [The enrichment pipeline](/content/docs/running-a-site/content/books)).

**What does not wait for a machine is a projection.** Where a declaration has to be made real in the
database, the **publish does the writes itself** — the model's `projected` hook; see
[The admin as a host](/content/docs/running-a-site/the-admin). **Every projected table
works this way now**, with none left over:

| what is published                            | what reaches the database                       |
| -------------------------------------------- | ----------------------------------------------- |
| a team                                       | its rows and who is in it                       |
| a provider                                   | the policy and its terms                        |
| a space                                      | its rooms, roles, grants, hooks and flair       |
| an event                                     | its occurrences and what may be said under them |
| a bot                                        | the bot, its tools and its skills               |
| an achievement                               | the award and the trait rules behind it         |
| any of the six collections the site searches | the server's search index                       |

A **save** is still a draft and moves none of it: the projection is what publishing means. This
matters most in the shape with git out of the cycle and no deploy hook, where nothing ever builds
again — a declaration that waited for a build would never reach a row at all, and the five in the
middle of that table waited for one until `cloud-parity`.

### What the functions read, where nothing rebuilds

Some of what the Edge Functions answer from is **compiled** rather than read: the catalog (what is
for sale, the booking types, the tiers), the forms, the funnels. The build writes each as a file
beside the functions and the deploy ships it, which is right — a function that recompiled the
catalog per request would read a hundred records to answer one question.

With git out of the cycle and no deploy hook there is no next build, so the file the deployment
shipped with would be its last. Instead **a publish compiles what it changed into `public.compiled`**,
one row per artefact, and the functions read that row over their file
(`_shared/compiled.ts`). The compiles run over the store, so the same code makes the catalog from a
checkout on a machine and from the rows in an Edge Function.

It is derived and nothing else: drop the table and the next publish makes it again; drop a row and
the function falls back to the file, which is what it did before this existed. Nothing with a session
can read it.

An isolate that started before a publish re-reads within a few seconds (`fresh()`, called by the
functions that answer from an artefact), so the worst anybody sees is a few seconds old.

**The email designs are in this too.** Compiling one is `@templatical/renderer` and MJML's browser
build — the same pair the admin's Test button has always used in the browser — so an Edge Function
can do it, and does. What cannot run there is the full `mjml` package the build uses, which is a
different thing. Both packages are imported statically and by version in `_shared/mjml.ts` and handed
to the compile, because a specifier worked out at run time is not in the module graph the runtime
resolves npm from.

> The catalog is one of the artefacts a publish recompiles, and the **price lists ride with it** — so a sale written in the admin is live at the next publish, with no deploy and nothing rebuilt.

## A derived index is a row too

`#content`'s collections are refilled from `public.content` before the app is evaluated, so a record
published a moment ago is on the shelves. A **derived** file is not a collection — nothing edits it, a
build step writes it — and so it was never refreshed. `content/store/print.json`, which says what every
book's set editions are, is one: a book set in a cloud-only admin wrote its editions to the row, and the
store went on pricing and drawing whatever the last build knew — which in cloud mode is forever. The
editions existed, were quoted and were orderable, and were invisible. Nothing failed anywhere.

`src/lib/print-index.js` is the door it comes through now: the bundle's copy is the default and the live
row replaces it, so both people of it (the shop's prices, and the printed book `Book3D` wears) ask at
call time rather than binding at import. It also brings every address in the row to the host this browser
knows (`src/lib/bucket-host.js`) — a function builds a public bucket url from its own `SUPABASE_URL`,
which is the project's address in production and the stack's inner `kong:8000` on a local stack.

## Content → Publishing

**Publishing** under Content, after Media — a row the rail shows in cloud mode alone, since in git mode every save is already the file and there is nothing to publish (its rail item counts the drafts; every other kind’s counts its records, or, where a kind’s records are a tree, what it says its number is — Spaces counts its spaces, not the rooms under them) is where everything waiting is published in one go, and where a publish goes. **Drafts** lists every drafted record — its title and kind, who saved it and when, a removal marked _removed_, a first save _new_ — with a line for the commit's message (else _Publish: 3 pages_) and **Publish everything**: each draft is checked against its kind's rules as a save would be (one that would not save stops the publish and says which), then every draft becomes the live version at once and the lot goes to the repository as **one commit** — _Autumn list (Ada Finch)_ — so one rebuild follows, not one per page.

**The repository** is where that commit goes: the repository (`owner/name` on GitHub), the branch, and a **token** — a fine-grained token with read and write on the repository's contents. The token is write-only: it is sent once, kept on the server, and never shown again; the page says only that one is set. With none set, what is published is live on the site and waits. **The pushes** says whether the site is connected, when the last push landed, how many files wait, and what the last failure was; **Push now** sends the waiting ones as one commit — though a scheduled job asks every minute on its own, so a push that failed for a moment's reason (the token set after the publish, a network blip) catches up by itself, again as one commit for whatever waits. A failed push leaves every file waiting, never half of them. Until the push has landed the rows are marked pending, and a pending publish is never lost: the deploy writes it out before it builds.

## What waits for the deploy

An edit is live on the site as soon as it is published: the hub, the page, the palette's search, the strings, a landing page's sections. (The preview rewrites the palette's rows in place, so it touches the index only once somebody has actually searched and it has been fetched — `lib/search-index.js`.) A publish — a person's in the admin, or one through the Management API — is also delivered to every content webhook subscribed to it (the admin function's row store carries the same events hook the API's does; see [the content API](/content/docs/building-a-site/contentful-api)). Cloud mode is also what opens the **writing** doors: Contentful's Management API on the content and Typeform's Create API on the forms write through the same pipe as the admin, and in git mode answer 405. What is _built_ — and so waits for the redeploy the push sets off — is what a browser cannot make: the prerendered HTML a crawler is served (the site hydrates over it, so people see the edit), the share images, the search's meaning-vectors for a changed page (its words are found at once; its meaning after the build), the colours inside a code block, a book's cover resized from a new picture, and the recordings. **The print editions do not wait**: Set the editions in the admin sets them here and now, and the listing's pictures — the cover the shop draws the book from, three pages of the interior — are drawn by your own browser straight after (see [Print editions](/content/docs/running-a-site/selling/print-editions)). A new content model (not a new entry of one), a new strings scope, and a site's own collections (an instrument's tests and results, say) also wait: the site carries what the last build knew of them.

## The deploy in cloud mode

Before it builds, the deploy writes every row's **live version** out as a file — a pending publish over the file, a file a developer committed over a row that was not pending, a pending removal removing the file, a file with no row becoming one — so the build is the content as the editors published it, and the repository and the database agree again. Drafts are not the export's: a row's draft is untouched by it and is there after the deploy, and a record never published makes no file. The library goes the same way: the export pulls into `content/uploads` and `public` every file the bucket holds that the checkout lacks, and puts into the bucket every file of the checkout's two roots it lacks, so the [Media](/content/docs/running-a-site/content/media) page sees one library either side. See [Dev, build and deploy](/content/docs/building-a-site/dev-build-and-deploy) for the rule in full and [The content pipeline](/content/docs/building-a-site/content-pipeline) for how a row becomes what a component reads.
