# Many sites, one host — tasks

## 1. The list of sites, read once

- [x] 1.1 `packages/kit/build/sites.mjs`: `sites(root)` — the root site (named by
  `PLATFORMKIT_ROOT_SITE`, absent when unset) and every directory under `sites/` holding a
  `package.json`, each with its name, its directory and its dist path; `PLATFORMKIT_SITES`
  narrows it; a name that is not a legal DNS label is refused by name.
  **Verified by** `build/sites-host.test.mjs`.
- [x] 1.2 `platformkit sites [--json]` in `bin/platformkit.mjs`, reading that one function.
  **Verified by** the command run in a checkout, and the test comparing it with the generator's list.

## 2. The host generator

- [x] 2.1 `packages/kit/build/hosts.mjs`: the sites and the mode in, the nginx server blocks out —
  one generator with two bodies (`proxy` and `files`), the host rule, the apex, the `www`
  redirect and the crawler branch shared between them.
  **Verified by** `build/sites-host.test.mjs`: three sites in both modes, snapshot compared.
- [x] 2.2 With `PLATFORMKIT_DOMAIN` unset it writes today's single-site `default.conf`, byte for
  byte. This is the condition the whole change is held to.
  **Verified by** the test diffing the generated file against the committed template's output.
- [x] 2.3 `PLATFORMKIT_APEX` names the bare domain's site; unset, a 404 block answers it; `www`
  always redirects.
  **Verified by** `build/sites-host.test.mjs`.
- [x] 2.4 A site with no `SUPABASE_URL_<SITE>` refuses the start, naming the site and the variable.
  **Verified by** `build/sites-host.test.mjs`.

## 3. The rewrites, per site

- [x] 3.1 `rewrites.mjs` writes `rewrites.<site>.inc` per site from `deploy/_redirects` and an
  optional `sites/<name>/_redirects`; `--check` holds them all.
  **Verified by** `rewrites.mjs --check` in `npm test`.
- [x] 3.2 Each server block includes its own; no block names another site's address.
  **Verified by** `build/sites-host.test.mjs`.

## 4. The image

- [x] 4.1 `deploy/nginx/Dockerfile` copies each site's `dist/` to `/srv/sites/<name>/`; the
  single-site path is unchanged when there is one site and no domain.
  **Verified by** a built image serving two sites, by hand.
- [x] 4.2 A new `/docker-entrypoint.d/30-hosts.sh` running the generator before nginx starts,
  after envsubst and before `40-prerender.sh`.
  **Verified by** the image starting in both arrangements.
- [x] 4.3 `docker-compose.yml`: the new variables, the certificate mount path, and the `proxy`
  mode's `extra_hosts: host.docker.internal`.
  **Verified by** `docker compose config` and a run.
- [x] 4.4 A certificate at the named path is used; absent, the image serves plain HTTP and says
  so once at start — the prerender sidecar's posture.
  **Verified by** a run each way.

## 5. Development

- [x] 5.1 `dev.mjs` writes `.platformkit/dev/<site>.port` on start and removes it on stop; the
  run's `VITE_APP_URL` is the site's hostname through the shared front-door port.
  **Verified by** the file appearing and going, and a magic link returning to the host.
- [x] 5.2 `config.toml` admits `http://*.localhost` in `additional_redirect_urls`.
  **Verified by** `build/sites-host.test.mjs`, and a sign-in through the workspace front door.
- [x] 5.3 A site in the list with no port file gets a page naming it and the command, not a 502.
  **Verified by** `build/sites-host.test.mjs` and by looking at it.
- [x] 5.4 `npm run dev` at the workspace root starts the front door automatically and routes every
  selected site through its own subdomain; it prints the chosen URLs and shared front-door port.
  **Verified by** `build/dev-workspace.test.mjs` and browser screenshots of two sites.
- [x] 5.5 Workspace startup discovers all selected site packages from the shared registry and
  starts one child Vite server per site without a manual port map; a site-local invocation still
  starts only that site. **Verified by** `build/dev-workspace.test.mjs` using multiple synthetic
  site packages and both invocation modes.
- [x] 5.6 Every backend-enabled site starts an isolated Supabase stack with dynamically allocated,
  non-conflicting service ports; backend-free sites start no stack, and no committed config is
  rewritten. **Verified by** `build/dev-workspace.test.mjs` and live status/API probes for two
  backend-enabled sites.
- [x] 5.7 Normal shutdown and partial startup failure stop only the child processes, Supabase
  stacks and front door created by that workspace run, and remove its port files and temporary
  configs. **Verified by** `build/dev-workspace.test.mjs` including a forced child-start failure.

## 6. The line held

- [x] 6.1 The test refuses a cookie set on a parent domain anywhere in the kit or the theme.
  **Verified by** `build/sites-host.test.mjs`.
- [x] 6.2 `build/sites-host.test.mjs` wired into `packages/kit/build/test.mjs`.
  **Verified by** `npm test` running it and failing when it fails.

## 7. The pages

- [x] 7.1 A guide under Running a site: the variable, the names, the apex, the certificate, and
  the development arrangement.
  **Verified by** `docs-check.mjs` — sources, coverage, exactness.
- [x] 7.2 Every new variable on the reference's environment page; `platformkit sites` on the CLI page.
  **Verified by** `docs-check.mjs` exactness, which compares the page with the code.
- [x] 7.3 Update the multiple-sites guide with the one-command workspace startup, automatic
  per-site Supabase and front-door port assignment, the backend-free site behavior, and shutdown
  cleanup. **Verified by** `node packages/kit/build/docs-check.mjs`.

## 8. Verify

- [x] 8.1 Two sites up in development, each signed into separately, neither session visible in
  the other. This is the reason the change exists.
  **Verified by** looking at both, signed in as different accounts at once.
- [x] 8.2 The single-site deployment unchanged: an image built with no domain serves exactly as
  before.
  **Verified by** the byte-for-byte test and a run.
- [x] 8.3 `npm test` green; the three lanes named.
  **Verified by** `npm test`.
