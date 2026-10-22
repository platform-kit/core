# build-and-dev

## ADDED Requirements

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
