# content-api

## Purpose

Every collection and model a site publishes, served as Contentful's APIs — Delivery, Preview, GraphQL, Sync, Images, and in cloud mode the Management API with its webhooks — under keys, so a Contentful client reads and writes with the host swapped; the OpenAPI document and the reference page that describe the whole surface.

## Requirements

### Requirement: The content is Contentful's Delivery API

A site SHALL serve every published entry of every collection and every published model as Contentful's Content Delivery API at `<domain>/api/spaces/<space>/environments/master` — `entries`, `entries/<id>`, `assets`, `assets/<id>`, `content_types`, `content_types/<id>`, `locales`, `sync` — in Contentful's shapes: a collection as `{ sys: { type: 'Array' }, total, skip, limit, items, includes }`; an entry as `{ sys, fields }` with `sys.id` (the content type's id and the entry's path — `article.read-it-aloud` — stable across builds, the same in both content modes and unique across the space), `sys.type`, `sys.createdAt`, `sys.updatedAt`, `sys.revision`, `sys.locale`, `sys.space`, `sys.environment` and `sys.contentType` as a Link; an asset with `fields.title`, `fields.description` and `fields.file` (`url`, `fileName`, `contentType`, `details.size`, `details.image.width` and `height` for a picture); a link as `{ sys: { type: 'Link', linkType, id } }` resolved into `includes.Entry` and `includes.Asset` to the depth `include` asks (0–10, 1 by default), an unresolvable one listed under `errors` as Contentful lists it. A collection SHALL take `content_type`, `select`, `include`, `locale` (a code or `*`), `order` (fields and `sys` attributes, `-` for descending), `limit` (1–1000, 100 by default), `skip`, `query` (full text), `sys.id[in]`, and on any field `fields.<f>` with `[eq]` (bare), `[ne]`, `[in]`, `[nin]`, `[exists]`, `[lt]`, `[lte]`, `[gt]`, `[gte]`, `[match]`, `[all]`; `links_to_entry` and `links_to_asset`; on assets `mimetype_group`. Every answer SHALL carry an `ETag` and answer `If-None-Match` with 304, `Cache-Control` the host's CDN honours, and Contentful's rate-limit headers; errors SHALL be Contentful's envelope `{ sys: { type: 'Error', id }, message, details, requestId }` with its ids (`NotFound`, `BadQuery`, `InvalidQuery` — an unknown content type among them, named in `details` — `AccessTokenInvalid`, `AccessDenied`, `RateLimitExceeded`). A space id or an environment other than the site's SHALL be `NotFound`. Nothing unpublished SHALL exist to the Delivery API.

The API SHALL answer under **`/api`** and never under `/spaces`, which is the community's own address: a path a reader navigates to cannot also be a rewrite at the host. A client SHALL reach it through the SDK's own `basePath` and no other change — `createClient({ space, accessToken, host, basePath: '/api' })` — and the shell's forwarding, for a host that has not declared the rewrite, SHALL follow the same paths.

#### Scenario: the community's address is not the API's

- **WHEN** `/spaces/the-practice` is requested of the site
- **THEN** the app answers, never the content API — whether or not the host has declared the rewrite

Verified by: `content-api.test.mjs` and `rewrites.test.mjs` (the served rules: `/spaces/<space>` answered by the app)

#### Scenario: the official client, one host changed

- **WHEN** `contentful.js` is created with `{ space: <the site's space>, accessToken: <a delivery key>, host: <the site> }` and asks `getEntries({ content_type: 'article', include: 2, order: '-sys.createdAt', limit: 5, skip: 5 })`, `getEntries({ 'fields.tags[in]': 'craft' })`, `getEntries({ query: 'reading' })`, `getEntry(<an article's id>)`, `getAsset(<its picture's id>)`, `getContentTypes()`, `getLocales()`
- **THEN** each answers as Contentful would — the totals, the second page's five, the author and the picture in `includes`, the tagged articles, the searched ones, the one entry and asset, every content type with its fields, the locales — and the client's own link resolution (`resolveResponse`) fills `fields.author` and `fields.image` with the included records

