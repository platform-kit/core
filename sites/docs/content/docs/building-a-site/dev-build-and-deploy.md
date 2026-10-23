---
title: Dev, build and deploy
description: The dev server and the local stack, the production build, and the deploy — with the environment checks that refuse it whole.
order: 51
sources:
  [
    packages/kit/build/check.mjs,
    packages/kit/build/dev-directory.mjs,
    packages/kit/build/dev-directory.css,
    packages/kit/build/dev-directory.test.mjs,
    packages/kit/src/lib/seo-head.js,
    packages/kit/src/lib/seo.js,
    packages/kit/theme/src/content/ui/site-directory.md,
    .nvmrc,
    packages/kit/build/dev.mjs,
    packages/kit/build/dev-workspace.mjs,
    packages/kit/build/dev-runtime.mjs,
    packages/kit/build/dev-ports.mjs,
    packages/kit/build/dev-stop.mjs,
    packages/kit/build/dev-owner.mjs,
    packages/kit/build/dev-workspace.test.mjs,
    packages/kit/build/dev.test.mjs,
    packages/kit/build/dev-stop.test.mjs,
    packages/kit/build/deploy.mjs,
    packages/kit/build/deploy-pins.mjs,
    packages/kit/build/deploy-pins.test.mjs,
    packages/kit/build/test.mjs,
    packages/kit/build/deploy-checks.mjs,
    packages/kit/build/prerender.mjs,
    packages/kit/build/routes.mjs,
    packages/kit/build/content-export.mjs,
    packages/kit/bin/platformkit.mjs,
    packages/kit/build/verbose.mjs,
    packages/kit/build/collections.mjs,
    packages/kit/build/collections.test.mjs,
    .devcontainer,
    packages/kit/build/rewrites.mjs,
    packages/kit/build/steps/rewrites.mjs,
    packages/kit/build/rewrites.test.mjs,
    packages/kit/build/steps,
    packages/kit/build/steps.mjs,
    packages/kit/build/steps/print.mjs,
    packages/kit/build/functions-data.mjs,
    packages/kit/build/content-refresh.mjs,
    packages/kit/build/content-refresh.test.mjs,
    packages/kit/build/sites.mjs,
    packages/kit/build/runtime-paths.mjs,
    packages/kit/build/hosts.mjs,
    packages/kit/src/lib/book-art.js,
    packages/kit/src/lib/storefront.js,
    packages/kit/theme/src/components/Book3D.vue,
    packages/kit/theme/src/components/store/StoreHome.vue,
    packages/kit/theme/src/components/store/ProductCard.vue,
    packages/kit/theme/src/components/store/ProductPage.vue,
    packages/kit/vite/index.mjs,
    package.json,
    sites/docs/package.json,
    sites/demo/supabase/config.toml,
    deploy/README.md,
    .github/workflows/publish.yml,
    deploy/apache,
    deploy/prerender,
    deploy/relay,
  ]
reviewed: 2026-10-23
---

## Restarting development

At the workspace root, `platformkit dev` starts selected sites behind the shared front door. If a run ends without cleanup, the next start takes over its recorded site servers and front door; see [multiple-site development](/content/docs/running-a-site/multiple-sites) for what the restart reports and how it protects unrelated listeners.

Some steps exist so a deployment comes up already configured rather than waiting to be clicked into shape: **cloud-config** writes where cloud mode publishes, **webhooks-config** the subscriptions this deployment ships (with **webhooks-push** making them real against the project after the catalog), and **spaces** compiles the rooms a site declares under `content/spaces` (with **spaces-push** projecting them into the tables the surface reads). **bots** compiles the bots, tools and slash commands a site declares into three files — the worker's, which carries each bot's prompt and each command's, and the browser's two, which carry only enough to offer a bot and draw a command's form — with **bots-push** projecting the bots themselves into the table the database asks when somebody summons one (one way; a bot no file declares is removed). **events** does the same for what is on — `content/events` compiled for the site, then **events-push** expanding each repeat into a rolling year of occurrences once the spaces exist to hang them on. See [Declarations and state](/content/docs/building-a-site/declarations-and-state).

## Which engine compiles the content

velite compiles it by default and is the tested path. Three things can say otherwise, asked in this order:

