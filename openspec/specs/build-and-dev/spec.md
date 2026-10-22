# build-and-dev

## Purpose

The environment and the pipeline: the devcontainer as the one place the project is developed, `npm run dev` that never fights another project or reaches production, a build that compiles content then code then pages then pictures, the tests that hold every rule, and the git hooks that keep the store's objects and the content's formatting.

## Requirements

### Requirement: The devcontainer is the environment

Everything a script needs SHALL come from `.devcontainer/` (Node 22, ffmpeg, Chromium's libraries, docker-in-docker for Supabase) and `post-create.sh` (`npm ci`, the headless browser, the speech weights, `.env` from the example); nothing depends on the host — no Homebrew, no system Python, no path outside the repo.

#### Scenario: a new tool

- **WHEN** a script needs a binary the container lacks
- **THEN** it is added to the Dockerfile or post-create, never assumed on the host

Verified by: reading (by design)

### Requirement: `npm run dev` holds one port and one stack

`build/dev.mjs` SHALL read this project's stack from `supabase status` (starting it, or naming the other project's containers holding the ports and stopping), take the first port from 5173 up that nothing answers on (a connect probe) and hold it strictly, run vite with the app url and the stack's keys set for that run, and `supabase functions serve` on a generated `.env.dev`; a second Vite on another port shares `node_modules/.vite` and a dependency change stales every running one (restart them).

#### Scenario: two projects side by side

- **WHEN** another project's stack holds the ports `config.toml` names
- **THEN** `npm run dev` says which containers hold them and stops

Verified by: NOT VERIFIED by a pinned test — it needs two Supabase stacks up at once on one machine. Real, and deliberately not automated: the run would be slow, would fight whatever else holds the ports, and would leave containers behind when it failed.

### Requirement: The build is content, then code, then pages, then pictures

`npm run build` SHALL run, in cloud mode, the content export first (`content-export.mjs`, the rows out as files — `cloud-content`), then velite (clean; its markdown rendered through the theme's `marked` pipeline, the one renderer the browser uses for a row in cloud mode — `cloud-content`), then the `prepare` steps (the funnels compile, the sales report, the content embedding), then `vite build`, then the `site` steps (the form embed, the models' JSON, `build/prerender.mjs` — every public route to `dist/<route>/index.html` with `data-prerendered`, the share images and the favicon photographed first on the same browser, `sitemap.xml` when the site has a public address); `PRERENDER=0` skips the pages, `build:spa` is the plain build. The steps SHALL be the registry's (`build-steps`), the kit's and the site's alike.

#### Scenario: the routes

- **WHEN** `publicRoutes()` is read
- **THEN** it lists the landing pages, the library indexes and every published piece, and the store's pages only while the store is on

Verified by: `build/unpublished.test.mjs` — `publicRoutes()` asked in a child process either side of a change to what is published (the module registry caches `#content`, so asking twice in one process would answer from the first compile both times)

### Requirement: `npm test` holds every rule

`npm test` SHALL run, in order: product keys, the catalog, the emails, the funnels, the audience rules, the word test, the charts, the results sheet, the copy, the mechanism, the bank lint, the complexes, tailwind, the companions, the speech names, the chat model, the support grammar, the deploy checks, and `openspec validate --all --strict`. Three results-sheet cases fail under node for want of WebCrypto in loro and the bank lint reports content findings — both known, neither a regression.

It SHALL additionally run the three deployment shapes as **distinct lanes**, so that a shape is exercised rather than assumed:

- **static** — a site built with no Supabase in the environment, prerendered, served, and every route visited with the console and the network watched: every page renders, nothing logs an error, and nothing asks a backend for anything.
- **git** — the suite above, over a checkout with a backend.
- **cloud** — the demo over rows with nothing that rebuilds: a draft save moves no projection, a publish moves every one, and what the functions read comes from the rows rather than the shipped file.

A lane SHALL be skipped only with a note saying why, never deleted, and a skipped lane SHALL be reported rather than pass in silence.

#### Scenario: a rule changes

- **WHEN** any pinned behaviour changes
- **THEN** its test fails before the change is reported

Verified by: `npm test`

#### Scenario: the three lanes

- **WHEN** `npm test` runs
- **THEN** each lane runs and reports, and a failure names the shape it failed in

