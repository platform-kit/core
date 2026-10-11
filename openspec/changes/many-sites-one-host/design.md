# Many sites, one host — design

## The shape of it

One variable, `PLATFORMKIT_DOMAIN`, and everything else follows from the tree. Unset, every
generated file is what it is today. Set, the nginx image is handed a list of sites and writes one
`server` block per site; development proxies each to its vite server, production serves each from
its own root. The two differ in what a server block points at and in nothing else, which is the
point: the same generator, the same host rule, one argument.

---

## D1. One variable, not three

**Decision: `PLATFORMKIT_DOMAIN` alone turns it on, and its value IS the parent domain.**

A boolean `MULTITENANT=1` beside a `DOMAIN=` would be two things to get wrong — the obvious bug
is the flag on with no domain, and nginx booting with `server_name demo.` It cannot happen if
the domain is the switch. The absent value is the off state and needs no name.

Rejected: a `sites.json` manifest. The directory tree already says which sites exist, and a
second list is a second thing that goes stale. The manifest exists in exactly one case —
`PLATFORMKIT_ROOT_SITE`, below — because the root site genuinely has no directory name.

## D2. The directory is the name

**Decision: a site under `sites/<name>` is `<name>.<domain>`; nothing is read from
`package.json`, `content/site.md` or a title.**

The kit already names a site by its directory everywhere (`platformkit dev` takes the site from
`process.cwd()`), and a subdomain has a character set a title does not. A name is validated
against `^[a-z0-9]([a-z0-9-]*[a-z0-9])?$` and a directory that fails it is refused by name
rather than silently skipped — a site missing from the host list with no message is the kind of
fault somebody debugs for an hour.

**The root site is the exception and is named outright.** The repository root is a site with no
directory name of its own, so `PLATFORMKIT_ROOT_SITE=<name>` gives it one. Unset, the root site
is simply not in the list — which is right for a checkout where the root is a customer's site
being extracted and not something to publish beside the demo.

## D3. Which site answers the bare domain

**Decision: `PLATFORMKIT_APEX=<site>` names it; unset, the bare domain serves nothing.**

Not "the first site", not "the root site" — both are guesses, and a wrong guess here means the
domain somebody typed shows them a site they did not want. With it unset the bare domain and
`www` get a 404 from a server block that exists and says so, rather than falling through to
whichever block nginx happened to define first (which is what `server_name _` would do, and is a
genuinely confusing failure).

`www.<domain>` always redirects to the apex site's own host rather than serving it, so there is
one address per site and no duplicate-content question.

## D4. Development proxies; production serves files

**Decision: one template with two bodies, picked by `PLATFORMKIT_SITES_MODE` (`proxy` | `files`,
default `files`).**

In development a site must stay on its vite server: HMR, the module graph and the admin's dev
middleware all live there, and serving a `dist/` would mean building on every keystroke. So the
block is a `proxy_pass` to `http://host.docker.internal:<port>` with `Upgrade`/`Connection`
passed through for the HMR websocket, and `proxy_buffering off` so vite's streamed responses are
not held.

In production there is no vite, so the block is `root /srv/sites/<name>` with the same cache
rules, the same rewrites include and the same prerender branch the single-site template has
today.

The two bodies are in one generator rather than two templates, because the host rule, the apex
redirect, the `www` rule and the crawler branch must not drift between them — and they would,
the first time one was edited.

## D5. Workspace development is one command

**Decision: `npm run dev` at the workspace root is the orchestrator; a dev command run inside an
individual site remains single-site.**

The root command reads the same `sites()` registry as the host generator, starts one child dev
process for every selected site, waits until their runtime port records are ready, and starts one
development front door. `PLATFORMKIT_SITES` may narrow the workspace set; absent that filter, the
named root site and every package under `sites/` are included. Each child keeps the existing
first-free-port behavior and writes `.platformkit/dev/<site>.port`; the front door proxies the
hostname to that Vite server with HMR working.

The orchestrator also chooses an available host port for the shared front door and supplies the
resulting URL to every site's `VITE_APP_URL`. The port records are all in place before the front
door starts, so its first generated configuration includes the whole workspace.