|                                                         |                                                                     |
| ------------------------------------------------------- | ------------------------------------------------------------------- |
| `CONTENT_ENGINE=velite` or `CONTENT_ENGINE=collections` | the run's own say, for trying one against the other                 |
| `content: { engine }` in `platformkit.config.js`        | the site's: either of those names, or a path to a module of its own |
| nothing                                                 | velite                                                              |

**Content Collections** (`collections`) is the kit's second engine, and it is a true 1:1 swap: all 33 collections come out byte-for-byte what velite produces, through velite's own `prepare` hook, into the same `.velite/*.json`. There is no second definition of anything — the collections are declared once, in velite's dialect, in `build/velite.mjs`, and velite's `s` is a patched zod whose `parseAsync(data, { meta })` hands `meta` to every transform. So `s.path()`, `s.raw()`, `s.isodate()`, `s.excerpt()`, `s.metadata()`, `s.image()` and the kit's own body renderer work under either engine, and `s.image()` reaches velite's own `processAsset` so the hashed assets land where they always did. Its singleton check expects the always-present `site` record; optional singleton collections vary with enabled modules and files.

**A site's own engine** is a module exporting `build({ root, config, log })`, where `config` is the velite configuration to realise — the collections and their schemas, the output, the prepare hook. That is the seam for a site that wants its markdown rendered by something else, its images processed its own way, or its content read from somewhere the store does not reach. What it must produce is what both of the kit's engines produce: one JSON per collection under the configured output, through the prepare hook, because that is what `#content` imports and `entry.js` reads. Nobody has to think about any of it — absent a registration and a variable, velite compiles the content as it always has.

**On speed**, on this site: velite ~890ms, Content Collections ~1,150–1,530ms over 114 files. velite is the faster of the two here, partly because it takes a document's plain text off the hast it already holds while the other derives it separately. The flag exists so that "what happens at ten thousand files" is one line rather than a project.

**Two faults worth knowing if you write an engine.** Content Collections answers an _absolute_ `directory` with zero documents and no error at all — the first run of this adapter reported four times velite's speed for having processed nothing. And it transforms documents _concurrently_, which found a real bug in the kit's own markdown renderer: its heading slugger was shared across parses, so two documents parsed at once numbered their headings against each other and every repeated heading became `whats-included-1`. The renderer now builds its own slugger per parse. velite never showed it, because velite parses one document at a time.

## What the build needs of its machine

Measured on a large site: `vite build` peaks at **4.0 GB resident** over some nine and a half thousand modules, and completes with a **3 GB heap** (3.5 GB resident, ~30s). It dies at 2.5 GB and below with `Ineffective mark-compacts near heap limit`. Node's own default heap is derived from the machine's memory, so a developer's laptop is fine and a 2 GB deploy instance fails about 36 seconds in — which is how this was found.

So `platformkit build` asks for a 3 GB heap itself (`PLATFORMKIT_BUILD_HEAP`, above). **The instance still has to have the memory**: budget 4 GB for the build even though the site serves from static files afterwards.

Two things that look like they would lower the peak and do not, both measured rather than assumed: rollup's `maxParallelFileOps` (4.01 GB at the default, 3.94 at two, 3.83 at six) and turning the minifier off (2.53 against 2.55 GB under the same conditions). What would lower it is building the admin as its own rollup pass — ag-grid, TipTap and its extensions, Templatical, VueFinder, mjml-browser, pdf.js, page-flip, livekit and wavesurfer are in the same graph as the person's bundle and no reader loads any of them. That is a change rather than a flag, and it has not been made.

## What a run says

A build and a deploy say **what happened, not how**, because the log is the only diagnostic a deploy box has and a host drops a burst rather than truncating it tidily. Two things used to make one. `vite build` lists every emitted file with its size — three hundred of four hundred log lines on a site of this size — and in its place stands one line: how many files, how much altogether, and the largest. And the plan is summarised: how many statements over how many objects, counted by kind (`create function`, `alter table`, `grant`), rather than the diff itself, which on a declaration of three hundred functions is thousands of lines of idempotent `CREATE OR REPLACE` — pg-delta re-emits a function whenever its body differs by a space.

What quiet may never abbreviate is the part somebody has to act on: a refusal, an error, a count, and **every destructive statement, printed whole with its object**, exactly as before. `PLATFORMKIT_VERBOSE=1` in the environment, or `--verbose` on the command, prints the bodies too — a deploy box sets it for one release when something has gone wrong. A command typed to _see_ something is verbose by its own nature and does not wait to be asked twice: `platformkit migrate --plan` prints the plan whole.