Verified by: `build/modes.test.mjs` and the lane runners it drives

#### Scenario: the static lane over more than the docs site

- **WHEN** the static lane runs
- **THEN** it covers both a site with every module off and a site with the library on and every row-backed module off, since the second is the shape most sites of this kind take

Verified by: the static lane, over `sites/docs` and a library fixture

#### Scenario: a heavy lane

- **WHEN** a lane is too slow for the default run
- **THEN** it is skipped with a note naming what is not covered, and reported at the end of the run

Verified by: `build/modes.test.mjs`

### Requirement: The hooks

Husky SHALL own `core.hooksPath`: `pre-commit` runs lint-staged (Prettier over `content/{articles,wiki,docs}/**/*.md` only — never `content/app` or `content/books`), `pre-push`, `post-checkout` and `post-merge` hand off to Git LFS so the audio store's objects travel with a push.

#### Scenario: a push of recordings

- **WHEN** recordings are committed and pushed
- **THEN** the LFS objects go with the pointers and a clone checks out whole

Verified by: NOT VERIFIED here — it needs Git LFS and a remote to push to. The hook that makes it work (`.husky/pre-push` handing off to `git lfs`, since Husky owns `core.hooksPath`) is the whole of it, and its absence took a deploy down once.

### Requirement: The scripts, each one thing

Each script under `build/` SHALL do one thing, say it at the top, and be runnable alone: `catalog.mjs`, `emails.mjs`, `funnels.mjs`, `chat-email-strings.mjs` (what the functions carry), `product-keys.mjs` and `statement-keys.mjs` (identities given once), `sales.mjs`, `embed-content.mjs`, `share-images.mjs`, `prerender.mjs`, `print.mjs`, `tts.mjs`, `enrich.mjs`, `vapid.mjs`, `auth-config.mjs`, `deploy-checks.mjs`, `deploy.mjs`, `phone-probe.mjs`, `models.mjs`, `steps.mjs` (the runner), the `*-io.mjs` grammars shared with the admin, and the `*.test.mjs` pins. A script the build runs SHALL also be declared as a step in `build/steps/`, and the declaration — not the script — SHALL say where and when it runs.

#### Scenario: a new script

- **WHEN** a script is added that the build should run
- **THEN** its header says what it does and how it is run, it is declared as a step, and if it pins a rule it joins `npm test`

Verified by: reading; `build/steps.test.mjs` refuses a step whose module is missing

### Requirement: The deploy runs in one order

`build/deploy.mjs` SHALL: refuse unless the guards and the environment checks pass; assemble; link; apply the plan; in cloud mode run the content export (`content-export.mjs`: the rows written out as files, a pending edit winning, a newer commit written back — `cloud-content`); run the `prepare` and `functions` steps (the strings, emails and funnels the functions carry; the printed books; the catalog; the printer's webhook); deploy the functions; set the auth config and the function secrets; run the `after` steps (the offers pushed to Stripe, the funnels' runner told where it lives, the spoken books when `TTS=1`); then build the site (the `site` steps). The spine — the guards, assemble, link, the plan, the functions' deploy, the secrets — SHALL stay the deploy's own; everything else SHALL be a step.

#### Scenario: a failed step

- **WHEN** any step exits non-zero
- **THEN** the deploy stops there and the site is not built

Verified by: the Render log (observed); `build/steps.test.mjs` for the runner; `deploy-checks --test` for the guard

### Requirement: Placement in PlatformKit

**Module switch:** —.

**Layers.** core: dev, build, test, the hooks, the scripts, the deploy order. site: its own build steps and tests.

**Extension points this needs:** the CLI wrapping every script; `build.after` and `build.tests` from the config; the psychometric tooling (`bank.lint`, `resonance`, `complexes`, `affinity`, `raters`, `copy.test`, `results.test`) moved to the site's tests.

**What the kit's module leaves to its comparable, on purpose:** —.

This capability SHALL land in the layers above, SHALL be switched by its module, and SHALL expose the extension points named; a site SHALL keep its side as registrations, never as patches.

#### Scenario: a site test

- **WHEN** a site test
- **THEN** it runs in `platformkit test` after the kit's