Rejected: asking the user to launch several terminals and remember which port belongs to which
site. That makes the multi-site host a manual map rather than a workspace feature.

## D6. The rewrites are per site, and that is a correctness requirement

**Decision: `deploy/_redirects` becomes `deploy/_redirects` (the default) plus an optional
`sites/<name>/_redirects`, and `rewrites.mjs` writes `rewrites.<site>.inc` per site.**

Every rewrite proxies to `${SUPABASE_URL}`, which is per site. One shared include would send the
demo's content API to the docs' project — and because both would answer 200 with plausible JSON,
nothing would notice until somebody read the data. The include is therefore named by the site
and the server block includes its own, so there is no arrangement in which a site can reach
another's backend by accident.

The per-site env (`SUPABASE_URL_<SITE>`) is resolved by the entrypoint, and a site with none is
refused before nginx starts, with the variable's name in the message — the same rule
`deploy-checks.mjs` already applies to a deploy.

## D7. The app is told its own host

**Decision: each site receives `VITE_APP_URL=http://<site>.<domain>:<front-door-port>` in
workspace mode, and its Vite port is never exposed as the public origin.**

This is the whole reason the change is worth anything in development: a magic link, a checkout
return, the Stripe mock's landing and the auth server's redirect all use `VITE_APP_URL`, and all
of them must come back to the host the browser is actually on or the session is lost. Since the
front-door port is selected at runtime, the local auth redirect allow-list must accept site
subdomains on that port.

## D8. What this change is NOT

**It is not multi-tenancy in the database.** Each site keeps its own Supabase project exactly as
it does now; nothing here introduces a tenant column, a shared schema or row-level separation by
host. This is hosting several *sites* from one checkout and one web server, which is a different
thing wearing a similar word, and conflating them would be the expensive mistake.

**It is not a control panel.** There is no UI, nothing is registered at runtime, and a site
appears because a directory exists.

**It does not issue certificates.** Development needs none. Production mounts the operator's
`*.<domain>` certificate at a path the compose file names, and if it is absent the image serves
plain HTTP and says so once at start — the same posture the prerender sidecar takes.

## D9. Supabase is isolated per backend-enabled site, with runtime-only port assignments

**Decision: the workspace runner creates a temporary Supabase work directory for each site whose
resolved shape enables a backend, allocates a distinct set of free ports, and starts the CLI
against that directory.**

The runtime configuration is derived from that site's assembled Supabase declaration but is
written only under `.platformkit/dev/`; its functions and other runtime inputs point back to the
site's assembled tree. The source `supabase/config.toml` remains untouched. Each run uses the
site's identity as its local project identity, and the API URL, anon key, service-role key and
functions environment are scoped to that site's child process. Sites declaring `backend: false`
do not get a stack. This preserves the standalone docs and brochure shapes while allowing any
number of backend-enabled sites to run without hand-assigned port ranges.

The runner starts sites in a controlled sequence, records each assigned port set, and tears down
only the stacks it started. If a child or the front door fails, it stops the remaining children
and removes temporary config and port records before reporting the failure.

Rejected: editing committed config files in place or relying on a fixed port offset. Both make
parallel projects fragile; fixed offsets also fail as the number of sites grows.

---

## Risks

**A site in the tree that is not meant to be published.** `sites/brochure` exists to prove the
static lane's console watch works and has no business on a production host. The list is
therefore filterable (`PLATFORMKIT_SITES=demo,docs`) and the default in production is that
explicit list rather than the whole tree — present everything in development, publish only what
is named.

**Cookie scope.** A cookie set on `.<domain>` is readable by every site under it. Nothing in the
kit sets one today (the session is in `localStorage`, which is per origin and therefore already
separate), but it is the trap this arrangement lays, and the spec says a cookie is set on the
site's own host and never on the parent.

**`localhost` subdomains.** Chrome, Firefox and Safari resolve `*.localhost` to the loopback
without a hosts file; some Linux resolvers do not. The failure is clean (the name does not
resolve) and the message says to add the line, so it is documented rather than worked around.
