# cloud-content Specification

## Purpose
A second place for a site's content: rows in the database instead of files in the checkout, chosen by one switch — the admin running against the live site, an edit shown at once, every edit pushed to the repository so the deploy loop closes. Git mode, the default, is untouched.

## Requirements

### Requirement: One switch chooses where content lives

`CONTENT_STORE` SHALL be `git` (the default: `content/` in the checkout, as today) or `cloud` (every file under `content/` a row of `public.content` — its path, collection, slug, published, the frontmatter as JSON, the body and the markdown as the grammar wrote it; assets in the `content-assets` bucket). The pipe SHALL read and write through one async store shape (`build/store`: files or rows — the files' calls, the assets' calls, and the assets' browse: list, mkdir, rename, move, copy, remove, search over the site's file roots, `media-library`), never the disk directly, so a model, a grammar, an editor or a script knows nothing of the mode. A site that does not set the switch SHALL build, deploy and run exactly as before: no table used, nothing of cloud mode in its bundle.

#### Scenario: git mode is untouched

- **WHEN** a site is built and deployed with `CONTENT_STORE` unset
- **THEN** the deploy runs the steps it ran before with no export step, the bundle's `load()` is a no-op, and `npm test` is green on the root, the demo and the docs site

Verified by: `npm test` on all three; the deploy's step list (`platformkit steps`) unchanged in git mode

#### Scenario: a write in cloud mode

- **WHEN** an administrator saves an article through the admin with `CONTENT_STORE=cloud`
- **THEN** the row is upserted under its path with the frontmatter, the body, the exact text and `pending: true`, and a read of the record comes back byte-identical to what git mode would have written

Verified by: a kit test of the row store over the local stack (write, read, rename, remove, a listing); the pipe's round-trip fixtures under both stores

### Requirement: The admin's backend is the `admin` function in cloud mode

The pipe SHALL be plain JavaScript the build and the functions share (`_shared/pipe/`, assembled from the kit's `build/models` and the grammars, refused on drift), async over the store. In cloud mode the `admin` Edge Function SHALL serve the middleware's actions — collections, list, file (get · put · delete · rename), preview, options, upload, the model actions that need no machine, the repository settings — behind the reader's JWT and `is_admin()`, refusing everyone else; the machine-bound actions (enrich, print, tts) SHALL answer that they run from a checkout or the deploy. The site's `lib/admin/api.js` SHALL call the function when built for cloud mode and the dev server's `/__admin` otherwise; `/admin` SHALL open the CMS (the desk's pages kept) and `/__preview` SHALL be an administrator's route in cloud mode, both tree-shaken out of a git-mode build as today.

#### Scenario: a stranger at the function

- **WHEN** `admin` is called with no JWT, a reader's, or a support agent's
- **THEN** it is refused (401, 403, 403) and nothing is read

Verified by: a kit test against the local stack's function with the seed's accounts

#### Scenario: the admin on the live site

- **WHEN** an administrator opens `/admin/articles` on a cloud-mode site and saves an edit
- **THEN** the grid, the drawer, the preview and the save work as they do in dev, the row's text is byte-identical to what git mode writes, and the browser never held the service key or the token

Verified by: Playwright against the demo in cloud mode on the local stack (`supabase functions serve`), screenshots of the grid, the drawer and the preview; `pipe.test.mjs --roundtrip` under both stores

### Requirement: An edit shows on the live site at once

In cloud mode a **save SHALL be a draft** — the admin's, and a write from the Management API or the Forms API the same, through the one pipe: the record's edit kept beside its row as a row of `content_drafts` (the text, data and body of the edit, who and when; `deleted` for a removal), the live version (`text`, `data`, `body` on `content`) untouched. The site SHALL load its collections from `content` at boot, before the app's modules are evaluated — the **live** version of every row that has one, published rows for anyone and every row for an administrator, by the policies — and turn each row into the entry the components read through one adapter (`lib/entry.js`), replacing the bundled collections' contents in place so every importer of `#content` sees the live content. The admin SHALL read the draft where there is one (`draft ?? live`): the grid marks such a row *Draft*, the drawer opens on it, the live preview renders it. A record saved for the first time SHALL be a draft with no live version and SHALL NOT be on the site; a record removed SHALL be a draft removal (its draft row marked `deleted`) — gone from the editor's list, still on the site — until published. **Publishing** a record SHALL make its draft the live version (or remove the row's live version for a draft removal), clear the draft, and mark the row pending for the push; the site SHALL show it on the next load. Velite's markdown SHALL render through the same renderer as the browser. A query that fails or times out SHALL leave the bundle as built; a collection the bundle does not carry SHALL wait for the deploy. Git mode SHALL be untouched: a save writes the file, there is no draft and no Publish.