Verified by: the kit's CI against the demo, and the representative site fixture remains visually unchanged after the change

### Requirement: The default site can be selected by path

When a command runs from the Core repository root, `PLATFORMKIT_DEFAULT_SITE` SHALL accept either a site name or a path to a site directory. An explicit `--site` selection SHALL take precedence. With neither provided, the default site SHALL be the tracked documentation site at `sites/docs`.

#### Scenario: choose a site by path
- **WHEN** `PLATFORMKIT_DEFAULT_SITE` names a valid site directory
- **THEN** root-level PlatformKit commands use that site
- **Verified by**: `packages/kit/build/site-repositories.test.mjs`

#### Scenario: explicit site overrides the default
- **WHEN** both `--site` and `PLATFORMKIT_DEFAULT_SITE` are provided
- **THEN** the command uses the explicit `--site` value
- **Verified by**: `packages/kit/build/site-repositories.test.mjs`

#### Scenario: use the documentation site by default
- **WHEN** a root-level command has no explicit site selection and no `PLATFORMKIT_DEFAULT_SITE`
- **THEN** it uses `sites/docs`
- **Verified by**: `packages/kit/build/site-repositories.test.mjs`

### Requirement: Core runtime state does not create a hidden project directory

PlatformKit SHALL keep transient development, asset, and database-shadow state in the conventional `node_modules/.cache/platformkit` cache and SHALL NOT create a `.platformkit` directory in the Core repository. The external-site checkout directory MAY be ignored, but the generic tracked sites SHALL remain part of the Core repository.

#### Scenario: start and stop development
- **WHEN** PlatformKit starts and stops a local development run
- **THEN** its run records, port records, and generated runtime files are held in the conventional cache and no `.platformkit` directory is created
- **Verified by**: `packages/kit/build/dev-workspace.test.mjs`

#### Scenario: use the database shadow and asset cache
- **WHEN** a build needs a database shadow or cached assets
- **THEN** the transient data is stored under the conventional cache rather than `.platformkit`
- **Verified by**: `packages/kit/build/schema.test.mjs` and `packages/kit/build/assets.test.mjs`

### Requirement: Restarting the dev command always works

A dev run SHALL take its servers down with it however it ends — Ctrl+C, a kill, a closed terminal, or its parent disappearing — and a new run SHALL stop whatever an earlier run of the same checkout left behind (site servers, function servers, the front door), saying what it stopped, before starting. It SHALL never signal a process or container it cannot prove belongs to this checkout's dev runs, and a living run attached to a terminal SHALL still refuse a second.

#### Scenario: a closed terminal, then a new start

- **WHEN** a workspace run's terminal is closed and `npm run dev` is run again
- **THEN** the first run's servers and front door are already gone or are stopped by the new run, which names them, and the new run starts

Verified by: `build/dev-workspace.test.mjs` (SIGHUP and SIGKILL of the parent, an abandoned run taken over); the closed tab itself by hand, NOT VERIFIED by a pinned test

#### Scenario: a port held by something else

- **WHEN** a port a run would use is held by a process that is not this checkout's dev run
- **THEN** that process is not signalled, and the run moves to a free port or stops with the existing message

Verified by: `build/dev-workspace.test.mjs`

#### Scenario: two live runs

- **WHEN** a run of this checkout is alive in a terminal and another is started
- **THEN** the second is refused as today

Verified by: `build/dev-workspace.test.mjs`

### Requirement: Local development can use separately fetched sites

Workspace development SHALL discover registered site checkouts fetched from their own repositories, alongside any local site fixtures explicitly kept by PlatformKit. A fetched site SHALL behave as a site selected by its declared name, without being tracked as PlatformKit source. The workspace SHALL report registered sites that have not yet been fetched rather than silently omitting them.

#### Scenario: Start a fetched site

- **WHEN** `platformkit dev` starts with a registered site checked out at its pinned revision
- **THEN** the site is available by its declared local name and receives the same isolated development setup as other selected sites

Verified by: `packages/kit/build/dev-workspace.test.mjs` and `packages/kit/build/site-repositories.test.mjs`

#### Scenario: A registered site has not been fetched

- **WHEN** the workspace lists sites and a registered site has no local checkout
- **THEN** the listing identifies it as not fetched and provides the fetch command instead of implying it is running

