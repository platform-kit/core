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
