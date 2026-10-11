---
title: The content API, Contentful's
description: Every collection and model on a site served as Contentful's Delivery, Preview, GraphQL, Sync and Images APIs, and in cloud mode written through the Management API with its webhooks, under keys — an open-source Contentful any Contentful client reads and writes with the host swapped. The guide; the reference lists every route, argument and field.
order: 56.9
sources:
  [
    packages/kit/supabase/functions/content,
    packages/kit/supabase/functions/images,
    packages/kit/supabase/functions/_shared/api/context.js,
    packages/kit/supabase/functions/_shared/api/entry.js,
    packages/kit/supabase/functions/_shared/api/errors.js,
    packages/kit/supabase/functions/_shared/api/flags.ts,
    packages/kit/supabase/functions/_shared/api/graphql.js,
    packages/kit/supabase/functions/_shared/api/ids.js,
    packages/kit/supabase/functions/_shared/api/image-size.js,
    packages/kit/supabase/functions/_shared/api/keys.ts,
    packages/kit/supabase/functions/_shared/api/manage.ts,
    packages/kit/supabase/functions/_shared/api/management.js,
    packages/kit/supabase/functions/_shared/api/openapi.js,
    packages/kit/supabase/functions/_shared/api/pipe.ts,
    packages/kit/supabase/functions/_shared/api/query.js,
    packages/kit/supabase/functions/_shared/api/records.js,
    packages/kit/supabase/functions/_shared/api/richtext-to-markdown.js,
    packages/kit/supabase/functions/_shared/api/richtext.js,
    packages/kit/supabase/functions/_shared/api/types.js,
    packages/kit/supabase/functions/_shared/content-index.ts,
    packages/kit/supabase/functions/_shared/access.js,
    packages/kit/build/content-json.mjs,
    packages/kit/build/steps/content-json.mjs,
    packages/kit/build/content-api.test.mjs,
    packages/kit/supabase/schemas/85-api.sql,
    packages/movable-types/src/components/ApiAdmin.vue,
    packages/movable-types/src/pages/ApiReferencePage.vue,
    packages/movable-types/src/main.js,
    packages/kit/supabase/functions/_shared/content-ids.js,
    packages/kit/build/management.test.mjs,
    packages/kit/build/store/rows.mjs,
  ]
reviewed: 2026-10-11
---

A webhook subscription carries a **source**: one made through this API is `hand`, and one a deployment ships declared in `platformkit.config.js` is `file` and is replaced on every deploy.

## What it is

A site serves everything it publishes — every collection and every model, the kit's and the site's own — as **Contentful's Content Delivery API**, with the Preview API, the GraphQL Content API, the Sync API and the Images API beside it, exactly as Contentful shapes them. A client written for Contentful (`contentful.js`, the Gatsby, Next, Astro and Nuxt Contentful sources, `graphql-codegen`, a mobile app) points at the site instead of Contentful with the host swapped, and reads the same shapes — and, in cloud mode, writes through **Contentful's Content Management API** on the same routes under a management key (`contentful-management` with its `host` swapped), with Contentful's webhooks telling a subscriber of every publish.

**Two lines, not one**: the API answers under `/api` — `/api/content/spaces/<space>/…` — because `/spaces` on a site is the community's own address, and a path somebody navigates to cannot also be a rewrite at the host. Contentful's SDK has `basePath` for exactly this ("Path appended to the host to support gateways/proxies with custom urls"), so a client written for Contentful changes its host and adds `basePath: '/api/content'`, and nothing else.

The reference — every route, argument, operator, field, header and error — is [The content API reference](/content/docs/reference/contentful-api); this page is the guide.

```js
import { createClient } from 'contentful'
const client = createClient({
  space: 'northlight-press',
  accessToken: '<a delivery key>',
  host: 'northlight.example.com',
  basePath: '/api/content',
})
const { items, includes } = await client.getEntries({
  content_type: 'article',
  include: 2,
  order: '-sys.createdAt',
  limit: 10,
})
const book = await client.getEntry('book.the-quiet-room')
const types = await client.getContentTypes()
```

```sh
curl 'https://northlight.example.com/spaces/northlight-press/environments/master/entries?content_type=book&select=fields.title,fields.cover&include=1' -H 'Authorization: Bearer <key>'
curl 'https://northlight.example.com/content/v1/spaces/northlight-press/environments/master' -H 'Authorization: Bearer <key>' -H 'content-type: application/json' -d '{"query":"{ bookCollection { items { title cover { url } } } }"}'
```