## The environment

The project is developed and built inside `.devcontainer/`: a Dockerfile on the devcontainers Ubuntu base with Node 22, ffmpeg and Chromium's system libraries, plus docker-in-docker for local Supabase stacks. `post-create.sh` runs `npm ci` at the workspace root, installs the headless browser and fetches the text-to-speech weights. Workspace-wide values belong in the root `.env`; each site keeps its own ignored `.env` beside its package. Nothing a script needs may depend on the host machine: no Homebrew, no system Python, no path outside the repo. A new tool goes in the Dockerfile or `post-create`. Ports 5173 and the stack's range are forwarded. The repository's `.nvmrc` selects Node 22 for nvm users, and the `platformkit` CLI automatically restarts under Node 22 through nvm when available; otherwise it explains how to select or install Node 22 before running.

## `platformkit check`

`check.mjs` asks everything a site needs in one pass and prints every problem with its fix, failures first: Node 22, Docker, the Supabase CLI and the test browser; the site's config, its modules and the PlatformKit version it pins; the settings its switched-on features need, from the deploy check's own derivation; and whether the local database answers. On a development machine a missing setting is a warning, because the feature runs in practice mode or not at all; `--production` reads `.env.production` and fails on every gap, as the deploy will. `--db` compares the database with its declaration through `migrate --plan`, and `--online` asks Stripe, the mail relay and the AI providers whether they accept their keys, with read-only calls. When `dev` or `test` fails, the CLI points to it.

## `platformkit dev`

`dev.mjs`: assembles `supabase/`; reads the site's stack from `supabase status`, starting it when it is not up — and, when another project's stack holds the ports `config.toml` names, saying which containers hold them and stopping; uses port `3000` by default and refuses an occupied public port rather than moving implicitly; `--port:auto` opts into searching upward, and runs Vite with `VITE_APP_URL`, `VITE_SUPABASE_URL` and the anon key set for that run, plus `supabase functions serve` on a generated `.env.dev` (`.env` + `APP_URL` for the run) — so a magic link, a checkout's return and the mock's landing all come back to the port the app is actually on, and two projects side by side never fight. The local auth server accepts any localhost port, so the port needs no restart. Flags: `--port N` (exact port), `--port:auto` (opt into automatic port selection), `--no-functions`, `--no-start` (fail rather than start the stack), and `--no-stack` — no Supabase at all, the app alone with its client unconfigured, for a site that has one and wants to work without it for an hour. **A site that has DECLARED it has none needs no flag**: `deployment: { backend: false }` is the static shape, and dev reads it from `deploymentShape` like everything else, so `npm run dev` inside such a site starts the app and nothing else. The docs site is one — `npm run docs:dev` at the workspace root, or `npm run dev` in `sites/docs`, on port `3000` by default (or `--port:auto` when explicitly requested), no Docker needed. (It used to start Supabase for it anyway and die on a compiled emails file that a site with no emails has no reason to hold, so the documented way to run the documentation did not run it.) **The data the functions import is made once the stack’s address is known**, not before: in cloud mode the content is rows, so the steps that read content reach for the store and the store needs that address. Made earlier, the spaces compile died with _supabaseUrl is required_ and took the whole dev server down with it — so the step sits after `supabase status` has answered and still before `functions serve`, which is what the order was always for. A change to `platformkit.config.js` restarts the server; a change to the plugin or a package dependency needs one by hand; after `npm install` every running Vite is stale (_504 Outdated Optimize Dep_) — restart it.

A site's ignored `.env` holds its local values (for example, the local stack URL, mocks and mail relay); the workspace-root `.env` holds workspace-wide settings. Neither should contain production values.