Verified by: `packages/kit/build/site-repositories.test.mjs`

### Requirement: Workspace commands use a configurable default site

When a PlatformKit site command or root npm site shortcut runs from the workspace root, it SHALL select the site named by `PLATFORMKIT_DEFAULT_SITE`, defaulting to `docs` when unset. The selected site MAY be a local `sites/<name>` directory or a fetched managed checkout. An explicit `--site <path>` selection and execution from within a site directory SHALL take precedence. An unfetched registered default SHALL fail with the command needed to fetch it. The workspace development command SHALL use the default site unless `PLATFORMKIT_SITES` explicitly selects a multi-site set.

#### Scenario: The workspace default is unset

- **WHEN** a site command runs from the workspace root without `PLATFORMKIT_DEFAULT_SITE`
- **THEN** it runs against the local `docs` site

Verified by: `packages/kit/build/workspace-root.test.mjs`

#### Scenario: A local or fetched site is selected

- **WHEN** `PLATFORMKIT_DEFAULT_SITE` names a local site or a fetched managed checkout
- **THEN** root CLI commands and root npm site shortcuts run from that site directory

Verified by: `packages/kit/build/workspace-root.test.mjs`

#### Scenario: Explicit and multi-site selection take precedence

- **WHEN** `--site <path>` is supplied, or `PLATFORMKIT_SITES` explicitly names multiple sites for workspace development
- **THEN** the explicit selection is honored instead of the default site

Verified by: `packages/kit/build/workspace-root.test.mjs` and `packages/kit/build/dev-workspace.test.mjs`

#### Scenario: A registered default has not been fetched

- **WHEN** `PLATFORMKIT_DEFAULT_SITE` names a registered checkout that is absent locally
- **THEN** the command refuses to run and prints `platformkit sites fetch <name>`

Verified by: `packages/kit/build/workspace-root.test.mjs`

### Requirement: The workspace development root lists its selected sites

When the workspace development server is running, its unqualified local front-door host SHALL show a directory with one card for each selected site package. Each card SHALL display that site's resolved homepage Open Graph image and a project title from optional `dev.projectName`, falling back to the site directory name when unset or blank. The complete card SHALL link to the site's named `.localhost` origin on the same front-door port, and SHALL NOT display the SEO description or a separate open-site action. The directory SHALL reflect the `PLATFORMKIT_SITES` selection when one is set.

#### Scenario: Open the workspace root during development

- **WHEN** the workspace development front door is running with multiple selected sites and a developer opens its unqualified local host
- **THEN** the directory shows one uniformly sized image-and-title card per selected site, using its resolved homepage Open Graph image and configured project name (or directory name fallback), with the whole card linking to that site's named local origin and no description or separate action

Verified by: `packages/kit/build/dev-workspace.test.mjs`; screenshots at 1280px and 390px

#### Scenario: Select a subset of workspace sites

- **WHEN** `PLATFORMKIT_SITES` selects only some site packages
- **THEN** the directory lists only those selected sites and each card links to the corresponding named local origin

Verified by: `packages/kit/build/dev-workspace.test.mjs`

#### Scenario: Production keeps its configured apex behavior

- **WHEN** the production host configuration is generated without an apex site
- **THEN** the unqualified host retains its existing 404 behavior and does not serve the development directory

Verified by: `packages/kit/build/sites-host.test.mjs`

### Requirement: Development servers use predictable public ports

Single-site development and the workspace development front door SHALL use port 3000 by default. If that requested public port is unavailable, the server SHALL fail with a clear port-conflict error instead of silently choosing another port. Automatic public-port selection SHALL require an explicit `auto` option. Ports used only for the workspace's internal site Vite servers MAY be allocated automatically.

#### Scenario: Start a single-site development server with defaults

- **WHEN** a developer starts a single-site development server without a port option and port 3000 is available
- **THEN** the site listens on port 3000

Verified by: `packages/kit/build/dev.test.mjs`

#### Scenario: The default single-site port is occupied

- **WHEN** a developer starts a single-site development server without a port option and port 3000 is occupied
- **THEN** startup fails with an error identifying the requested port and does not silently select another port

Verified by: `packages/kit/build/dev.test.mjs`

