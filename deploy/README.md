# Serving this

The canonical page is [Hosting and the rewrites](../sites/docs/content/docs/building-a-site/hosting-and-rewrites.md) on the docs site; this file is the short form beside the configurations.

Two things the server has to do that a static file host does not do by default.

## The rewrites — one file

[`_redirects`](_redirects) is the one list of what this site needs from its host beyond serving `dist/`: the rewrites to
the project's Edge Functions (the content API at Contentful's paths, the Scheduling API at cal.com's, the functions on
the site's domain at `/v1/*`) and the app for every other path. It is Netlify's format — `source destination status`,
`:splat` the rest of a path, 200 a rewrite — with `$SUPABASE_URL` standing for the project's address, and it is the only
place the rules are written:

- **Netlify** takes the file as it is: the `rewrites` build step writes `dist/_redirects` with `$SUPABASE_URL` filled
  from `VITE_SUPABASE_URL`, and the publish directory is `dist`.
- **Render** takes the same lines typed into Redirects/Rewrites — action Rewrite, in this order, above any catch-all —
  with the address filled in.
- **nginx** (`nginx/`) is generated from it.

`node packages/kit/build/rewrites.mjs --check` (in `npm test`) refuses a rule a module on this site needs and the file
lacks, one for a module that is off, an order a first-match host would get wrong, or a missing fallback — and an nginx
template that differs from the file. Then set `PUBLIC_FUNCTIONS_URL` and `VITE_PUBLIC_FUNCTIONS_URL` to
`https://<domain>/v1` so the emails and the client write the addresses that way; without the rewrites the site's shell
forwards the paths before anything loads (the open pixel alone cannot come back through it).

## nginx, for any host

`nginx/` is the site on nginx: a Dockerfile on `nginx:1.27-alpine` that copies `dist/` and the templates —
`default.conf.template` (the server: the static build, immutable caching for the bundle's hashed files),
`functions-proxy.inc.template` (how a rewrite reaches the functions: the project's host as the Host header, SNI, the
forwarding headers) and `rewrites.inc.template`, generated from `_redirects` by `packages/kit/build/rewrites.mjs` (a
`location` per rule, the app's fallback last; never edited by hand). nginx's own image fills them from the environment
at start: `SUPABASE_URL`, the project's address under the same name the file uses (`15-supabase-host.envsh` derives the
Host header from it). A prerendered page is served as it is (`dist/<route>/index.html`), any other route is the shell,
always 200.

    npm run build
    docker build -f deploy/nginx/Dockerfile -t site .
    docker run -p 8080:80 -e SUPABASE_URL=https://<ref>.supabase.co site

or `SUPABASE_URL=https://<ref>.supabase.co docker compose -f deploy/nginx/docker-compose.yml up --build`.
`packages/kit/build/rewrites.test.mjs` (in `npm test`) builds the image on a stand-in `dist/` and runs it in Docker
against the local stack, proving each rule reaches its function and every other path the app.

## Send index.html for every route

The app owns its routes in the browser, so a route is not a file. Every path has to
serve `dist/index.html` and let the app read it; without that, a refresh or a direct
link to any page is a 404. `apache/htaccess-root` does it for Apache. Other hosts:

- **Netlify** — `_redirects` with `/* /index.html 200`.
- **Vercel** — `rewrites` in `vercel.json`.
- **Cloudflare Pages** — a `_redirects` SPA rule.
- **nginx** — `nginx/` here, with the rewrites (`try_files $uri $uri/index.html /index.html;` is the fallback).

## Tell Supabase where the site is

The auth emails (sign-up confirmation, magic link) end at Supabase's verify endpoint, which
then redirects to the app — but only to an address it has been told about, else to its
Site URL, which a new project is born with as `http://localhost:3000`. The deploy sets both
(`build/auth-config.mjs`: Site URL = `VITE_APP_URL`, and `VITE_APP_URL/**` on the redirect
list — and "Confirm email" off, since confirmation is the app's own magic link) through the management API, with the same `SUPABASE_ACCESS_TOKEN` and
`SUPABASE_PROD_REF` it already needs, and then proves it by reading the verify endpoint's
redirect. To do it without a deploy:

    SUPABASE_ACCESS_TOKEN=… SUPABASE_PROD_REF=… VITE_APP_URL=https://site.example node build/auth-config.mjs

The CLI's `config.toml` values are for the local stack and are not pushed.
