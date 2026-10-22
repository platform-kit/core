---
title: File map
description: Where things are — in a site, in the kit, in the theme — and the handful of places that are generated rather than written.
order: 84
sources:
  [
    packages/kit/package.json,
    packages/kit/theme/src/theme.js,
    package.json,
    packages/kit/bin/platformkit.mjs,
    packages/kit/build/sites.mjs,
    packages/kit/build/runtime-paths.mjs,
    packages/kit/build/assets.mjs,
    packages/kit/build/plan.mjs,
    packages/kit/build/dev-directory.mjs,
    packages/kit/build/dev-stop.mjs,
    packages/kit/build/dev-workspace.mjs,
    packages/kit/build/hyperswitch-test-stack.mjs,
    packages/kit/build/hyperswitch-v2-test.compose.yml,
  ]
reviewed: 2026-10-22
---

## A site

The workspace-root `package.json` coordinates shared scripts, including the opt-in Hyperswitch v2
Docker test stack. Its runner and Compose override are in `packages/kit/build/`; neither is part of
an individual site's manifest or production deployment.

```
platformkit.config.js          the config
index.html                     the shell, the fonts, the icon links
vite.config.js, velite.config.js, src/main.js    two lines each
src/looks/<name>.css           the palette(s)
src/components/landing/        the site's own sections and skins (optional)
src/components/<Name>.vue      overrides (optional)
src/admin/                     registered admin sections (optional)
src/instrument/                a site's readings (optional)
content/
  site.md                      the site record
  strings/<lang>/site.md       the nav and the CTA
  app/ui/<scope>.md            UI strings (only what the site changes)
  app/tests/**                 a site's tests (optional)
  app/**/results.md            a site's results copy (optional)
  pages/*.md                   landing pages
  articles/, wiki/, docs/      the prose collections
  books/*.md (+ covers)        the books
  companions/*.md              the companions
  books/files/<slug>/          extra downloads
  ads/, experiments/           calls to action and A/B tests
  forms/*.md                   the forms (forms.md documents)
  store/storefront.md, store/products/, store/collections/, store/print.json
  sessions/*.md                the coaching offers
  emails/<kind>.json, emails/policy.md
  funnels/*.md, blasts/*.md
  uploads/                     the library's Uploads root — every picture and file the admin puts in (under the collection's folder: books/, articles/, …), addressed /uploads/<path>; public/ is its other root
db/
  schemas/*.sql                the site's declared schema
  data.sql                     the site's idempotent rows
  functions/<name>/            the site's edge functions
  seed.sql                     the site's seed rows
supabase/                      ASSEMBLED (committed outside the monorepo; never edited)
  config.toml                  the site's own, from the kit's template
  schemas/, data.sql, functions/, seed.sql
audio/books/<slug>/            the spoken books (LFS) and their manifests
public/                        robots.txt, pictures, sw.js (push); print/ and static/ are generated
build/                         the site's own tests and scripts
openspec/                      specs and changes
.velite/                       generated: the compiled content
node_modules/.cache/platformkit/ generated: dev runtime records, downloaded assets, and the plan's shadow project
sites/external/                ignored separately owned site checkouts; platformkit.sites.json holds their remote pins
```

## The kit — `packages/kit`

The kit includes `@opencoredev/social-sdk` as the execution dependency for direct and managed Social provider adapters; Social accounts, grants, schedules and delivery records remain owned by the site's Supabase project.