#### Scenario: Explicitly request automatic single-site port selection

- **WHEN** a developer starts a single-site development server with `--port:auto`
- **THEN** the server selects and reports an available port

Verified by: `packages/kit/build/dev.test.mjs`

#### Scenario: Start the workspace front door with defaults

- **WHEN** a developer starts workspace development without a front-door port option and port 3000 is available
- **THEN** the directory and every named site origin are served through the front door on port 3000 while internal site Vite ports are allocated for the selected sites

Verified by: `packages/kit/build/dev-workspace.test.mjs`

#### Scenario: Workspace front-door port is occupied

- **WHEN** a developer starts workspace development without a front-door port option and port 3000 is occupied
- **THEN** startup fails with an error identifying the requested port and does not silently select another public port

Verified by: `packages/kit/build/dev-workspace.test.mjs`

#### Scenario: Explicitly request automatic workspace front-door port selection

- **WHEN** a developer starts workspace development with `--front-door-port:auto`
- **THEN** the directory and every named site origin use the same available front-door port, which is reported at startup

Verified by: `packages/kit/build/dev-workspace.test.mjs`

### Requirement: Workspace development reuses stable site-specific Supabase projects

Each site's development configuration SHALL allow the developer to set the complete stable Supabase project ID with `dev.projectId`. If it is unset, the default SHALL be `pk_<site-folder-or-subdomain>_local`. Direct and workspace development SHALL use the same resolved project ID. Different site folders/subdomains SHALL have distinct defaults. A run identifier SHALL NOT be included in the project ID.

#### Scenario: Restart a workspace site

- **WHEN** a site is started in workspace development on multiple runs
- **THEN** its local Supabase project ID remains the same and its stack is reused

Verified by: `packages/kit/build/dev-workspace.test.mjs`

#### Scenario: Run multiple workspace sites

- **WHEN** two or more sites are selected for workspace development
- **THEN** each site's local Supabase project ID is stable and distinct from the others, and each site keeps its own stack

Verified by: `packages/kit/build/dev-workspace.test.mjs`

#### Scenario: Override a site's Supabase project ID

- **WHEN** a developer sets `dev.projectId` in that site's `platformkit.config.js`
- **THEN** direct and workspace development use that exact stable project ID and do not append a per-run identifier

Verified by: `packages/kit/build/dev-workspace.test.mjs`

### Requirement: Developers can stop PlatformKit-managed dev processes safely

The kit SHALL provide a `platformkit stop` command that stops PlatformKit-managed dev server process groups and the associated local Supabase projects for the current workspace. Dev runs SHALL record enough ownership information for the stop command to identify their processes and projects without relying on broad process-name matching. The command SHALL NOT signal unregistered processes or remove Supabase database volumes or Docker images. It SHALL be safe to run repeatedly and SHALL report what it stopped and any managed run it could not stop.

#### Scenario: Stop active workspace dev services

- **WHEN** `platformkit stop` is run in a workspace with active managed dev services
- **THEN** its registered site servers and workspace front door stop, and the local Supabase projects associated with those site runs stop

Verified by: `packages/kit/build/dev-stop.test.mjs`

#### Scenario: Stop when no managed dev services are running

- **WHEN** `platformkit stop` is run with no active managed dev services
- **THEN** it exits successfully, reports that there is nothing to stop, and leaves unrelated processes and Supabase projects untouched

Verified by: `packages/kit/build/dev-stop.test.mjs`

#### Scenario: Stop is run more than once

- **WHEN** `platformkit stop` is run again after all managed services have stopped
- **THEN** it exits successfully without signaling a process whose recorded PID has exited or been reused

Verified by: `packages/kit/build/dev-stop.test.mjs`

### Requirement: A dev server is reachable by its site's name

When `PLATFORMKIT_DOMAIN` is set, `platformkit dev` SHALL write the run's `VITE_APP_URL` as
`http://<site>.<PLATFORMKIT_DOMAIN>:<front-door-port>` rather than as a Vite port address, and
SHALL record the Vite port it took where the host generator can read it
(`.platformkit/dev/<site>.port`), removing it when the server stops. The workspace front door SHALL
route that hostname to the site's Vite port with the HMR websocket passed through and response
buffering off. A site in the list whose dev server is not running SHALL be answered by a page naming
the site and the command that starts it, rather than by a bare gateway error.