The **space** is the site's slug (`api.space` in `platformkit.config.js` to choose another), the **environment** `master` and nothing else; Settings → **API** in the admin shows both, the base address, and the keys.

## The content types are what the admin knows

Every model with fields is a content type: the kit's collections (`article`, `book`, `wiki`, `doc`, `page`, `companion`, `product`, `collection`, `ad`, `experiment`, `session`, `site`, `storefront`) and every published model from the builder, under its singular in a `model` namespace (`modelTeacher`, `modelEvent`) — namespaced because a site may name a model `events` or `books` while the platform already has one, and two content types under one id would each mean whichever got there first. The fields come from the one description the admin draws its forms from, so a field added in the builder is on the API on the next build — in cloud mode on the next read, no build at all — in Contentful's types: a text is `Symbol` (a long one `Text`), a number `Number`, a switch `Boolean`, a date `Date`, a select `Symbol` with its choices as an `in` validation, tags and multi-selects `Array` of `Symbol`, a group `Object`, a list of groups `Array` of `Object`, a picture a `Link` to an Asset, a reference a `Link` to an Entry (an `Array` of them for several) carrying `linkContentType`, and a markdown field **Rich Text** — Contentful's document, made from the markdown by the site's own converter — with the markdown itself beside it as `<field>Markdown`. A model with a body has `body` and `bodyMarkdown`. `published` is never a field: an unpublished entry does not exist to the Delivery API.

An entry's `sys.id` is its content type and its path with `/` as `.` — `article.read-it-aloud`, `doc.guides.highlights` — stable across builds and unique across the space (a book and the product that sells it share a slug and differ in type). `sys.createdAt` is the record's `date`, else the first time it was checked in; `sys.updatedAt` the last time (in cloud mode its publish); `sys.revision` how many times.

## Assets and the Images API