Verified by: `content-api.test.mjs` running `contentful.js` against the served function on the demo

#### Scenario: a Contentful source, unchanged

- **WHEN** a Next.js page written for Contentful's Delivery API (a fetch of `entries?content_type=book&select=fields.title,fields.cover&include=1`) is pointed at the site
- **THEN** it renders the books with their covers from the response alone, nothing in it changed but the host and the keys

Verified by: `content-api.test.mjs` fetching that query and asserting the shape field for field against a fixture taken from Contentful's documentation

#### Scenario: every operator

- **WHEN** `fields.title[match]=quiet`, `fields.difficulty[in]=beginner,intermediate`, `fields.date[gte]=2026-09-01`, `fields.cover[exists]=false`, `fields.tags[all]=attention,rest`, `links_to_entry=<a book's id>` (its companion) and `links_to_asset=<a picture's id>` (the entries that use it) are asked one at a time
- **THEN** each returns exactly the entries the rule admits, recomputed from the index in the test; an operator a field's type does not take answers `InvalidQuery`

Verified by: `content-api.test.mjs`

#### Scenario: a link that cannot be resolved

- **WHEN** an entry links to an entry that is unpublished or gone
- **THEN** the link stands in `fields`, the target is absent from `includes`, and `errors` names it as `notResolvable`, as Contentful does

Verified by: `content-api.test.mjs` — the shared shaping over a record given a link to nothing, and a real link resolved beside it

#### Scenario: cached and rate-limited

- **WHEN** a collection is fetched twice with the first answer's `ETag` in `If-None-Match`, and then a hundred and twenty times at once
- **THEN** the second fetch is 304 with no body, and past the limit the answer is 429 `RateLimitExceeded` with `X-Contentful-RateLimit-Reset` saying when

Verified by: `content-api.test.mjs`

### Requirement: Content types are what the admin knows about every model

The Delivery API SHALL describe every collection the site has on and every published site model as a Contentful content type — `sys.id` the type's id, `name`, `description`, `displayField`, and `fields` each with `id`, `name`, `type` (`Symbol`, `Text`, `RichText`, `Integer`, `Number`, `Date`, `Boolean`, `Object`, `Link`, `Array`), `localized`, `required`, `disabled`, `omitted`, `validations` (a select's choices as `in`, a rule's bounds) and for a Link its `linkType`, for an Array its `items` — derived from the one description the admin draws its forms from, so a field added to a model in the builder is on the API on the next read with no code. A markdown body SHALL be a `RichText` field holding Contentful's document, with the markdown beside it in a `Text` field of the same name suffixed `Markdown`; a picture or a file field a `Link` to an Asset; a reference a `Link` to an Entry (an Array of them for several); a tag list an Array of Symbol; a group an Object. An entry's fields SHALL be exactly its content type's, in the type's order; a field the record leaves empty SHALL be absent, as Contentful leaves it.

#### Scenario: a site's own model on the API

- **WHEN** the demo's `teachers` model (a name, a role as a select, a portrait, a markdown body) and its `events` model (a markdown field, a reference to a teacher) are read through `content_types/teacher`, `content_types/event` and their entries
- **THEN** the types list those fields with their Contentful types and the select's choices as a validation, and an entry's markdown is a Rich Text document whose paragraphs are the markdown's with the markdown beside it, the portrait a Link to an Asset in `includes`, the teacher a Link to the teacher's entry