```
bin/platformkit.mjs            the CLI (including workspace dev, sites and stop); the root package exposes it through npx GitHub source
vite/index.mjs                 the Vite plugin (+ tailwind.config.js)
src/lib/                       the libraries: content, auth, router, strings, commerce, shipping, chat, support, desk (staff inbox adapters), forms (parse, logic, screens, validate, markdown, condition, api), tts, speech, print-offers, experiments, analytics, look, seo, push, records, markdown (the one document renderer), strings-groups and search-rows (the grammars the build and the browser share), entry and content-live (cloud mode's adapter and live layer)…
src/sdk/                       the analytics core the site and the drop-in share (core: the fingerprint id, the session, the queue; posthog: PostHog's surface over it; entry: the script's root)
vendor/formsmd/                the separable parts of forms.md (Apache-2.0; NOTICE), with their tests
src/instrument/                the runner's mechanics: the session, the timing, the voice
build/                         every script: assemble, plan, destructive, cron reconciliation, dev, dev-directory, dev-stop, dev-workspace, deploy, deploy-checks, test, velite, strings-io, content-rules, functions-data (the thirteen JSON files the functions import, made before they are served) (whether a record’s fields make sense together, thrown from velite’s prepare so an incoherent declaration fails the build), catalog, emails, funnels, funnel-io, forms, form-io, form-embed, analytics-sdk, analytics-config, rewrites (the host's rewrite rules from deploy/_redirects → dist/_redirects and the nginx template), content-json (the content index for the content API), models, model-io, steps (the runner; steps/ the kit's nineteen records), companion-io, quiz-io, print/*, tts/*, enrich, llm, briefs, voice, prerender, share-images, phone-probe, sales, embed-content, admin-server, admin-pipe (the admin's requests as one function, shared with the admin Edge Function), admin-schemas, store/ (the content store: git.mjs the checkout, rows.mjs the database), content-export (cloud mode's rows out as files), assets (an address resolved to its file), migrate-assets (pictures beside records moved into the library, once), site, theme, content-node, site-*-node, and the tests
supabase/
  schemas/NN-<module>.sql      the declared schema
  data.sql                     the rows that are not schema
  functions/<name>/, functions/_shared/   (the admin function; _shared/github.js the push; _shared/pipe/ the content pipe assembled for it; _shared/access.js the class ladder the app and the functions share; _shared/posthog-wire.js PostHog's wire protocol read into the door's rows, _shared/content-index.ts the content the API answers from in either mode, _shared/api/ the content API's shapes — ids, types, records, entry, query, richtext, context, graphql, keys, errors, flags, openapi (the OpenAPI document) — and the Management API's: management.js (the shapes, the record from an entry, the versions and ids), richtext-to-markdown.js, manage.ts (the writes, the uploads, the webhook definitions, the deliveries, the sweep), pipe.ts (the content pipe for a door); _shared/api/typeform/ the Forms API's (definition, response, query, insights, errors, document — a definition to a forms.md document, JSON Patch), _shared/api/shopify/ the Store API's (products — the offers as Shopify's products, schema — the Storefront SDL and its resolvers, cart), _shared/forms-live.ts the forms from the rows in cloud mode, _shared/api/cal/ the Scheduling API's (event-type, booking, schedule, webhook, envelope), _shared/scheduling-events.ts its deliveries — _shared/vendor/ photon's wasm for the images function; _shared/content/ the built index, gitignored)
  seed.sql                     the accounts
  config.toml.template
```

## The theme — `packages/kit/theme`

```
src/theme.js                   the manifest, including optional theme-owned module declarations
src/main.js                    the entry: the forward, the theme, cloud mode's content loaded, then app.js
src/app.js                     the app: the css, the look, the session, the mount
src/App.vue, router.js         the shell and the route switch
src/layouts/SiteLayout.vue     the header, the footer, the veils
src/pages/                     Landing, Content, Store, Diagnostics, Call, Admin (the one desk: the CMS, or the live views in production), ApiReference (/api: Scalar over the OpenAPI document), Book (/book/<slug>: the booker on its own page, for cal.com's embed), Preview, Share
src/components/                everything else: content/, landing/ (+ skins), admin/, chat/, support/, store…
src/instrument/ui/             the runner's screens, the results shell and its pages
src/content/ui/<scope>.md      the default strings
src/looks/design.css           the one design
src/looks/default.css          the theme's own palette, worn by a site that registers none
```

## Generated, never edited

`supabase/` in a site (assembled), `.velite/`, `public/static/`, `public/print/`, `dist/`, `.print/`, `node_modules/.cache/platformkit/`, the thirteen files the Edge Functions import (`supabase/functions/_shared/{catalog,analytics,cloud,webhooks,bots,commands,spaces,teams,forms}.json`, `_shared/content/index.json`, `_shared/emails/{compiled,funnels,strings}.json` and `cal-webhook/strings.json` — all made by `build/functions-data.mjs` before anything serves or deploys them, and none of them committed, since a generated file in git is a second source of truth and two of these had quietly drifted from the content), `content/store/print.json` (written by the print build and committed), `build/.cache/` (the enrichment's cache), and every `id` and `key` a writer gives a record.