#### Scenario: an article saved, the site reloaded

- **WHEN** an article's title is changed and saved in the admin, and the site is loaded again by a guest
- **THEN** the hub, the article's page and the search show the title as it was; the admin's grid marks the article *Draft* and its drawer opens on the new title

Verified by: Playwright on the demo in cloud mode: save, reload as a guest, read the title on three surfaces; the grid's mark

#### Scenario: an article published

- **WHEN** Publish is pressed on that drawer, or Publish everything on Content → Publishing, and the site is loaded again by a guest
- **THEN** the hub, the article's page and the search show the new title, the row's draft is empty and the row is pending

Verified by: the same Playwright run; the row read with the service role in a kit test

#### Scenario: a new record, and a removal, before they are published

- **WHEN** a record is created and saved once, and another live record is deleted, neither published
- **THEN** a guest's site has neither the new page nor the deletion — the old page still answers; the editor's list shows the new one marked *Draft* and not the removed one; Content → Publishing lists both, the removal marked *removed*

Verified by: a kit test of the row store (a first save leaves `text` null and the anon client does not see the row; a removal sets `draft_deleted` and the anon client still sees the live row); Playwright for the lists

#### Scenario: a row and a build agree

- **WHEN** the demo's content is built by velite and loaded as rows through the adapter
- **THEN** every field the components read is equal entry for entry

Verified by: `build/entry.test.mjs`

#### Scenario: the database is unreachable

- **WHEN** the query for the rows fails or takes longer than the timeout
- **THEN** the site runs on the bundle as built, and nothing is thrown

Verified by: a Playwright run with the REST route blocked

#### Scenario: a write from the API is a draft like the admin's

- **WHEN** an entry is updated through the Management API under a management key
- **THEN** it is a row of `content_drafts` the admin lists under Content → Publishing with the API key's maker as who, the live version untouched until it is published — through the API or by a person — and the publish is the same publish, pushed as one commit

Verified by: `content-api.test.mjs` on the demo in cloud mode — the draft row, the admin's Publishing page by Playwright

### Requirement: Every edit is pushed to the repository