Verified by: `content-api.test.mjs` on the demo (the demo's teachers carry portraits in the library)

#### Scenario: a field added in the builder

- **WHEN** an administrator adds a field to a model in the builder and saves
- **THEN** the content type on the API carries it on the next read, and an entry given a value shows it, with nothing built or deployed in cloud mode

Verified by: the demo in cloud mode, by hand (no pinned test); the build path by the test above

### Requirement: Assets are the library, and every asset URL takes the Images API

Every file in the site's media library — both roots, the bucket in cloud mode — SHALL be an Asset of the Delivery API, and every asset's `fields.file.url` SHALL be an address on the site that takes Contentful's Images API: `w`, `h` (the size, the aspect kept unless `fit` says otherwise), `fit` (`pad`, `fill`, `scale`, `crop`, `thumb`), `f` (the focus: `center`, `top`, `right`, `left`, `bottom`, the four corners; `face` and `faces` taken as `center`), `fm` (`jpg`, `png`, `webp`, `gif`; `avif` answered as `webp`), `q` (1–100), `r` (a corner radius, or `max`), `bg` (`rgb:` a hex colour, for `pad`); a transformed picture SHALL be cached for a year and served with an `ETag`. An asset SHALL be gone from the API when the file is gone from the library.

#### Scenario: a picture resized

- **WHEN** an asset's URL is fetched with `?w=400&h=300&fit=fill&f=top&fm=webp&q=70`
- **THEN** the answer is a 400 × 300 WebP, the top of the picture kept, under `Cache-Control: public, max-age=31536000, immutable`; the same URL with `fm=avif` is a WebP of the same size; `w=0` or `q=200` is `BadQuery`

Verified by: `content-api.test.mjs` decoding the answer's dimensions and format

### Requirement: The Preview API answers drafts under a preview key

The same routes SHALL answer as Contentful's Preview API when the key is a preview key: every entry, published or not, and in cloud mode the draft version of a record over its live one, each with `sys.updatedAt` the draft's time; a delivery key or no key asked for a draft SHALL see the published content alone. A preview key SHALL be refused nothing a delivery key is allowed.

#### Scenario: a draft on the Preview API

- **WHEN** an article is edited and saved but not published in cloud mode, and its entry is fetched with a preview key and then with a delivery key
- **THEN** the preview answer carries the draft's title, the delivery answer the live one; an entry set `published: false` is on the preview answer and absent from the delivery one

Verified by: the demo in cloud mode, by hand (no pinned test); the unpublished entry by `content-api.test.mjs` on the demo

### Requirement: GraphQL is Contentful's, generated from the content types

The site SHALL serve Contentful's GraphQL Content API at `<domain>/api/content/v1/spaces/<space>/environments/master` (POST, and GET with `query`): a schema generated from the content types — a type per content type with its fields in GraphQL's types (`RichText` as Contentful's `{ json, links }`), `Asset`, `Sys`, `ContentfulMetadata`, a `<type>Collection` per type with `limit`, `skip`, `where` (Contentful's filter fields: `_exists`, `_in`, `_not_in`, `_contains`, `_gt` and the rest), `order` (an enum of the sortable fields), `locale` and `preview`; a `<type>(id:)` single; `linkedFrom` on an entry; `assetCollection`; `__schema` introspection so `graphql-codegen` works; errors in GraphQL's shape with Contentful's `extensions.contentful.code`; a query over Contentful's complexity limit refused with `TOO_COMPLEX_QUERY`.

#### Scenario: a codegen client

- **WHEN** `graphql-codegen` introspects the endpoint and a query `{ articleCollection(limit: 3, order: date_DESC, where: { tags_contains_some: ["craft"] }) { total items { sys { id } title body { json } image { url width } } } }` is posted with a delivery key
- **THEN** the schema introspects with `Article`, `ArticleCollection`, `ArticleFilter`, `ArticleOrder`, `Asset` and `Sys`, and the query answers three articles with their Rich Text json and their picture's URL

Verified by: `content-api.test.mjs` posting the introspection query and the query above against the served endpoint

#### Scenario: preview through GraphQL

- **WHEN** a query says `preview: true` with a delivery key, and again with a preview key
- **THEN** the first is refused `AccessDenied` as Contentful refuses it, the second answers with the drafts

Verified by: `content-api.test.mjs` (the refusal); the drafts by hand in cloud mode

### Requirement: Sync gives what changed since

`sync?initial=true` SHALL answer every published entry and asset with a `nextSyncUrl`, and `sync?sync_token=<token>` SHALL answer what changed since that token — entries and assets changed as themselves, entries and assets removed as `DeletedEntry` and `DeletedAsset` with their `sys.id` and the time — paged with `nextPageUrl` and ending with a new `nextSyncUrl`; `type` (`Entry`, `Asset`, `Deletion`, `DeletedEntry`, `DeletedAsset`) and `content_type` narrow an initial sync as Contentful allows.

#### Scenario: a sync after a removal

- **WHEN** a sync is started, an entry is then unpublished (or its file removed) and another edited, and the `nextSyncUrl` is fetched
- **THEN** the answer holds the edited entry and a `DeletedEntry` for the removed one and nothing else, and a second fetch of the new `nextSyncUrl` holds nothing

Verified by: `content-api.test.mjs` on the demo — a deletion in the repository's history synced under a token from before it, nothing under a fresh one; the cloud path by hand

### Requirement: Keys open the doors, and Delivery may be public

An administrator SHALL make keys in the admin — each with a name and a kind (**Delivery**: published content; **Preview**: drafts and unpublished entries; **Management**: writes, for the management change), and whether it may read gated content — see the key once at its making and never again, see when each was last used, and revoke any; a revoked key SHALL be refused `AccessTokenInvalid` from that moment. A site SHALL say whether Delivery is public (it is by default): public, a request with no key is served as a delivery key that may not read gated content; not public, `AccessTokenInvalid`. The Preview API and GraphQL's `preview` SHALL need a preview key. A gated entry (`canAccess` beyond guest) SHALL list with its `sys` and its plain fields for everyone, and carry its body fields only for a key allowed gated content — never on a public request. Every request under a key SHALL count against that key's rate limit, a public request against its address's.

#### Scenario: keys made and revoked

- **WHEN** an administrator makes a delivery key and a preview key on Settings → API, reads with each, then revokes the delivery key
- **THEN** the page shows the key once with a copy control and never again; each key's row shows its kind and its last use after the read; the revoked key answers `AccessTokenInvalid` and the other still reads

Verified by: `content-api.test.mjs` making and revoking keys as the page does (the key's sha256 in `api_keys`) and reading with them; screenshots of the API page (the list, the new-key form, the one-time reveal), both themes, 1280 and 390

#### Scenario: gated content

- **WHEN** a book gated to members is fetched with no key, with a delivery key not allowed gated content, and with one that is
- **THEN** the first two answer the entry with its title, description and cover and no body fields; the third the whole book

Verified by: `content-api.test.mjs` on the demo

#### Scenario: Delivery made private

- **WHEN** the site's config says Delivery is not public
- **THEN** a request with no key answers `AccessTokenInvalid`; where it is public, a token that is not one of the site's keys reads as the public does (a Contentful client always sends one) and a revoked key of the site's is refused

Verified by: `content-api.test.mjs` (the public site: the foreign token, the revoked key); the private site by hand on the demo with `api.public: false` assembled (no pinned test)

### Requirement: Placement in PlatformKit

**Module switch:** `api` — the content API whole SHALL be one switch, on unless a site says `api: false`; within it the library's kinds (`articles`, `books`, `wiki`, `docs`) and the models module decide which content types exist, and a kind off is a type absent from every door.

**Layers.** core: the compiled index, the content types' derivation, the doors (Delivery, Preview, GraphQL, Sync, Images), the keys, the paywall check, the id rule. theme: the API page. site: its content and its models, registered as types by being there.

**Extension points this needs:** a site's content model registered as a content type (from the builder — no code).

**What the kit's module leaves to its comparable, on purpose:** Contentful: environments beyond `master` and aliases, tags and metadata, cross-space references, Location fields, face-aware crops, AVIF, comments, tasks, user management, the Management API and webhooks until their own changes.

This capability SHALL land in the layers above, SHALL be switched by its module, and SHALL expose the extension points named; a site SHALL keep its side as registrations, never as patches.

#### Scenario: a kind off

- **WHEN** a site runs with the `wiki` kind off
- **THEN** `content_types` does not list `wiki`, `entries?content_type=wiki` answers `InvalidQuery` naming the unknown type, and the GraphQL schema has no `Wiki`

Verified by: `content-api.test.mjs` on the docs site (docs alone)

#### Scenario: the module off

- **WHEN** a site's config says `api: false`
- **THEN** `/spaces/…`, `/content/v1/…` and `/images/…` answer nothing but the site's own 404, the API page is not in the admin, and the deploy asks for no rewrite

Verified by: `content-api.test.mjs` over the switch on a fixture site; the rail on such a site

### Requirement: The API documents itself

A site SHALL serve an OpenAPI 3.1 document describing what it serves — generated, never written by hand — at `/openapi.json` on the content function (and `<domain>/api/content/v1/openapi.json` under the host's rewrite): the content API's routes with every parameter, Contentful's shapes as component schemas, one schema per content type with its fields typed as the API types them (so a field added to a model is in the document on its next derivation), the error envelope, the key as the security scheme, and the analytics door (the site's own batch and PostHog's paths, the registered sources' names), and — with the `forms` module on — the Forms API (every route of the Create API's read side, the Responses, Webhooks and Insights APIs with Typeform's shapes as component schemas, the `forms` key kind), and — with `sessions` on — the Scheduling API (every route of cal.com's v2 the site serves, with its shapes as component schemas and its `cal-api-version` header as a parameter, the `scheduling` key kind), and — with `store` on — the Store API (Shopify's Storefront endpoint and the handoff's cart read, the `storefront` key kind, the schema's types named), and — with `support` on — the Support API (Chatwoot's Client API routes, the Application API's conversations, contacts, agents, inboxes, profile and webhooks, the `support` key kind), and the Management API's writing methods, the uploads and the webhook definitions under a *Content Management* tag with the management key as their security scheme (and the Forms API's form writes under Forms) — the APIs told apart by tag groups (*Content API*, *Analytics API*, *Forms API*, *Scheduling API*, *Store API*, *Support API*; a group present only with its module on), every tag and operation labelled with what it is, never a bare word and never a product's name (no "PostHog", no "Contentful" in a tag or a summary), what each is a drop-in for said in the tag's description rather than in its name. The site SHALL render that document as its API reference at `<domain>/api` with Scalar, following the site's light and dark theme, with the site itself as the server to try against; the page SHALL exist only with the `api` module on, and the admin's API page and the docs SHALL link to it.

#### Scenario: the document validates and says what is there

- **WHEN** `/openapi.json` is fetched from the served function on the demo
- **THEN** it is a valid OpenAPI 3.1 document (Scalar's own parser accepts it), its `paths` hold every route the Delivery, Preview, Management (the writing methods, the uploads, the webhook definitions), GraphQL, Images and analytics doors answer and every route of the Forms API (the writes among them), the Scheduling API, the Store API and the Support API (on the docs site, forms, sessions, store and support off, none of them), its `components.schemas` hold one schema per content type the site has (`Article`, `Book`, `Teacher`, `Event`…) whose properties are the type's fields, and the `content_type` parameter's enum is the types' ids

Verified by: `content-api.test.mjs` — the document parsed and validated with `@scalar/openapi-parser`, the paths and schemas compared with the index

#### Scenario: the reference page

- **WHEN** `<domain>/api` is opened on the demo
- **THEN** Scalar renders the reference with the site's name, the sidebar delineating the APIs the page documents as groups — *Content API* (Content Delivery, Content Management, Content Sync, Content GraphQL, Content Images), *Analytics API* (Analytics Events, Analytics Capture) and, forms on, *Forms API* (Forms, Responses, Webhooks, Insights), sessions on, *Scheduling API* (Event Types, Slots, Bookings, Schedules, Webhooks), store on, *Store API* (Storefront), support on, *Support API* (Client, Conversations, Contacts, Support Webhooks) — the sidebar holding plain names only, what each is a drop-in for (Contentful, PostHog, Typeform, cal.com, Shopify, Chatwoot; the Preview API the same routes under a preview key) said in the tag's description once it is opened, every operation named for what it does, and the models after them, an operation opening to its parameters and a runnable example, the page in the site's light and dark theme

Verified by: screenshots at 1280 and 390, both themes; a Playwright read of the sidebar's tags

### Requirement: Writes are Contentful's Management API

In cloud mode (`CONTENT_STORE=cloud`) a site SHALL take writes as Contentful's Management API on the routes the Delivery API answers, under a key of kind `management` and nothing less: `POST /entries` (`X-Contentful-Content-Type` naming the type; the entry's id — `<type>.<path>` — from the record's `slug` field, else its title slugified, else refused) and `PUT /entries/{id}` (create at that id, or update when `X-Contentful-Version` is the entry's current version, else 409 `VersionMismatch`), `PUT /entries/{id}/published` (publish), `DELETE /entries/{id}/published` (unpublish: `published: false`, published), `DELETE /entries/{id}` (removed, published); assets the same — `POST /uploads` (the bytes, answering an Upload with an id), `POST` or `PUT /assets[/{id}]` with `fields.file.<locale>.uploadFrom` (an Upload link) or `upload` (a url), `PUT /assets/{id}/files/{locale}/process` (the file into the media library under `content/uploads/api/<id>/<fileName>`, so its address is the asset's id), `PUT` and `DELETE …/published`, `DELETE /assets/{id}` (refused 409 while a record names it, as the library refuses). A management key SHALL read every route in the Management API's shapes: `fields` by locale (`{ 'en-US': value }`), `sys.version`, `sys.publishedVersion`, `sys.publishedAt`, `sys.firstPublishedAt`, `sys.updatedAt`, `sys.createdBy` and `sys.updatedBy` as User links, a draft over its live version. A markdown field SHALL accept Contentful's Rich Text document (turned to markdown by the site's own converter, the reverse of the reader's) or its `<field>Markdown` twin, which wins. Every write SHALL be what the admin would do: a draft through the content pipe — the model's fields, its checks, its grammar — refused as the admin is refused (422 `ValidationFailed` with the issues in Contentful's `details.errors`), and a publish the pipe's publish: the draft live at once, the row pushed to the repository as one commit. `/content_types` SHALL refuse writes (405: a model is changed in the builder). In git mode every writing method SHALL answer 405 saying the content is files in a checkout, edited through the admin's dev server. The base for `contentful-management` is the site with `host` swapped; `contentful-migration` runs against it with `--host`.

#### Scenario: the official management client, the host swapped

- **WHEN** `contentful-management` is created with `{ accessToken: <a management key>, host }` against the demo in cloud mode and asked to create an entry of the demo's `teacher` type (`createEntryWithId`, fields by locale), update it with its version, publish it, then read it through the Delivery API and the site's page, unpublish it and delete it
- **THEN** each call answers Contentful's shape with the version advancing, the entry is a draft in the admin (Content → Publishing lists it) until published, then live on the Delivery API and the site within a moment and pushed as a commit, gone from the Delivery API on unpublish and from the admin on delete; a second update with a stale version is 409; a create with a field the model refuses is 422 with the issue named

Verified by: `content-api.test.mjs` on the demo in cloud mode (`CONTENT_STORE=cloud npm run dev` after `content-export.mjs`), the client against the served function, the rows and the drafts read back, the page by Playwright

#### Scenario: an asset through the upload flow

- **WHEN** the client uploads a picture's bytes (`createUpload`), creates an asset from the upload with a title, processes its file and publishes it
- **THEN** the file is in the media library at `content/uploads/api/<id>/<fileName>`, the asset answers on the Delivery API with `fields.file.url` on the images door and the picture's size, and a delete while an entry names it is 409

Verified by: the test — the bucket listed, the Delivery API asked

#### Scenario: git mode

- **WHEN** `PUT /entries/{id}` is called under a management key on a site in git mode
- **THEN** it answers 405 in Contentful's error shape saying the content is files in a checkout

Verified by: the test on the root

### Requirement: Webhooks tell of every publish

A site SHALL take Contentful's webhook definitions — `POST` and `GET /spaces/<space>/webhook_definitions`, `GET`, `PUT` and `DELETE …/webhook_definitions/{id}` with `name`, `url`, `topics` (`Entry.create`, `Entry.save`, `Entry.publish`, `Entry.unpublish`, `Entry.delete`, `Asset.*`, `*.*`), `headers` (a secret header among them), `active` — as rows of `content_webhooks` under a management key, listed read-only under Settings → API; and SHALL deliver, in cloud mode, every entry and asset event whoever caused it — the API or a person in the admin — as Contentful delivers one: `X-Contentful-Topic: ContentManagement.<Type>.<event>`, `X-Contentful-Webhook-Name`, the entry or asset in the Management shape as the body (a `DeletedEntry` for a delete), the definition's headers; a failure kept on the definition and retried on the next event. In git mode there is nothing to deliver and the definitions say so.

#### Scenario: a person publishes, a subscriber hears

- **WHEN** a definition for `Entry.publish` and `Entry.unpublish` is created through the client with a secret header, and an editor publishes an article from the admin's Content → Publishing, then unpublishes it
- **THEN** a local receiver has two deliveries with the topics in `X-Contentful-Topic`, the entry as the body, the secret header on each, and the definition shows its last delivery; after `DELETE` nothing more arrives

Verified by: the test on the demo in cloud mode with a local receiver; the admin's publish by Playwright

### Requirement: Every API door is under /api

Every API this site serves SHALL answer under **`/api`**, in a **room of its own**: one segment
named for what the API does — `content`, `media`, `store`, `desk`, `scheduling`, `forms`, `events` —
and never for the product whose shape it wears. Inside that room the product's own path SHALL
continue **unchanged**, so that a client reaches the API by changing its base URL and nothing else.

Where a product's own path repeats the room's word — Chatwoot's `/api/v1/…` inside `desk`,
Typeform's `/forms` inside `forms` — the repetition SHALL be kept. Those clients build that part of
the path themselves, so trimming it would rewrite their path, which is the one thing that breaks
changing only the base.

**An API whose client discards a path SHALL keep its room and be given an alias.** Shopify's takes
a domain and throws away anything after it, so the Storefront endpoint SHALL answer both in its room
and at `/api/<version>/graphql.json`, which is where that client asks whatever it is given. The
alias SHALL be the last rule under the prefix, since its second segment matches anything, and it is
why nothing else may sit at the top of `/api` without a room. A test SHALL pin that client's
behaviour, so the alias can never be removed without the reason showing up.

No room SHALL be able to collide with another, and no rule SHALL depend on coming before another to
be correct.

A reader's address and a machine's SHALL NOT share a prefix: a path somebody navigates to cannot
also be a rewrite at the host, and it is this rule that lets a surface have the obvious name.

**The app calling its own backend is not an API** and SHALL NOT be under `/api` or in a room: it
answers at `/v1/<function>`, the Edge Functions gateway on the site's own domain — the `v1` being
Supabase's own path segment and not a version of this project's — so the browser reaches every
function same-origin and without a preflight, and a link a function writes into an email points at
the site rather than at the project's host.

That address SHALL NOT be renamed, ever: the tracked links, the open pixel and the unsubscribe link
in marketing email already sent are written as `<site>/v1/…` and are in people's inboxes. The
reason SHALL be written beside the rule so that nobody tidies it away.

#### Scenario: every door answers in its own room

- **WHEN** each of the content, media, store, desk, scheduling, forms and events APIs is asked for
  through the host's rules
- **THEN** each answers as itself — its own shapes, its own refusals — and `/api` itself is still
  the reference page

Verified by: `build/rewrites.test.mjs` (the rules rendered as nginx, built and run in Docker against
the local stack)

#### Scenario: the product's own client works, and is made to prove it

A compatibility API is only worth the name if the product's own SDK reaches it. For every API this
site stands in for, that client SHALL be driven against the site in the test suite — not described —
and where no client of theirs exists to drive, the page SHALL say so rather than imply one was run.

- **WHEN** `contentful`, `@typeform/api-client`, `@shopify/storefront-api-client`,
  `@figuro/chatwoot-sdk` and cal.com's `@calcom/sdk` are each given the site and its room as a base
- **THEN** each builds a URL the host routes to the right function, and each is answered in its own
  product's shape

Verified by: `build/content-api.test.mjs`, `build/forms-api.test.mjs`,
`build/storefront-api.test.mjs` and `build/rewrites.test.mjs` (Chatwoot's and cal.com's, through
nginx)

#### Scenario: a client changes its base and no more

- **WHEN** a Contentful client is given `basePath: '/api/content'`, a Typeform client
  `apiBaseUrl: <site>/api/forms`, a Chatwoot snippet `baseUrl: <site>/api/desk`, a PostHog SDK
  `api_host: <site>/api/events`, and a cal.com client the base `<site>/api/scheduling/v2`
- **THEN** each works unchanged in every other respect, the repeated segments included

Verified by: `build/content-api.test.mjs`, `build/scheduling-api.test.mjs`,
`build/forms-api.test.mjs`, `build/analytics-sdk.test.mjs`, `build/support-api.test.mjs`

#### Scenario: a client that discards the path still reaches the room

- **WHEN** Shopify's own client is given the site with a path on it
- **THEN** the path is discarded and the endpoint asked for is `/api/<version>/graphql.json` — and
  that address answers exactly as the store's own room does, the same door under two names

Verified by: `build/storefront-api.test.mjs` (the client) and `build/rewrites.test.mjs` (both
addresses, through nginx)

#### Scenario: the rooms cannot collide

- **WHEN** a new drop-in is added
- **THEN** it is one segment and one rule, and no existing rule has to move or be reordered for it
  to be correct

Verified by: `build/rewrites.test.mjs`

#### Scenario: the door that cannot move

- **WHEN** an unsubscribe link from an email already sent is followed
- **THEN** it still reaches the function, at the same address the app itself uses

Verified by: `build/rewrites.test.mjs`

### Requirement: A server-side search names its asker and shows only what that person may see

The index a server searches SHALL hold every published document, and a search of it SHALL name the
person it is searching on behalf of. A row whose record declares an audience SHALL be returned only
where that person satisfies it; a row with no audience SHALL be returned to anyone. A search naming
nobody SHALL return only rows with no audience.

#### Scenario: a gated record is not found by someone who may not read it
- **WHEN** a record carrying `for: tier:inner` is searched for by a reader with no membership
- **THEN** it is absent from the results entirely — not returned without its excerpt
- **AND** verified by `build/search.test.mjs` and `build/spaces-db.test.mjs`

#### Scenario: an ungated record is unchanged
- **WHEN** a record declares no audience
- **THEN** it is returned to anyone, including a search naming nobody
- **AND** verified by `build/search.test.mjs`

### Requirement: What a search matches on is not what it may quote back

Every indexed row SHALL carry two texts: the whole of what the document says, which the search
matches on and which nothing reads back out; and what may be shown to whoever asked, from which
every excerpt SHALL be cut. A kind whose body is sold — a book — SHALL quote only what is free to
read, and a new kind of content SHALL state which it is.

#### Scenario: a paywalled book is findable but not readable
- **WHEN** a search matches a phrase that appears only in the body of a book
- **THEN** the book is returned, and its excerpt contains no words from the body
- **AND** verified by `build/search.test.mjs`

#### Scenario: a new kind must answer
- **WHEN** a kind of content is added to the index without saying whether its body may be quoted
- **THEN** it is treated as free to quote, and the list of kinds that must answer is asserted
- **AND** verified by `build/search.test.mjs`

### Requirement: The server's index is the server's

The search function SHALL be executable by the service role alone. Because the platform grants
execute to `PUBLIC` on every new function, and grants `anon` and `authenticated` by default, each
SHALL be revoked by name; the index table SHALL carry no read policy for any reader.

#### Scenario: the public cannot call it
- **WHEN** the search is called as `anon` or as `authenticated`
- **THEN** permission is denied
- **AND** verified by `build/search.test.mjs` (the schema is asserted) and by a role-switched call
  in `build/spaces-db.test.mjs`