Every file in the media library — both roots — is an Asset (`sys.id` a hash of its address), with `fields.file.url`, `fileName`, `contentType`, `details.size` and, for a picture, `details.image.width` and `height`. A picture named by a record that lives elsewhere (`image: https://…`) becomes an asset of its own whose url is that address, so a Link always resolves. For Delivery and GraphQL responses, an asset's `fields.file.url` is `/api/media/<space>/<assetId>/<hash>/<file>`; the Images function takes **Contentful's Images API** parameters: `w`, `h`, `fit` (`pad`, `fill`, `scale`, `crop`, `thumb`), `f` (the focus — `center`, `top`, `right`, `left`, `bottom`, the four corners; `face` and `faces` are taken as `center`), `fm` (`jpg`, `png`, `webp`, `gif`; `avif` is answered as `webp`), `q`, `r` (a corner radius, or `max` for a circle), `bg` (`rgb:rrggbb`). A transformed picture is made once (photon, Rust's image crate on wasm), kept in the `content-assets` bucket, and served with an `ETag` and a year's `Cache-Control`; the hash in the address changes when the file does. GraphQL's `url(transform: { width, height, format, … })` writes the same parameters.

## Keys, and what is public

Settings → **API** makes keys — a name, a kind, whether gated content is allowed — and shows each once. **Delivery** reads published content; **Preview** reads drafts (cloud mode) and unpublished entries too; **Management** writes (the section below) and reads every route in the Management shapes; with the modules on, **Forms**, **Scheduling**, **Storefront** and **Support** open [the Forms API](/content/docs/building-a-site/forms-api), [the Scheduling API](/content/docs/building-a-site/scheduling-api), [the Store API](/content/docs/building-a-site/store-api) and [the Support API](/content/docs/building-a-site/support-api). The key is made in the browser and only its sha256 is kept, so nothing but the site that uses it holds it; Revoke refuses it from that moment. By default **Delivery is public** (`api.public: false` in the config to close it): a request with no key reads published content, and — since a Contentful client always sends a token — a token that is not one of the site's keys reads as the public does, while a revoked key of the site's is refused. Every request counts against Contentful's rate limit (78 a second, 36 000 an hour, per key or address) with Contentful's headers.

The **paywall** holds on the API as on the site: an entry gated by `canAccess` lists with its title, description, picture and every plain field, and carries its body — `body`, `bodyMarkdown`, a markdown field — only for a key allowed gated content, never on a public request.

## Preview, GraphQL, Sync

The **Preview API** is the same routes under a preview key: every entry, published or not, and in cloud mode the draft version of a record over its live one. **GraphQL** is at Contentful's path, `/content/v1/spaces/<space>/environments/master`, POST or GET with `query`: a type per content type (`Article`, `ArticleCollection`, `ArticleFilter`, `ArticleOrder`, `ArticleBody { json links }`), `Asset`, `Sys`, `linkedFrom`, `entryCollection`, `assetCollection`, `preview` (a preview key, else `ACCESS_DENIED`), introspection for `graphql-codegen`, Contentful's complexity ceiling (11 000). **Sync** starts with `initial=true` and continues by `sync_token`, listing what changed and, for what is gone, `DeletedEntry` and `DeletedAsset` — from the repository's history in git mode, from the rows marked deleted in cloud mode.

## Writing: the Management API

In cloud mode (`CONTENT_STORE=cloud` — the content as rows, the [cloud mode](/content/docs/running-a-site/settings/cloud-mode) page) a site takes **Contentful's Content Management API** on the routes the Delivery API answers, under a key of kind **management** and nothing less: `contentful-management` works with `host` set to the site.

```js
import { createClient } from 'contentful-management'
const client = createClient({
  accessToken: '<a management key>',
  host: 'northlight.example.com',
  basePath: '/api/content',
})
const env = await (await client.getSpace('northlight-press')).getEnvironment('master')
let entry = await env.createEntryWithId('teacher', 'teacher.june-okafor', {
  fields: {
    name: { 'en-US': 'June Okafor' },
    line: { 'en-US': 'A visiting teacher of the long walk.' },
  },
})
entry.fields.line = { 'en-US': 'A teacher of the long walk.' }
entry = await entry.update() // X-Contentful-Version: a stale version is 409
entry = await entry.publish() // live at once, pushed to the repository
await entry.unpublish()
await entry.delete()
const upload = await env.createUpload({ file: bytes })
let asset = await env.createAssetWithId('portrait-june', {
  fields: {
    title: { 'en-US': 'June' },
    file: {
      'en-US': {
        contentType: 'image/png',
        fileName: 'june.png',
        uploadFrom: { sys: { type: 'Link', linkType: 'Upload', id: upload.sys.id } },
      },
    },
  },
})
asset = await asset.processForAllLocales()
await asset.publish()
```

**Every write is the admin's save.** Nothing on this door writes a row itself: a create or update goes to the same content pipe the admin function answers with (`_shared/api/pipe.ts` — the models, their fields and checks, the grammar), `by` the key's maker, and lands as a **draft** people never see; `PUT …/published` is the pipe's publish — live at once for the Delivery API, the site's pages and the search, and pushed to the repository as one commit, exactly as Content → Publishing does. An entry's id is `<type>.<path>`: `POST /entries` (`X-Contentful-Content-Type`) makes it from the record's `slug` field, else its title slugified; `PUT /entries/{id}` creates at an id or replaces the typed fields whole (a field left out is dropped; an empty array is omitted by the record writer rather than returned as `[]`; what the type does not know — the admin's own fields — is kept). A new entry is unpublished until published, as Contentful's is; `DELETE …/published` unpublishes (the record stays, Preview keeps it), `DELETE /entries/{id}` removes it and publishes the removal. `sys.version` is the row's revision × 2, plus one while a draft is pending; a write carrying a stale `X-Contentful-Version` is refused 409. The fields come by locale, a RichText field as a document or as its `<field>Markdown` twin (the twin wins — the reverse of the Delivery API's markdown → Rich Text), an Asset link naming a library file, an Entry link another entry; a field the type does not have is 422 `ValidationFailed` naming it, and so is a value the model's checks refuse.

**Uploads and assets.** `POST /spaces/<space>/uploads` takes a file's bytes (they last a day; `sweep_uploads` in pg_cron clears what was never processed); an asset is created from the upload (`uploadFrom`) or from a url (`upload`), then `PUT …/files/{locale}/process` puts the file in the media library at `content/uploads/api/<id>/<fileName>` — from then on it is an asset like any other, its `fields.file.url` on the Images API, its id the folder's. A delete while a record names it is refused 409, as the library refuses. In git mode every writing method answers 405 saying the content is files in a checkout: the admin's dev server writes there.

**Webhooks.** `POST /spaces/<space>/webhook_definitions` subscribes a url to topics (`Entry.create`, `Entry.save`, `Entry.publish`, `Entry.unpublish`, `Entry.delete`, `Asset.publish`, `Asset.delete`, `Asset.*`, `*.*`) with headers that ride on every delivery (a secret among them). The deliveries hang off the row store's own events, so a publish through the API and a person's publish in the admin reach the subscriber alike: a POST of the entry or asset in the Management shape under `X-Contentful-Topic: ContentManagement.<Type>.<event>` and `X-Contentful-Webhook-Name` — a build hook on Netlify, a search index, a cache, whatever a Contentful webhook would wake. A failure is kept on the definition (`lastError`) for the next event. Settings → **API** lists the definitions read-only — name, url, topics, active, the last delivery — the subscription itself is made and changed through the API alone.

## The reference at /api

The API documents itself. The `content` function answers `/openapi.json` (and `/content/v1/openapi.json`) with an **OpenAPI 3.1 document** generated from the same index the API answers from — every route of the Delivery, Preview, Management, GraphQL, Sync and Images APIs, of the analytics door, and — with their modules on — the Forms, Scheduling, Store and Support APIs (the site's own event shape and PostHog's wire), one schema per content type with its fields in Contentful's types, `content_type`'s choices the type ids, the site as the first server (the function's own address the second), the key as the security scheme, Contentful's error envelope on every route — so a new model or field is in the document on the next build, and in cloud mode on the next read. The site shows it at **`/api`** as an interactive reference on [Scalar](https://github.com/scalar/scalar) (MIT): the APIs as groups in the sidebar — **Content API** (Content Delivery, Content Sync, Content GraphQL, Content Images), with the forms module on **Forms API** (Forms, Responses, Webhooks, Insights — [the Forms API](/content/docs/building-a-site/forms-api)), with the sessions module on **Scheduling API** (Event Types, Slots, Bookings, Schedules, Scheduling Webhooks — [the Scheduling API](/content/docs/building-a-site/scheduling-api)), and **Analytics API** (Analytics Events, Analytics Capture), each tag's description saying what it is a drop-in for (Contentful, Typeform, cal.com, PostHog) once opened — every operation named for what it does ("List entries", "Get an image — resized, cropped, converted", "Capture events (/e/, /i/v0/e/, /capture/)"), the models after them, a curl and a client example per operation against the site's own address, "Test Request", search; in the site's light or dark as the page is, with a slim bar of the site's mark and a way back and none of Scalar's chrome (no toolbar, no theme switch, the support widget off the page). Settings → API links to it ("Read the reference"). The page is behind the `api` module with the rest, not prerendered (the document is fetched live) and `noindex`; its words are `api.md` `## reference`. `build/content-api.test.mjs` validates the document with `@scalar/openapi-parser`, under Node and as the function serves it.

## Where the content comes from

In **git mode** the `content-json` build step (`functions` phase; `node build/content-json.mjs` alone; `platformkit run content-json` for a local stack) writes `supabase/functions/_shared/content/index.json` — the models as the admin describes them, the content types, every record with its frontmatter, body and times, every asset with its size, the deletions — and the `content` function imports it, as it imports the catalog; gitignored like `dist`, made by the deploy before the functions go up. In **cloud mode** (`CONTENT_STORE=cloud`, which the deploy sets on the functions too) the function reads the models from the assembled pipe's registry, the records from `public.content` with their drafts and the assets from the bucket, kept in memory a minute — so a publish is on the API within a minute and nothing needs a build.

## The address

Three rewrites on the host beside the `/v1/*` one, above any catch-all: `/spaces/*` and `/content/v1/*` → `https://<ref>.supabase.co/functions/v1/content/…` (the whole path kept under the function: `/functions/v1/content/spaces/…`), `/api/media/*` → `…/functions/v1/images/images/*`; `deploy-checks` says so in its notes. Where the host has no rewrite the site's shell forwards the three paths to the functions before anything loads, so the API works either way; the function's own address answers too.

## What is not there, on purpose

Environments beyond `master` and environment aliases, tags and metadata, cross-space references, Location fields, face-aware crops and AVIF (the nearest is answered), comments, tasks, user management; environment and content-type writes (a model is the builder's), scheduled actions, bulk actions, the roles and teams. `build/content-api.test.mjs` (in `platformkit test`; `CONTENT_API_TEST=0` skips it) pins the index, the shapes, and — with the stack up — `contentful.js` against the served function, the keys, the paywall, preview, GraphQL, sync, the Images API decoded, the ETag and the rate limit, and — on the demo in cloud mode — `contentful-management` through the life of an entry and of an asset, the webhooks delivered for the API's and the admin's publish alike, the sweep; `build/management.test.mjs` pins the Management shapes under Node. The module switch is `api`.