At the tooling-only workspace root, `npm run dev` starts `PLATFORMKIT_DEFAULT_SITE` (default `sites/docs`) unless `PLATFORMKIT_SITES` explicitly selects a multi-site set. The default may name a local site package or a fetched checkout under `sites/external/`; an unfetched registered selection fails with its fetch command. The root registry is `platformkit.sites.json`. It allocates internal Vite ports per selected site and uses port `3000` for the shared nginx front door by default; an occupied public port fails clearly, and `--front-door-port:auto` explicitly opts into searching. The `--port:auto` option does the same for direct single-site dev. Backend-enabled sites receive isolated Supabase projects with stable IDs: set `dev.projectId` in the site config, or the default is `pk_<site>_local`. Their service ports and credentials are runtime-only; a site declaring `deployment.backend: false` starts without a stack. Each site writes `<site>.stack-ready` once its stack answers (at once when it has none). The run gives that site's Vite three minutes from then, so a cold `supabase start` is never cut short, and gives up on a stack still not up after fifteen minutes. The run records and generated runtime Supabase configuration files are stored under `node_modules/.cache/platformkit`; Docker database volumes remain under Docker's control. Runtime files are cleaned up on shutdown or startup failure; a run killed outright takes its servers with it, and the next `npm run dev` stops any abandoned run before starting. From the workspace, `platformkit stop` stops registered process trees and site stacks without removing database volumes or shared Docker images. A root site is optional and requires both a root config and `PLATFORMKIT_ROOT_SITE`. Running `npm run dev` from one site's directory remains the single-site workflow; use `npm run dev -- --single` at the root with `PLATFORMKIT_DOMAIN` unset for a direct `localhost:<vite-port>` run. In the workspace multi-site workflow, the unqualified `http://localhost:<front-door-port>` is a development-only directory of selected sites. Each card uses its own running homepage's resolved title, description and Open Graph image, and opens that site at its named `.localhost` origin. Production routing is unchanged: an unassigned apex remains a 404.

## The data the functions import is made, not committed

The Edge Functions run on Deno and cannot read `content/`, so the build flattens what they need
into thirteen JSON files inside the functions tree: the catalog of offers, the compiled email
designs and their subjects, the funnels, the bots and their commands, the spaces, the teams, the
forms, the content index. Each is read by a **static import**, so a missing one does not degrade —
the worker fails to boot, answers 503, and takes every function sharing that module with it.

They used to be committed. That was wrong twice over. A generated file in git is a second source
of truth that can disagree with the first, and two of these had: the catalog by 55 price entries,
and the email subjects by three that existed in the content and were absent from what the
functions would read. Nothing noticed, because the checks validated each file's contents and never
asked whether it was what a fresh build would write. They also taxed every offer change with a few
hundred lines of regenerated JSON that no one can review and two branches cannot merge — and
`_shared/content/index.json` was already ignored, so the line was arbitrary as well as harmful.

`build/functions-data.mjs` makes all thirteen, from nothing, in about a second. It runs in the
three places that matter: `npm run dev` calls it after assembling `supabase/` and before
`supabase functions serve`; `platformkit test` calls it first, so a fresh clone has them before
any test reads one; and the deploy already ran those steps before `supabase functions deploy`. A file whose module is off is written empty, in its own shape (a list or an object), since the functions import every one whether or not the module is on.

It runs the steps that write those files and no others — not a whole phase, since `prepare` holds
the search index and `functions` holds three steps that are not data at all (`print` renders
books with Typst, `print-type` uploads a typeface, `lulu-webhook` registers a webhook with a
printer). `steps.test.mjs` holds the division honest: every path `assemble` knows as the build's
own must exist after it runs, and none of them may be tracked by git. A new generated file that
nobody adds to the list fails the suite instead of answering 503 on somebody's machine a week later.

## The build steps

