# deploy

## ADDED Requirements

### Requirement: Several sites answer on one host, each on its own subdomain

When `PLATFORMKIT_DOMAIN` is set the web server SHALL serve every named site on
`<site>.<PLATFORMKIT_DOMAIN>`, one server block per site, generated from the sites the checkout
holds rather than from a list anybody maintains. A site under `sites/<name>` SHALL be named
`<name>`; the repository root site has no directory name and SHALL be named by
`PLATFORMKIT_ROOT_SITE` or left out. A name that is not a legal DNS label SHALL be refused by
name before the server starts, never skipped silently.

With `PLATFORMKIT_DOMAIN` unset — the default — every generated file SHALL be byte-identical to
what the single-site deployment produces today, and the one site SHALL answer on `server_name _`
as it does now.

`PLATFORMKIT_SITES` SHALL narrow the list to the sites named, so a fixture site in the tree
(`sites/brochure`) is never published by existing.

**Intent.** Two sites on one origin share `localStorage`, the Loro store, the session and the
service worker, so a sign-in on one shows on the other. Separate hosts is the only thing that
separates them.

#### Scenario: the default is unchanged

- **WHEN** the nginx image starts with `PLATFORMKIT_DOMAIN` unset
- **THEN** `/etc/nginx/conf.d/default.conf` is byte-identical to the file the single-site image
  writes today, and the site answers on any host

Verified by: `build/sites-host.test.mjs` — the generator run both ways over the same tree

#### Scenario: three sites, three hosts

- **WHEN** the image starts with `PLATFORMKIT_DOMAIN=platformkit.com`, `PLATFORMKIT_SITES=demo,docs`
  and `PLATFORMKIT_ROOT_SITE=brochure`
- **THEN** there is a server block for each of `demo.platformkit.com`, `docs.platformkit.com` and
  `brochure.platformkit.com`, each with its own root, and a request for `brochure.platformkit.com`
  reaches none of them

Verified by: `build/sites-host.test.mjs`, and by hand against a built image

#### Scenario: a name that cannot be a subdomain

- **WHEN** a directory under `sites/` is named with a character a DNS label cannot carry
- **THEN** the entrypoint refuses to start, naming the directory and the rule

Verified by: `build/sites-host.test.mjs`

### Requirement: The bare domain is named, never guessed

`PLATFORMKIT_APEX` SHALL name the site that also answers the bare domain. `www.<domain>` SHALL
redirect to that site's own host rather than serving it, so one site has one address. With
`PLATFORMKIT_APEX` unset the bare domain and `www` SHALL be answered by a server block that
returns 404, never by whichever site's block was defined first.

**Intent.** A wrong guess here shows somebody a site they did not ask for, from the address they
are most likely to type.

#### Scenario: no apex named

- **WHEN** `PLATFORMKIT_DOMAIN` is set and `PLATFORMKIT_APEX` is not
- **THEN** a request to the bare domain gets 404 from a block that exists, and no site's block
  answers it

Verified by: `build/sites-host.test.mjs`

#### Scenario: www

- **WHEN** `PLATFORMKIT_APEX=demo` and a request arrives for `www.<domain>`
- **THEN** it is redirected to `demo.<domain>`, not served

Verified by: `build/sites-host.test.mjs`

### Requirement: A site never reaches another site's backend

Each site SHALL have its own rewrites include, generated from its own `_redirects` and filled
with its own `SUPABASE_URL`, and a site's server block SHALL include only its own. A site in the
list with no Supabase address SHALL be refused before the server starts, with the variable's
name in the message.

**Intent.** Every rewrite proxies to `${SUPABASE_URL}`. One shared include would send one site's
content API to another's project, and because both answer 200 with plausible JSON nothing would
notice until somebody read the data.

#### Scenario: two sites, two projects

- **WHEN** two sites are served with different `SUPABASE_URL` values
- **THEN** each site's `/api/content` proxies to its own project, and neither block names the
  other's address

Verified by: `build/sites-host.test.mjs`

#### Scenario: a site with no backend named

- **WHEN** a site is in `PLATFORMKIT_SITES` and its `SUPABASE_URL` is unset
- **THEN** the entrypoint exits non-zero naming the site and the variable, and nginx does not start

Verified by: `build/sites-host.test.mjs`

### Requirement: A cookie belongs to its site, never to the parent domain

Nothing the kit sets SHALL set a cookie on `.<PLATFORMKIT_DOMAIN>`; a cookie SHALL be set on the
site's own host alone.

**Intent.** A cookie on the parent is readable by every site under it, which undoes the
separation this whole arrangement exists for. Nothing sets one today — the session is in
`localStorage`, which is already per origin — so this is a line held before it is crossed.

#### Scenario: no cookie on the parent

- **WHEN** the kit's source is searched for a cookie whose domain attribute names a parent
- **THEN** there is none

Verified by: `build/sites-host.test.mjs`