**Intent.** A magic link, a checkout return, the Stripe mock's landing and the auth server's
redirect all follow `VITE_APP_URL`; every one of them must come back to the host the browser is
actually on, or the session is lost. The Vite and shared front-door ports are not known until the
servers are up, so neither can be configured in advance.

#### Scenario: the link comes back to the host

- **WHEN** `PLATFORMKIT_DOMAIN=localhost npm run dev` runs in `sites/demo`
- **THEN** `VITE_APP_URL` for the run is `http://demo.localhost:<front-door-port>`, and a magic link
  sent from that run returns to the same host and port

Verified by: by hand against the local stack, once per change to the dev server

#### Scenario: the local auth server accepts the host

- **WHEN** the local stack starts
- **THEN** `additional_redirect_urls` in `config.toml` admits `http://*.localhost` on the
  automatically selected front-door port as well as the existing localhost port patterns

Verified by: `build/sites-host.test.mjs` and a sign-in through the workspace front door

#### Scenario: a site that is not running

- **WHEN** `docs.localhost` is asked for and no dev server has written `docs.port`
- **THEN** the answer is a page naming the site and the command, not a 502

Verified by: `build/sites-host.test.mjs`

### Requirement: Workspace development starts every selected site with isolated automatic ports

When `platformkit dev` runs at the workspace root, it SHALL discover every site through the
workspace site registry and start all selected sites in one invocation. Unless narrowed by
`PLATFORMKIT_SITES`, the selected list SHALL include the named root site and every site package
under `sites/`. Each site's Vite server SHALL receive a distinct automatically selected port and
the one development front door SHALL receive an automatically selected available host port; the
command SHALL print each site's hostname and usable URL. No per-site port map SHALL be required.

For every site whose resolved deployment shape has `backend: true`, workspace development SHALL
start a separate Supabase stack with non-conflicting host ports for all configured services,
provide that stack's API URL and keys only to that site's Vite and functions processes, and keep
runtime port configuration outside the committed site files. A site with `backend: false` SHALL
run without a Supabase stack. Starting dev from an individual site directory SHALL continue to
start only that site.

#### Scenario: one command starts the workspace

- **WHEN** `npm run dev` runs at a workspace root containing the named root site and multiple
  registered site packages
- **THEN** every selected site is reachable by its own subdomain through the automatically
  allocated front-door port, and each backend-enabled site uses its own running Supabase stack

Verified by: `build/dev-workspace.test.mjs` with multiple synthetic sites and a browser run across
the root site and at least one backend-enabled workspace site

#### Scenario: backend ports do not collide

- **WHEN** two or more selected sites each declare `backend: true` and their source Supabase
  configurations use the same default ports
- **THEN** workspace development assigns each stack non-conflicting ports without modifying the
  committed `supabase/config.toml`, and each app and functions process talks only to its own stack

Verified by: `build/dev-workspace.test.mjs` and a local-stack probe of each site's API URL

#### Scenario: a backend-free site joins the workspace

- **WHEN** a selected site declares `deployment.backend: false`
- **THEN** its Vite server is started and routed by the front door without starting Supabase for it

Verified by: `build/dev-workspace.test.mjs` with backend-enabled and backend-free sites

#### Scenario: workspace shutdown or startup failure

- **WHEN** the workspace dev process receives a stop signal or any child fails during startup
- **THEN** it stops the front door, all child Vite and functions servers, and every Supabase stack it
  started, and removes its runtime port files and temporary configuration

Verified by: `build/dev-workspace.test.mjs` by exercising normal shutdown and a failed child start

### Requirement: The list of sites is read in one place

The sites a checkout holds SHALL be read by one function in the kit, used by the host generator,
the dev server and the rewrites step alike, and exposed as `platformkit sites`.

**Intent.** Three readings of a directory tree is how two of them come to agree and the third
does not.

#### Scenario: one list

- **WHEN** `platformkit sites --json` runs in a checkout
- **THEN** it names every site under `sites/` and the root site, with each one's directory, and
  the host generator's own list is identical to it

Verified by: `build/sites-host.test.mjs`