Content → **Publishing** (a row of the rail in cloud mode alone — never shown, and its page never drawn, where the content is the checkout's) SHALL list every drafted record (its title, collection, who saved it and when; a removal marked) with a line for the commit's message and *Publish everything*. **Where the repository is in the cycle** it SHALL carry the repository settings (repository, branch, a write-only token kept in `app_settings` by the service, never sent to a browser) and the pushes' state (connected or not, the last push, how many files wait, the last error, Push now), and a publish — one record from its drawer, or everything from the page — SHALL make the published rows pending and push them **as one commit** on the branch through GitHub's git data API: every pending file's blob, one tree over the branch's head with a removed file's entry gone, one commit with the message given (else *Publish: {n} pages*) and the administrator's name, the branch's ref moved to it. On success every row in it SHALL be cleared of pending in one write and `github:last_push` set; on failure every row SHALL stay pending — never a commit for some of them — and the reason shown; a cron SHALL ask the function to push again every minute while anything is pending, bundling whatever waits the same way. With a repository not yet set, published rows SHALL be live on the site and stay pending, and the page SHALL say so. **Where the repository is out of the cycle** (`cloud: { repo: false }`) the page SHALL show neither the settings nor a count of waiting files, and a publish SHALL make the rows live and ask the deploy hook, if one is set, to rebuild.

#### Scenario: a save pushed

- **WHEN** an administrator publishes one record from its drawer with a repository connected
- **THEN** within a few seconds the branch has one commit `Publish: 1 page (<their name>)` holding the file's exact bytes, and the page's status says the last push was now with nothing waiting

Verified by: the kit test of `_shared/github.js` with the git data API mocked (the request recorded)

#### Scenario: three drafts published as one commit

- **WHEN** three records are drafted and Publish everything is pressed with the message "Autumn list"
- **THEN** the branch gains exactly one commit "Autumn list (Ada Finch)" whose tree holds the three files' exact bytes, the three rows are cleared of pending together, and the page says the last push was now with nothing waiting

Verified by: a kit test of `_shared/github.js` with the git data API mocked (the blobs, the tree, the commit, the ref — the requests recorded); a live run against a scratch repository NOT VERIFIED until one is lent

#### Scenario: a push that fails

- **WHEN** the ref update is refused after the tree was made
- **THEN** every row stays pending, no partial state is written, the page shows the reason, and the next minute's retry — or Push now — pushes all of them in one commit once the token is fixed

Verified by: the same test with a 401 on the ref update; the cron's row on the local stack

#### Scenario: a publish where git is out of the cycle

- **WHEN** an administrator publishes with `cloud: { repo: false }`
- **THEN** the rows are live at once, nothing is reported as waiting, and no repository is asked for

Verified by: NOT VERIFIED — no code written yet

### Requirement: The deploy exports the rows and builds from them

In cloud mode the deploy SHALL run the export after the plan and before anything reads `content/`, and `npm run build` SHALL run it first: every row's **live** version written to `content/<path>` as its exact text — a pending row winning over the repository's file, a repository file newer than a row that is not pending winning over the row's live version and written back to it, files with no row inserted as rows, rows with no live version and no file left alone (a draft not yet published), rows with a live version, no file and not pending removed, a pending removal removing the file — and the assets pulled beside them; drafts SHALL be untouched by the export and survive it.

#### Scenario: a developer's commit and an editor's pending edit

- **WHEN** a deploy runs while one row was published in the admin and its push failed, and another file was changed by a commit
- **THEN** the pending row's text is what is built and the row stays pending; the committed file is built and its row brought to it; every other file and row are equal

Verified by: a kit test of the export against the local stack with one pending row and one newer file

#### Scenario: a draft survives the deploy

- **WHEN** a deploy runs while one record is drafted and unpublished
- **THEN** the build holds the live version, the row's draft is there after, and the admin opens on it

Verified by: a kit test of the export against the local stack with a drafted row, a pending row and a newer file

### Requirement: A deployment declares whether the repository is part of the cycle

`cloud: { repo: false }` in `platformkit.config.js` SHALL declare that git is out of the cycle, beside `cloud: { repo, branch }` which declares that it is in it; an absent `cloud` SHALL keep today's meaning — not decided, and the admin asks. It SHALL be configuration compiled into `cloud.json`, and SHALL NOT be inferred from whether a token is set, since a token that was set and is now absent is the case this exists to make safe.

#### Scenario: a deployment with git out of the cycle

- **WHEN** a site declares `cloud: { repo: false }`
- **THEN** Publishing offers no repository to connect, the deploy checks do not ask for one, and nothing anywhere reports files as waiting

Verified by: NOT VERIFIED — no code written yet

### Requirement: With git out of the cycle the export is one-way

With `repo: false` the export SHALL write each row's live version to its file and read nothing back: a file with no row SHALL NOT become a row, and a row that is not pending with no file SHALL NOT be deleted. The rules that reconcile against a repository SHALL run only where there is one. A pending row winning over its file, a row with no live version being left alone, and a pending removal removing the file SHALL hold in both modes.

#### Scenario: a build from a checkout that has no content

- **WHEN** a deploy with `repo: false` runs against a repository holding only code
- **THEN** every row is written out and built, and no row is deleted — whatever any row's pending flag says

#### Scenario: the deletion path is closed

- **WHEN** a row that is not pending has no file, with `repo: false`
- **THEN** it is written out like any other row, and the row is kept

Verified by: NOT VERIFIED — no code written yet

### Requirement: What a publish changes reaches the functions without a build

Some of what the Edge Functions answer from is **compiled** from content rather than read from it —
the catalog (the offers, the booking types, the tiers), the forms, the funnels, the email designs —
and the build writes each as a file beside the functions. Where a deployment cannot build, a publish
SHALL compile what it changed into `public.compiled`, one row per artefact, and the functions SHALL
read that row over the file they shipped with. The compiles SHALL run over the store, so the same
code answers from a checkout and from rows, and nothing they reach SHALL open a disk at import. The
table SHALL be derived: readable by no session, empty on a deployment that builds, and its absence
SHALL leave every function reading the file exactly as before.

An email design SHALL be compiled the same way: its compiler is a browser build and runs there, and
where a package must be named for the runtime to fetch it, the function SHALL import it statically
and hand it to the compile rather than leaving the compile to reach for it.

**Every compiled artefact beside the functions SHALL say how it reaches a deployment that does not
build** — compiled by a publish, built by the function from the rows, or fixed with the reason it
cannot change without a deploy — and one that says none of the three SHALL fail the build. Each
compile SHALL produce the same artefact from content alone as it does for the build.

A declaration whose projection is database writes — a team's members, the provider policy, a space
and its rooms, the calendar, a bot, an achievement, the server's search index — SHALL likewise be
projected by the publish rather than deferred to a deploy, and SHALL be projected on the **publish**
and never on a save, since a save is a draft.

#### Scenario: a booking type edited where nothing rebuilds

- **WHEN** a booking type is edited and published in cloud mode on a deployment with no repository and
  no deploy hook
- **THEN** a draft save changes nothing the API answers, and within seconds of the publish the
  Scheduling API answers with the new type — no commit, no build, no deploy

Verified by: the demo in cloud mode, the admin function driven directly: the title read back from
`/v2/event-types` before the save, after the draft save, and after the publish

#### Scenario: an email design edited where nothing rebuilds

- **WHEN** a design is edited and published in that shape
- **THEN** the draft compiles nothing and the publish compiles every design in the Edge Function, the
  edited one carrying the edit

Verified by: the demo in cloud mode — the `emails` row after a publish, 18 designs, the edited one
larger by the words that were added and smaller again when they were taken out

#### Scenario: a team and a policy published where nothing rebuilds

- **WHEN** a team's name, or the provider policy's payout delay, is published in the same shape
- **THEN** the draft moves nothing and the publish writes the rows — the team's row renamed, the
  delay in `app_settings` — with no machine anywhere

Verified by: the same run; `build/teams-db.test.mjs` and `build/providers-db.test.mjs` pin the two
projections

#### Scenario: the row is only ever a cache

- **WHEN** `public.compiled` is emptied
- **THEN** every function answers from the file the deploy shipped, as it did before the table existed

Verified by: `build/declarations.test.mjs` classifies it derived and refuses a grant to a session;
the demo's suite with the table empty

#### Scenario: an artefact that says nothing about the three shapes

- **WHEN** a new compiled `.json` appears beside the functions and is named in none of the three lists
- **THEN** `npm test` fails and says which file and which decision is missing

Verified by: `build/artefacts.test.mjs`

#### Scenario: a compile that can only work from a disk

- **WHEN** a compile reads something no store can answer — a build artefact, a package directory, the
  theme's manifest — and so produces less from content alone than it does for the build
- **THEN** `npm test` fails and names the part of the artefact the two disagree about

Verified by: `build/artefacts.test.mjs`, which runs each compile twice over the checkout — once as
the build runs it, once through a store that answers nothing outside `content/`

### Requirement: A publish can ask the host to rebuild

A deployment SHALL be able to set a deploy hook — a URL kept in `app_settings`, never sent to a browser once saved — which a successful publish POSTs, so the prerendered pages and the share images catch up without waiting for a schedule. A hook that fails SHALL be recorded and shown and SHALL NOT fail the publish, since the rows are already live. It SHALL be available whether or not the repository is in the cycle.

#### Scenario: a publish with no repository

- **WHEN** an administrator publishes on a deployment with `repo: false` and a hook set
- **THEN** the rows are live at once, the host is asked to rebuild, and Publishing says when it was asked

Verified by: NOT VERIFIED — no code written yet

### Requirement: The rows are the only copy, and can be taken

With git out of the cycle, Publishing SHALL offer the whole content tree as a download, and SHALL say plainly that without a repository there is no history, no diff and nothing to redeploy from.

#### Scenario: taking a copy

- **WHEN** an administrator downloads the content on a deployment with `repo: false`
- **THEN** it is every live record as its exact file text, in its paths, as one archive

Verified by: NOT VERIFIED — no code written yet
