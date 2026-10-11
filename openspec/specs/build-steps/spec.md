# build-steps

## Purpose

Every piece of work the build does beyond compiling the content and the bundle — the search embedding, the sales report, the compiled emails and funnels, the printed books, the catalog, the spoken books, the form embed, the models' JSON, the prerender — is a build step: a record that says where it runs, what it follows, what module it belongs to, when it applies, what it reads and what it needs; the kit declares its own and a site or a theme declares more the same way, and one runner runs them. The spoken books are one step, not a special case.

## Requirements

### Requirement: A build step is a record

A build step SHALL be a module exporting one record: `key` (unique), `title`, `phase` (`prepare` — after the content is compiled, in dev, build and deploy; `functions` — what the functions carry, before they are deployed; `site` — the bundle and the pages; `after` — once the functions are live, deploy only), `after` (the keys it must follow, in its phase), `module` (off with it), `when` (a function of the environment, or absent), `inputs` (globs of what it reads), `needs` (`env`: variables; `tools`: commands on the path; `packages`: the npm packages its `run` imports), and `run({ site, env, changed, log })`. The kit SHALL declare its own steps this way — embed-content, sales, funnels, emails, the chat's strings, print, catalog, the printer's webhook, auth-config, push-catalog, the funnels' runner, tts, form-embed, analytics-sdk (the drop-in script to `dist/analytics.js`), content-json (the published content of every collection and model, and the assets, rendered beside the functions for the content API), the models' JSON, prerender — in one list, and a step's script SHALL stay runnable alone as it is today.

#### Scenario: the kit's steps

- **WHEN** `platformkit steps` runs on a site
- **THEN** every kit step is listed with its phase, whether it is on (and if off, why: its module, its `when`), and what it needs; the spoken books show `off — TTS is not 1` on a site without it

Verified by: `build/steps.test.mjs` (the list, the reasons); the command on a site and the demo

### Requirement: One runner, in phases, by `after`

`build/steps.mjs` SHALL take a phase and run its steps that are on in an order that respects every `after`, refusing a cycle or an `after` naming a step it does not have, saying each step's title as it starts, and stopping the run at the first step that fails; `platformkit build` SHALL run `prepare` then `site`, the deploy SHALL run `prepare`, `functions`, then its own spine, then `after`, then `site`, and the dev plugin SHALL run `prepare` after velite and again for any `prepare` step whose `inputs` matched a changed file. The runner SHALL never skip a step on its own account: a step that can tell its work is done says so itself.

#### Scenario: the order

- **WHEN** a phase holds steps with `after` edges
- **THEN** they run in an order that respects every edge, and two steps with no edge between them keep the declaration's order

Verified by: `build/steps.test.mjs`

#### Scenario: a failed step

- **WHEN** a step throws or exits non-zero
- **THEN** the run stops there, naming the step, and nothing after it runs

Verified by: `build/steps.test.mjs`; the demo build with a step made to fail

### Requirement: A site or a theme registers steps

A site SHALL register steps in `platformkit.config.js` as `build.steps`, a list of modules, and a theme in its manifest as `steps`; they SHALL run in their phase among the kit's, ordered by `after`, gated by `module` and `when` the same way, and listed by `platformkit steps` the same way. A site's step SHALL NOT need to be named anywhere else.

#### Scenario: the demo's step

- **WHEN** the demo is built
- **THEN** its own step (registered in its config) runs in its phase and writes its file into `dist`, and `platformkit steps` lists it beside the kit's

Verified by: the demo's build; `build/steps.test.mjs` over a fixture config

### Requirement: A step brings its own packages

A step's packages SHALL be the package of whoever declares the step: a site's or a theme's step names them in that package's `package.json` as ordinary dependencies; the kit's steps whose packages are heavy and module-bound — the spoken books' runtime, encoder and ffmpeg; print's Typst, sharp and Playwright; the emails' mjml — SHALL be optional peers of the kit (`peerDependenciesMeta`), installed by the site that switches the module on, and imported by `run` lazily so a site without them never loads them. `npm test`, `platformkit steps` and `deploy-checks` SHALL resolve every on step's `needs.packages` from the site's root and refuse a missing one naming the step and the package.

#### Scenario: a module on without its packages

- **WHEN** a site switches `tts` on without `onnxruntime-node` in its `package.json`
- **THEN** `npm test` refuses naming the spoken books and the package, and the docs site, with `tts` off, installs none of them

Verified by: `build/steps.test.mjs` (the resolution against a fixture root); `npm ls` on the docs site

### Requirement: The deploy asks for what the steps need

`deploy-checks` SHALL read `needs` off every step that is on for the deploy and ask for each `env` variable it names (with the step as the reason), for each `tool` on the path and for each `package` resolvable from the site, beside its own rules; a step that is off SHALL ask for nothing.

#### Scenario: the spoken books

- **WHEN** `TTS=1` is set and `SUPABASE_SERVICE_ROLE_KEY` is not, or ffmpeg is not on the path
- **THEN** the deploy is refused naming the spoken books as the reason; with `TTS` unset neither is asked for

Verified by: `deploy-checks --test`