Everything the build does beyond compiling the content and the bundle is a **build step**: a record in `packages/kit/build/steps/` — `{ key, title, phase, after, module, when, inputs, needs, backend, run }` — that says where it runs, what it follows, which module it belongs to, a condition on the environment, the files it reads, what it needs (variables, tools on the path, npm packages) and the work. Four phases: `prepare` after the content is compiled (dev, build, deploy: the icons the pages name, the colours each look names — read from the stylesheets, so Site settings can offer every one of them — the search index, the sales report, the funnels); `functions` what the functions carry, before they are deployed (the words, the email designs, the printed books, the catalog, the analytics events and sources for the `ingest` door, the content index for the content API, the forms compiled for the form function and the Forms API, the printer's webhook); `deploy-checks` notes the host rewrites the APIs want (`/spaces`, `/content/v1`, `/images`, `/v2`) and carries `CAL_API_BASE` to the functions when it is set; `site` the bundle and the pages (the form embed, the analytics script, the models' JSON, the prerender); `after` once the functions are live, deploy only (the auth settings, the offers pushed to Stripe, the funnels' runner, the spoken books). A step also says whether it **needs a backend**, which is inferred from its own declared needs — anything asking for a Supabase key is asking for one — so a step added later cannot quietly break the static shape; a step the inference reads wrong says `backend: true | false` outright, as `auth-config` does, since its only declared need is the site's address while it writes to the hosted project's auth settings. In a static deployment such a step is off, with that as the reason — and the deploy's **checks** ask the same question, so a step that will not run does not have its variables demanded. Those two have to agree: while only the runner knew the shape, a static site was asked for `SUPABASE_SERVICE_ROLE_KEY` six times over, once per projection step that would never have run. A module that cannot work without another **declares it**, and the deploy refuses a configuration where a live module needs one that is off, naming both and saying why — one rule over the manifests rather than an `if` per coupling, so a coupling added later is a manifest line. Today there is one: the instrument runs on the forms module’s runner. A step’s `module` must be one a **manifest declares** (`build/modules/`): `loadSteps` refuses one that is not, naming the step and the module it asked for, because a step gated on a switch nobody can set runs always while whoever wrote it believes it is off for sites that switched the feature off — a one-letter typo used to be silent and now stops the build. `build/steps.mjs` is the runner: it orders a phase by `after` (the declaration's order otherwise; a cycle or an unknown key refused), skips a step that is off and can say why, awaits each step's full work before proceeding, and stops at the first failure. That includes asynchronous compilers writing files imported by the functions; deployment cannot begin bundling until those artefacts exist. It never skips a step on its own account — tts and print know their own work is done, the runner does not guess.

A site adds steps in `platformkit.config.js` — `build: { steps: ['./build/steps/my-step.mjs'] }` beside `tests` — and a theme in its manifest (`steps`); they run in their phase among the kit's. The demo's `build/steps/books-csv.mjs` writes `dist/data/books.csv` after the models' JSON, and nothing but its record and that line names it. `platformkit steps` lists every step with its phase, on or off and why, and its needs; `--check` (in `npm test`) refuses when an on step's tool or package is missing; `platformkit run <key>` runs one alone.

### Markdown edits during development

The Vite watcher reruns the declared outputs for a changed content file, rather than requiring a
manual build or projection command. Once Velite has rebuilt, it matches the path against step
`inputs` and runs the matching `prepare`, function-data and `site` work. Inputs naming a directory
must use a recursive glob such as `content/bots/**` to include nested Markdown. It then runs only
`after` steps marked `localProjection: true`, and only against a local Supabase URL. Remote
projections and paid deploy work never run from this watcher. Each step failure is logged and stops
the remaining refresh phases for that edit.

**A step brings its own packages.** The kit's heavy, module-bound packages — `onnxruntime-node` and `ffmpeg-static` (tts), `mjml` (emails), `@myriaddreamin/typst-ts-node-compiler` (print) — are optional peers of the kit, not dependencies: the site that switches the module on names them in its own `package.json`, and a site with the module off installs none of them. A step names them in `needs.packages`, imports them only when it runs, and `npm test`, `platformkit steps --check` and the deploy checks refuse a module on without its packages, naming the step and the package.

## Optional host components

The Apache example uses a `.htaccess` fallback so deep links reach the single-page app; backend sites also need the host rewrites described above. The optional prerender sidecar uses a browser to return rendered pages and fresh share cards for records published after a static build. Sites with calls that cannot connect directly may run an optional TURN relay; it is not required for most calls.

## Package releases and site deployment ownership

PlatformKit maintainers publish one package, `platformkit` (the engine with its theme inside it), from the PlatformKit repository. The manually triggered `Publish PlatformKit packages` workflow requires the exact version declared by `packages/kit/package.json`, runs the kit test suite, then publishes it to the public npm registry. It requires the repository secret `NPM_TOKEN`; it does not publish automatically on every commit. A site must not pin a version until it is available from npm. The same package runs from GitHub without a release: `npx github:platform-kit/core#<branch-or-tag> dev`.

Each site maintainer owns the site repository, its exact PlatformKit package versions, and its committed lockfile. To upgrade, change the package versions and lockfile together, then run `npm ci`, `platformkit test`, and `platformkit build` from the site repository before merging. The production host checks out and builds the site repository commit; the machine-local site registry only supports developer workflows and is not part of production deployment. For a backend deployment, the host runs `platformkit deploy` from that same checkout with its production environment and explicit deployment confirmation.

Before any production-facing deploy step, `platformkit deploy` checks that `package.json` directly pins both `platformkit` and `platformkit/theme` to exact versions and that `package-lock.json` resolves those same versions from an HTTPS package registry with integrity hashes. A missing lockfile, range, stale resolution, workspace link, or local package source refuses the deploy; release the packages and regenerate the site's lockfile before trying again.

### Render build commands

When Render checks out the Core repository itself, set the repository root as its root directory and build the docs site with:

```sh
npm ci && npx platformkit --site sites/docs build
```

With Render's Root Directory set to the repository root, set its Publish Directory to `sites/docs/dist`; Render resolves that path relative to its Root Directory. The root install provides the workspace CLI, so this command does not require PlatformKit packages to be published to npm.

For a separately owned site repository, run commands from the site's root. Install the site's locked dependencies, then build with the Core CLI and packages fetched from GitHub:

```sh
npm ci
npx --yes --package=github:platform-kit/core platformkit build
```

For a production deployment, with the site's production environment configured, run:

```sh
DEPLOY=1 npx --yes --package=github:platform-kit/core platformkit deploy
```

This avoids waiting for a release on npm; npm is still used to install the site's dependencies and fetch the GitHub-hosted CLI. The source route installs the kit and theme into the site's `node_modules` without changing its manifest or lockfile.

## `platformkit build`

The build resolves `deployment.content` before running export or compiling the browser bundle: row-backed sites build with the CMS enabled, while file-backed sites build without it. If the site registers admin models and has a backend, a file-backed build is refused; it cannot silently produce an admin with only the live-data views.

Installs Playwright's Chromium, runs the content export when the site is in cloud mode (below), velite, the `prepare` steps, `vite build`, then the `site` steps — the form embed, the models' JSON and `prerender.mjs`: every public route (`routes.mjs`) rendered in headless Chrome over `vite preview` into `dist/<route>/index.html` with `data-prerendered` on the root, plus `sitemap.xml` when the site has a public address — after `share-images.mjs` has photographed every share card and the icon on the same browser, so the baked pages point at files that exist. `PRERENDER=0` skips the prerender, `SHARE_IMAGES=0` the images; `PLAYWRIGHT_CHROMIUM_PATH` names a browser where the bundled one is not installed. `main.js` clears baked markup that belongs to another route.

## `platformkit deploy`

`deploy.mjs`, run with `DEPLOY=1` (or by CI) with the production environment. In order:

1. **The environment checks** (`deploy-checks.mjs`): what the content switches on decides what must be set, and the deploy is refused before a single command runs, with every missing or wrong setting named at once. Which variables a module can be asked for is declared by [its own manifest](/content/docs/building-a-site/modules); _when_ each is owed stays here, because that turns on the content. **A feature that is off asks for nothing, and that includes the backend itself.** A site that declares `deployment.backend: false` is asked for no database, no shadow, no relay and no push pair — it is asked for its own https origin, which the sitemap and every absolute link need whatever is behind the page — and a static site that switches on something needing a backend is refused **by the feature**: "the store is on and there is nowhere to keep an order", never "SUPABASE_URL is missing". A backed site is asked for the two Supabase keys, the production database's connection and the shadow database's, the mail relay where anything actually sends, and the VAPID pair while push is on. Anything for sale needs the selected payment provider's server credentials; with no provider selected, Stripe remains the default and needs its live key and webhook secret, while another provider needs the secrets declared for it. Preflight recognizes the four `HYPERSWITCH_*` settings and validates its declared profile capabilities, but the built-in Hyperswitch adapter file is not yet present, so selecting it currently fails assembly; those settings alone do not make it a usable checkout option. A book in print needs a printer for every printed format; a published session needs cal.com's secret and API key. A site whose providers may sell their own sessions needs the selected payment provider and terms for them to agree to — and the arrangement where the site itself collects on their behalf and files the reporting is **refused by name**, because that makes the operator a payment facilitator, which is a compliance programme rather than a setting. Every build step that is on asks for its `needs` — a variable, a tool on the path, a package the site installed — with the step named as the reason (the spoken books: the service key, git-lfs, the runtime and ffmpeg — and nothing at all while `TTS` is unset). A mock switched on is refused; `CONTENT_STORE` set to anything but `git` or `cloud` is refused (cloud is noted: the service key it needs is asked for always); a shadow that is production is refused; a wrongly shaped value (an origin with a path, a port that is not a number) is refused. **Some things can only be said, not checked.** An offer asking Stripe to work out tax needs Stripe Tax switched on with a registration for every place the shop sells — there is no key for it, nothing here can see it, and unconfigured Stripe returns _no tax_ rather than an error. So the deploy names the offers that asked and says to go and look, rather than refusing over a setting it cannot verify: a note, because blocking a deploy on a guess is worse than telling somebody where to check. `node build/deploy-checks.mjs --env .env.production` gives the same report by hand; `--test` runs its cases.
2. `assemble`, then `supabase link`.
3. **The plan** against production through the shadow database: computed, guarded, printed, applied — see [The database](/content/docs/building-a-site/the-database). In cloud mode, the **content export** next (`content-export.mjs`): every row of `public.content` written out as a file before anything reads `content/` — a pending row (an edit not yet pushed) over the file; a pending deletion removing the file; the assets the checkout lacks pulled from the bucket. Three more rules **reconcile against the repository, and run only where one is in the cycle**: a file the repository holds wins over a row that is not pending (a developer's push over a stale row), a file with no row becomes one, and a row not pending with no file is removed. With `cloud: { repo: false }` none of them runs — a checkout that holds no content is not evidence that anything was deleted, and reading it as such would empty the database. `--dry` says what it would do. `npm run build` runs it again, idempotent.
4. The `prepare` and `functions` steps: the words and designs the functions carry (`chat-email-strings`, `emails`, `funnels` compiled beside them); **print** — Chromium first, then `print.mjs --all` — runs only with `PRINT_BUILD=1`. Unset or any other value leaves the step off (`PRINT_BUILD is not 1`): no edition render or upload, print-index or printer-registry update, and no generated listing art on a fresh deploy box. `Book3D` places the cover from the book's markdown `cover` beneath the generated print sheet, so it remains visible when that generated art is absent. This gate affects deploy-time generation only; published printed offers still require printer credentials for live order fulfillment. **print-type** remains separate: it puts the type into the `print` bucket so `print-render` can set a book where there is no machine (only what the bucket lacks; the type changes almost never); the catalog is written beside the functions; the printer's webhook is registered when Lulu's keys are set.
5. `functions deploy`; the function secrets set from the environment.
6. The `after` steps: the auth settings written to the hosted project (`auth-config.mjs`: the site url, the redirect list, the two email designs); the catalog synchronized with the selected payment provider when its registration declares `catalog.sync`; the declared rooms projected (`spaces-push`), the calendar with them (`events-push`) and what can be earned beside it (`achievements-push`: the achievements and the trait rules, never anybody's badges); a dry run of the funnels' runner, which writes the hosted project's own url and key into `app_settings` on its first authorised call; **the spoken books**, only with `TTS=1` (speaking a library takes hours; a deploy is allowed minutes), then the voice's weights mirrored to the models bucket.
7. The site built (`npm run build` — the `prepare` steps again, the bundle, the `site` steps) and published by the host.

The spine — the guards, assemble, link, the plan, `functions deploy`, the secrets — is the deploy's own; everything else is a step, and a step that fails stops the deploy there.

**What a destructive plan costs, and who says yes.** The plan asks the database it is about to change what each destructive statement would actually lose — the rows a table holds, and for a column how many rows hold a value differing from that column's own _default_ (`role text default 'member'` whose every row says `member` holds nothing anybody wrote). A statement that would lose nothing is applied with no consent asked for, the same answer a generated column already gets, and the log says what it counted. A statement that would lose values is refused whole with the count beside it, and a count that could not be taken is `unknown` and refuses too — reading an error as "nothing to lose" would make this a trap rather than a net.

Consent is `PLATFORMKIT_ALLOW_DESTRUCTIVE`, and the refusal prints the value to set:

- **a digest** — eight hex over the plan's own destructive statements, so the allowance names _these_ statements and expires the moment they change. A later deploy bringing a different drop gets a different digest and refuses, which is why a variable left on the host permits nothing. `<digest>:<object>,<object>` narrows it further, to allow one drop and refuse another in the same plan.
- **a commit sha** — matched against the commit being deployed (git HEAD, else RENDER_GIT_COMMIT, GITHUB_SHA, VERCEL_GIT_COMMIT_SHA, `PLATFORMKIT_COMMIT`), for a deployment that would rather tie consent to a release.
- **`1`** — a standing permission, still honoured everywhere, for a real case like a first declared deploy against years of drift. The log says that is what it is, and prints the digest that would have scoped it.

The digest is over the statements rather than the commit because a removal has two sources and only one is a commit of the site's: a kit upgrade can drop a column with no site commit at all, and consent tied to a sha would admit it silently. `PRINT_COMMIT=1` lets a title made at the printer be committed back (a build box needs `PRINT_GITHUB_TOKEN`).

## Nothing reaches production by accident

`dev`, `build` and the tests never link, push or deploy: only `deploy.mjs` with `DEPLOY=1`, a remote `VITE_SUPABASE_URL` and the allow-listed project ref may. A local run reads the local stack or `.env` and never a production key.

## The production host

The whole of it — what a host must do, the one file of rewrites, Netlify, Render, your own nginx — is [Hosting and the rewrites](/content/docs/building-a-site/dev-build-and-deploy); the short form:

The site is a static build served by the host (Render today), and everything else it needs from the host is a handful of **rewrite rules** to the project's Edge Functions, written once in the site's `deploy/_redirects` — Netlify's format (`source destination status`, `:splat`, 200 a rewrite), `$SUPABASE_URL` standing for the project's address — the one place the rules live: `/api/media/*` to the images function, `/api/scheduling/v2/*` to `scheduling-api` (the Scheduling API, with `sessions` on), `/api/*` to `storefront-api` (the Store API, with `store` on — and the doors it tells apart and hands on: `/api/desk/api/v1/*` to `support-api`, `/api/content/spaces/*` and `/api/content/content/v1/*` to `content`, which is where the content API answers because `/spaces` on the site is the community's own address), `/api/desk/public/*` to `support-api` (the Support API's Client door, with `support` on), `/v1/*` to the functions (the emails' links and pixels, the analytics door at `/api/events`, the Forms API at `/api` — always), `/share/*` to the `share-image` function (the share pictures, where a host cannot run a browser — a redirect applies only where no file matches, so the build's own photograph wins and only a record published since it reaches the function), and `/* /index.html 200` last (a prerendered page as it is, else the shell). `build/rewrites.mjs` reads it: the `rewrites` build step (`site` phase) writes `dist/_redirects` with the address filled from `VITE_SUPABASE_URL` — Netlify takes it as is; Render's Redirects/Rewrites are the same lines typed in, action Rewrite, in that order — and the nginx template under `deploy/nginx`; `--check` in `npm test` refuses a rule a module needs and the file lacks, one for a module that is off, an order a first-match host would get wrong, a missing fallback, or a stale template, so the file is never behind the code. `PUBLIC_FUNCTIONS_URL` and `VITE_PUBLIC_FUNCTIONS_URL` then say `https://<domain>/v1`; without the rewrites the site's shell forwards the paths before anything loads (the open pixel alone cannot). A PostHog SDK with `api_host` set to the bare domain needs PostHog's eight paths rewritten too — optional, so not in the file; the deploy's notes say them. **Anywhere else**, `deploy/nginx/` is the site on nginx: a Dockerfile over `nginx:1.27-alpine` with the static build and the file's rules as a generated `location` per rule (`rewrites.inc.template`, filled from `SUPABASE_URL` at start), the fallback last — which hands an unmatched path to `@page` rather than straight to the shell, because that is where the crawler branch lives ([the prerender sidecar](/content/docs/building-a-site/dev-build-and-deploy)); a rule nginx implements its own way is left out of the generated include and says so (`NGINX_OWN` in rewrites.mjs — today the share pictures, which prerender.inc serves file-first and photographs with the sidecar, and rendering the rule twice would be a second `location ^~ /share/` and a refusal to start); `build/rewrites.test.mjs` builds and runs it in Docker against the local stack and proves each rule reaches its function. The deploy runs as the host's build. A push to `main` deploys, so **the push is a decision**: commit locally, and push when the change is meant to go live.
